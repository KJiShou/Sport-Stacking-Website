import {
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type {FirestoreUser, Registration, Team, Tournament, UserTournamentHistory} from "../../schema";
import {stripTeamLeaderPrefix} from "../../utils/teamLeaderId";
import {db} from "./config";
import {deleteDoubleRecruitment, getDoubleRecruitmentsByParticipant} from "./doubleRecruitmentService";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByParticipant} from "./individualRecruitmentService";
import {deleteTeamRecruitment, getTeamRecruitmentsByLeader} from "./teamRecruitmentService";
import {
    deleteVerificationRequestByTournamentTeamMember,
    deleteVerificationRequestsByRegistrationId,
    deleteVerificationRequestsByTeamId,
    deleteVerificationRequestsByTournamentAndMember,
} from "./verificationRequestService";

async function getApprovedRegistrationCount(tournamentId: string): Promise<number> {
    const registrationsRef = query(
        collection(db, "registrations"),
        where("tournament_id", "==", tournamentId),
        where("registration_status", "==", "approved"),
    );
    const querySnapshot = await getDocs(registrationsRef);
    return querySnapshot.size;
}

async function ensureTournamentHasCapacity(tournamentId: string, maxParticipants?: number | null): Promise<void> {
    let resolvedMax = maxParticipants;

    if (resolvedMax == null) {
        const tournamentDoc = await getDoc(doc(db, "tournaments", tournamentId));
        if (!tournamentDoc.exists()) {
            throw new Error("Tournament not found");
        }
        const tournament = tournamentDoc.data() as Tournament;
        resolvedMax = typeof tournament.max_participants === "number" ? tournament.max_participants : null;
    }

    if (typeof resolvedMax !== "number" || resolvedMax <= 0) {
        return;
    }

    const approvedCount = await getApprovedRegistrationCount(tournamentId);
    if (approvedCount >= resolvedMax) {
        throw new Error("Tournament registration is full.");
    }
}

export async function createRegistration(user: FirestoreUser, data: Registration): Promise<string> {
    if (!user?.id) {
        throw new Error("User global_id is missing.");
    }

    if (!data.user_id) {
        throw new Error("User id is required in registration payload.");
    }

    const existingByUserIdQuery = query(
        collection(db, "registrations"),
        where("tournament_id", "==", data.tournament_id),
        where("user_id", "==", data.user_id),
    );
    const existingByUserIdSnapshot = await getDocs(existingByUserIdQuery);
    if (!existingByUserIdSnapshot.empty) {
        throw new Error("You have already registered for this tournament.");
    }

    if (data.user_global_id) {
        const existingByGlobalIdQuery = query(
            collection(db, "registrations"),
            where("tournament_id", "==", data.tournament_id),
            where("user_global_id", "==", data.user_global_id),
        );
        const existingByGlobalIdSnapshot = await getDocs(existingByGlobalIdQuery);
        if (!existingByGlobalIdSnapshot.empty) {
            throw new Error("You have already registered for this tournament.");
        }
    }

    const tournamentDoc = await getDoc(doc(db, "tournaments", data.tournament_id));
    const tournament = tournamentDoc.data();
    if (!tournament) {
        throw new Error("Tournament not found");
    }
    await ensureTournamentHasCapacity(
        data.tournament_id,
        typeof tournament.max_participants === "number" ? tournament.max_participants : null,
    );

    // 确保 created_at / updated_at 都有填入
    const payload: Omit<Registration, "id"> = {
        ...data,
        created_at: data.created_at ?? Timestamp.now(),
        updated_at: Timestamp.now(),
    };

    const ref = await addDoc(collection(db, "registrations"), {
        ...data,
        created_at: data.created_at ?? Timestamp.now(),
        updated_at: Timestamp.now(),
    });
    // Ensure the document has its generated ID in the Firestore document
    await updateDoc(ref, {id: ref.id});
    return ref.id;
}

export async function fetchRegistrationById(tournamentId: string, registrationId: string): Promise<Registration | null> {
    try {
        const regDoc = await getDoc(doc(db, "registrations", registrationId));
        if (regDoc.exists()) {
            const data = regDoc.data() as Registration;
            if (data.tournament_id !== tournamentId) {
                return null;
            }
            return {
                ...data,
                id: regDoc.id,
            };
        }
        return null;
    } catch (err) {
        console.error("Error fetching registration by ID:", err);
        throw err;
    }
}

export async function fetchApprovedRegistrations(tournamentId: string): Promise<Registration[]> {
    try {
        const registrationsRef = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("registration_status", "==", "approved"),
        );
        const querySnapshot = await getDocs(registrationsRef);

        return querySnapshot.docs.map((docSnap) => ({
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        }));
    } catch (err) {
        console.error("Error fetching registrations:", err);
        throw err;
    }
}

export async function fetchRegistrations(tournamentId: string): Promise<Registration[]> {
    try {
        const registrationsRef = query(collection(db, "registrations"), where("tournament_id", "==", tournamentId));
        const querySnapshot = await getDocs(registrationsRef);

        return querySnapshot.docs.map((docSnap) => ({
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        }));
    } catch (err) {
        console.error("Error fetching registrations:", err);
        throw err;
    }
}

/**
 * 根据 tournamentId + user global_id fetch 用户报名资料
 */
export async function fetchUserRegistration(tournamentId: string, userId: string): Promise<Registration | null> {
    try {
        const regQuery = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("user_global_id", "==", userId),
        );
        const querySnapshot = await getDocs(regQuery);
        if (querySnapshot.empty) {
            return null;
        }
        const docSnap = querySnapshot.docs[0];
        return {
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        };
    } catch (err) {
        console.error("Error fetching user registration:", err);
        throw err;
    }
}

/**
 * 更新用户报名资料
 */

export async function updateRegistration(data: Registration): Promise<void> {
    if (!data.user_id) throw new Error("No user_id in registration data.");
    if (!data.tournament_id) throw new Error("No tournament_id in registration data.");
    if (!data.id) throw new Error("No registration id provided.");

    const registrationRef = doc(db, "registrations", data.id);
    const snap = await getDoc(registrationRef);
    if (!snap.exists()) throw new Error("Registration not found");

    const old = snap.data() as Registration;
    const toUpdate: Partial<Record<keyof Registration, Registration[keyof Registration]>> = {};

    const currentStatus = old.registration_status ?? "pending";
    const nextStatus = data.registration_status ?? currentStatus;
    const statusChanged = currentStatus !== nextStatus;
    if (nextStatus === "approved" && currentStatus !== "approved") {
        await ensureTournamentHasCapacity(data.tournament_id);
    }

    // 对比字段，仅当值有变化（或有值）时才加入更新对象
    for (const key of Object.keys(data) as (keyof typeof data)[]) {
        const newVal = data[key];
        const oldVal = old[key];
        // 简单比较，可根据需要做深度比较
        if (newVal !== undefined && JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
            toUpdate[key] = newVal;
        }
    }

    // 每次都更新一下 status 和 updated_at
    toUpdate.updated_at = Timestamp.now();
    if (Object.keys(toUpdate).length === 0) {
        // 完全没变化
        return;
    }

    await updateDoc(registrationRef, toUpdate);

    if (statusChanged) {
        const tournamentRef = doc(db, "tournaments", data.tournament_id);
        const delta = nextStatus === "approved" ? 1 : currentStatus === "approved" ? -1 : 0;
        if (delta !== 0) {
            await updateDoc(tournamentRef, {participants: increment(delta)});
        }
    }
}

type DeleteRegistrationOptions = {
    adminDelete?: boolean;
};

const normalizeEventValue = (value: string): string => value.trim().toLowerCase();

const getTeamEventKeys = (team: Team): string[] => {
    const keys = new Set<string>();
    const addKey = (value: unknown) => {
        if (typeof value !== "string") {
            return;
        }
        const trimmed = value.trim();
        if (trimmed.length > 0) {
            keys.add(trimmed);
        }
    };

    if (typeof team.event_id === "string") {
        addKey(team.event_id);
    }
    if (Array.isArray(team.event)) {
        for (const value of team.event) {
            addKey(value);
        }
    } else {
        addKey(team.event);
    }

    return Array.from(keys);
};

const buildNormalizedEventSet = (values: string[]): Set<string> => {
    const normalized = new Set<string>();
    for (const value of values) {
        if (typeof value !== "string") {
            continue;
        }
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            continue;
        }
        normalized.add(trimmed.toLowerCase());
    }
    return normalized;
};

const filterEventList = (events: string[], toRemove: Set<string>): string[] =>
    events.filter((event) => !toRemove.has(normalizeEventValue(event)));

const removeTeamEventsFromUserRegistration = async (
    globalId: string,
    tournamentId: string,
    eventKeys: string[],
): Promise<void> => {
    if (!globalId || eventKeys.length === 0) {
        return;
    }

    const normalizedKeys = buildNormalizedEventSet(eventKeys);
    if (normalizedKeys.size === 0) {
        return;
    }

    const userQuery = query(collection(db, "users"), where("global_id", "==", globalId));
    const userSnapshot = await getDocs(userQuery);
    const userDoc = userSnapshot.empty ? null : userSnapshot.docs[0];
    const now = Timestamp.now();

    if (userDoc) {
        const userData = userDoc.data() as FirestoreUser;
        const registrationRecords = userData.registration_records ?? [];
        const recordIndex = registrationRecords.findIndex((record) => record.tournament_id === tournamentId);
        if (recordIndex !== -1) {
            const record = registrationRecords[recordIndex];
            const existingEvents = Array.isArray(record.events) ? record.events : [];
            const filteredEvents = filterEventList(existingEvents, normalizedKeys);
            if (filteredEvents.length !== existingEvents.length) {
                const updatedRecord = {
                    ...record,
                    events: filteredEvents,
                    updated_at: now,
                };
                const updatedRecords = [...registrationRecords];
                updatedRecords[recordIndex] = updatedRecord;

                await updateDoc(userDoc.ref, {
                    registration_records: updatedRecords,
                    updated_at: now,
                });
            }
        }
    }

    const registrationQuery = query(
        collection(db, "registrations"),
        where("tournament_id", "==", tournamentId),
        where("user_global_id", "==", globalId),
    );
    const registrationSnapshot = await getDocs(registrationQuery);
    if (!registrationSnapshot.empty) {
        const registrationDoc = registrationSnapshot.docs[0];
        const registrationData = registrationDoc.data() as Registration;
        const registrationEvents = Array.isArray(registrationData.events_registered) ? registrationData.events_registered : [];
        const filteredRegistrationEvents = filterEventList(registrationEvents, normalizedKeys);
        if (filteredRegistrationEvents.length !== registrationEvents.length) {
            await updateDoc(registrationDoc.ref, {
                events_registered: filteredRegistrationEvents,
                updated_at: now,
            });
        }
    }
};

const removeTeamEventsFromUserHistory = async (globalId: string, tournamentId: string, eventKeys: string[]): Promise<void> => {
    if (!globalId || eventKeys.length === 0) {
        return;
    }

    const normalizedKeys = buildNormalizedEventSet(eventKeys);
    if (normalizedKeys.size === 0) {
        return;
    }

    const historyRef = doc(db, "user_tournament_history", globalId.trim());
    const historySnap = await getDoc(historyRef);
    if (!historySnap.exists()) {
        return;
    }

    const historyData = historySnap.data() as UserTournamentHistory;
    const tournaments = Array.isArray(historyData.tournaments) ? historyData.tournaments : [];
    let changed = false;
    const updatedTournaments = tournaments.flatMap((summary) => {
        if (summary.tournamentId !== tournamentId) {
            return [summary];
        }

        const results = Array.isArray(summary.results) ? summary.results : [];
        const filteredResults = results.filter((result) => {
            const eventCandidates = [result.eventKey, result.event].filter((value): value is string => Boolean(value));
            if (eventCandidates.length === 0) {
                return true;
            }
            return !eventCandidates.some((value) => normalizedKeys.has(normalizeEventValue(value)));
        });

        if (filteredResults.length === results.length) {
            return [summary];
        }

        changed = true;
        if (filteredResults.length === 0) {
            return [];
        }

        return [{...summary, results: filteredResults}];
    });

    if (!changed) {
        return;
    }

    const recordCount = updatedTournaments.reduce((total, summary) => total + (summary.results?.length ?? 0), 0);
    await updateDoc(historyRef, {
        tournaments: updatedTournaments,
        tournamentCount: updatedTournaments.length,
        recordCount,
        updatedAt: Timestamp.now(),
    });
};

const removeTeamEventsForMember = async (globalId: string, tournamentId: string, eventKeys: string[]): Promise<void> => {
    try {
        await removeTeamEventsFromUserRegistration(globalId, tournamentId, eventKeys);
    } catch (error) {
        console.error(`Failed to remove team events from registration for ${globalId}:`, error);
    }

    try {
        await removeTeamEventsFromUserHistory(globalId, tournamentId, eventKeys);
    } catch (error) {
        console.error(`Failed to remove team events from history for ${globalId}:`, error);
    }
};

export async function deleteRegistrationById(
    tournamentId: string,
    registrationId: string,
    options?: DeleteRegistrationOptions,
): Promise<void> {
    try {
        let registrationRef = doc(db, "registrations", registrationId);
        let regSnap = await getDoc(registrationRef);

        if (!regSnap.exists()) {
            const fallbackQuery = query(
                collection(db, "registrations"),
                where("tournament_id", "==", tournamentId),
                where("user_id", "==", registrationId),
            );
            const fallbackSnapshot = await getDocs(fallbackQuery);

            if (fallbackSnapshot.empty) {
                throw new Error("Registration not found");
            }

            registrationRef = fallbackSnapshot.docs[0].ref;
            regSnap = fallbackSnapshot.docs[0];
        }

        const registrationData = regSnap.data() as Registration;
        const userId = registrationData.user_id;

        const adminDelete = options?.adminDelete ?? false;

        // Delete associated teams
        const teamsRef = collection(db, "teams");
        const teamsSnapshot = await getDocs(query(teamsRef, where("tournament_id", "==", tournamentId)));
        for (const teamDoc of teamsSnapshot.docs) {
            const team = teamDoc.data() as Team;
            const memberIds = (team.members ?? []).map((member) => member.global_id);
            const leaderId = stripTeamLeaderPrefix(team.leader_id);
            if (leaderId === registrationData.user_global_id) {
                if (adminDelete) {
                    const eventKeys = getTeamEventKeys(team);
                    const verifiedMembers = (team.members ?? []).filter((member) => member.verified && member.global_id);
                    for (const member of verifiedMembers) {
                        await removeTeamEventsForMember(member.global_id, tournamentId, eventKeys);
                    }
                }
                try {
                    await deleteVerificationRequestsByTeamId(team.id ?? teamDoc.id);
                } catch (error) {
                    console.error("Error deleting verification requests for removed team:", error);
                }
                await deleteDoc(teamDoc.ref);
            } else if (memberIds.includes(registrationData.user_global_id)) {
                if (adminDelete) {
                    const eventKeys = getTeamEventKeys(team);
                    const targetMember = (team.members ?? []).find(
                        (member) => member.global_id === registrationData.user_global_id,
                    );
                    if (targetMember?.verified) {
                        await removeTeamEventsForMember(registrationData.user_global_id, tournamentId, eventKeys);
                    }

                    const updatedMembers = (team.members ?? []).map((member) =>
                        member.global_id === registrationData.user_global_id ? {...member, verified: false} : member,
                    );
                    await updateDoc(teamDoc.ref, {members: updatedMembers});
                } else {
                    // 如果用户是队员，则将其从队伍中移除
                    const updatedMembers = (team.members ?? []).filter(
                        (member) => member.global_id !== registrationData.user_global_id,
                    );
                    await updateDoc(teamDoc.ref, {members: updatedMembers});
                }
                try {
                    await deleteVerificationRequestByTournamentTeamMember(
                        tournamentId,
                        team.id ?? teamDoc.id,
                        registrationData.user_global_id,
                    );
                } catch (error) {
                    console.error("Error deleting verification request for removed member:", error);
                }
            }
        }

        // Delete associated individual recruitment records
        try {
            const recruitments = await getIndividualRecruitmentsByParticipant(registrationData.user_global_id);
            const tournamentRecruitments = recruitments.filter((recruitment) => recruitment.tournament_id === tournamentId);
            for (const recruitment of tournamentRecruitments) {
                await deleteIndividualRecruitment(recruitment.id);
            }
        } catch (recruitmentError) {
            console.error("Error deleting individual recruitment records:", recruitmentError);
            // Don't throw error here to avoid breaking the main deletion flow
        }

        // Delete associated double recruitment records
        try {
            const recruitments = await getDoubleRecruitmentsByParticipant(registrationData.user_global_id);
            const tournamentRecruitments = recruitments.filter((recruitment) => recruitment.tournament_id === tournamentId);
            for (const recruitment of tournamentRecruitments) {
                await deleteDoubleRecruitment(recruitment.id);
            }
        } catch (recruitmentError) {
            console.error("Error deleting double recruitment records:", recruitmentError);
            // Don't throw error here to avoid breaking the main deletion flow
        }

        // Delete associated team recruitment records
        try {
            const teamRecruitments = await getTeamRecruitmentsByLeader(registrationData.user_global_id);
            const tournamentTeamRecruitments = teamRecruitments.filter(
                (recruitment) => recruitment.tournament_id === tournamentId,
            );
            for (const recruitment of tournamentTeamRecruitments) {
                await deleteTeamRecruitment(recruitment.id);
            }
        } catch (teamRecruitmentError) {
            console.error("Error deleting team recruitment records:", teamRecruitmentError);
            // Don't throw error here to avoid breaking the main deletion flow
        }

        // Delete the registration document
        await deleteDoc(registrationRef);

        try {
            await deleteVerificationRequestsByRegistrationId(regSnap.id);
        } catch (error) {
            console.error("Error deleting verification requests by registration id:", error);
        }

        try {
            if (registrationData.user_global_id) {
                await deleteVerificationRequestsByTournamentAndMember(tournamentId, registrationData.user_global_id);
            }
        } catch (error) {
            console.error("Error deleting verification requests by tournament/member:", error);
        }

        if (registrationData.registration_status === "approved") {
            const tournamentRef = doc(db, "tournaments", tournamentId);
            await updateDoc(tournamentRef, {participants: increment(-1)});
        }

        // Remove the registration record from the user's document
        if (userId) {
            const userRef = doc(db, "users", userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data() as FirestoreUser;
                const updatedRecords =
                    userData.registration_records?.filter((record) => record.tournament_id !== tournamentId) ?? [];
                await updateDoc(userRef, {registration_records: updatedRecords});
            }
        }
    } catch (error) {
        console.error("Error deleting registration:", error);
        throw error;
    }
}
