import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    updateDoc,
    where,
} from "firebase/firestore";
import type {DocumentReference, Transaction} from "firebase/firestore";
import type {FirestoreUser, Registration, Team, Tournament, TournamentEvent, UserTournamentHistory} from "../../schema";
import type {UserRegistrationRecord} from "../../schema/UserSchema";
import {stripTeamLeaderPrefix} from "../../utils/teamLeaderId";
import {matchesAnyEventKey} from "../../utils/tournament/eventUtils";
import {db} from "./config";
import {deleteDoubleRecruitment, getDoubleRecruitmentsByParticipant} from "./doubleRecruitmentService";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByParticipant} from "./individualRecruitmentService";
import {deleteTeamRecruitment, getTeamRecruitmentsByLeader} from "./teamRecruitmentService";
import {deleteTeam, updateTeam} from "./tournamentsService";
import {
    deleteVerificationRequestByTournamentTeamMember,
    deleteVerificationRequestsByRegistrationId,
    deleteVerificationRequestsByTeamId,
    deleteVerificationRequestsByTournamentAndMember,
} from "./verificationRequestService";

const isApproved = (registration: Registration | null): boolean => registration?.registration_status === "approved";

const registrationMatchesEvent = (registration: Registration, event: TournamentEvent): boolean =>
    matchesAnyEventKey(registration.events_registered ?? [], event);

type ResolvedUserProfile = {
    ref: DocumentReference;
};

const buildUserRegistrationRecord = (registration: Registration, now: Timestamp): UserRegistrationRecord => ({
    tournament_id: registration.tournament_id,
    events: registration.events_registered ?? [],
    registration_date: registration.created_at ?? now,
    status: registration.registration_status,
    rejection_reason: registration.rejection_reason ?? null,
    created_at: registration.created_at ?? now,
    updated_at: registration.updated_at ?? now,
});

const mergeUserRegistrationRecord = (
    existing: UserRegistrationRecord | undefined,
    registration: Registration,
    now: Timestamp,
): UserRegistrationRecord => ({
    ...existing,
    ...buildUserRegistrationRecord(registration, now),
});

const resolveUserProfileForRegistration = async (
    registration: Registration,
): Promise<ResolvedUserProfile> => {
    const userId = registration.user_id?.trim();
    if (userId) {
        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
            return {ref: userRef};
        }
    }

    const globalId = registration.user_global_id?.trim();
    if (!globalId) {
        throw new Error(`Unable to find user for registration ${registration.id ?? ""}.`);
    }

    const usersSnapshot = await getDocs(query(collection(db, "users"), where("global_id", "==", globalId)));
    if (usersSnapshot.size !== 1) {
        const reason = usersSnapshot.empty ? "no matching profile" : "multiple matching profiles";
        throw new Error(`Unable to sync registration ${registration.id ?? ""}: ${reason} for Global ID ${globalId}.`);
    }

    const userDoc = usersSnapshot.docs[0];
    return {ref: userDoc.ref};
};

/**
 * Writes a registration and all affected approved participant counters atomically.
 * Pending registrations intentionally do not reserve an event place.
 */
async function writeRegistrationWithCapacity(
    tournamentId: string,
    previous: Registration | null,
    next: Registration | null,
    writeRegistration: (transaction: Transaction) => void,
): Promise<void> {
    const tournamentRef = doc(db, "tournaments", tournamentId);
    const eventsQuery = query(collection(db, "events"), where("tournament_id", "==", tournamentId));
    const approvedRegistrationsQuery = query(
        collection(db, "registrations"),
        where("tournament_id", "==", tournamentId),
        where("registration_status", "==", "approved"),
    );
    // The SDK only permits document reads inside a transaction. The transaction
    // below re-reads every event document before writing its counter, so concurrent
    // attempts for the same event still conflict and retry safely.
    const [eventSnapshots, approvedSnapshots] = await Promise.all([getDocs(eventsQuery), getDocs(approvedRegistrationsQuery)]);
    const profileRegistration = next ?? previous;
    const profile = profileRegistration ? await resolveUserProfileForRegistration(profileRegistration) : null;

    await runTransaction(db, async (transaction) => {
        const [tournamentSnap, ...eventDocs] = await Promise.all([
            transaction.get(tournamentRef),
            ...eventSnapshots.docs.map((eventSnapshot) => transaction.get(eventSnapshot.ref)),
        ]);
        if (!tournamentSnap.exists()) {
            throw new Error("Tournament not found");
        }
        const profileSnap = profile ? await transaction.get(profile.ref) : null;
        if (profile && !profileSnap?.exists()) {
            throw new Error(`Unable to find user for registration ${profileRegistration?.id ?? ""}.`);
        }

        const events = eventDocs.filter((eventSnap) => eventSnap.exists()).map((eventSnap) => ({
            ref: eventSnap.ref,
            event: {id: eventSnap.id, ...eventSnap.data()} as TournamentEvent,
        }));
        const limitedEvents = events.filter(({event}) =>
            typeof event.max_participants === "number" && event.max_participants > 0,
        );
        const needsBackfill = limitedEvents.some(({event}) => typeof event.approved_participants !== "number");
        const approvedRegistrations = needsBackfill
            ? approvedSnapshots.docs.map((snapshot) => snapshot.data() as Registration)
            : [];

        const tournament = tournamentSnap.data() as Tournament;
        const participantDelta = (isApproved(next) ? 1 : 0) - (isApproved(previous) ? 1 : 0);
        const maxTournamentParticipants = tournament.max_participants;
        const currentTournamentParticipants = typeof tournament.participants === "number" ? tournament.participants : 0;
        if (
            participantDelta > 0 &&
            typeof maxTournamentParticipants === "number" &&
            maxTournamentParticipants > 0 &&
            currentTournamentParticipants + participantDelta > maxTournamentParticipants
        ) {
            throw new Error("Tournament registration is full.");
        }

        const eventUpdates: Array<{ref: DocumentReference; count: number}> = [];
        for (const {ref, event} of limitedEvents) {
            const previousSelected = Boolean(previous && isApproved(previous) && registrationMatchesEvent(previous, event));
            const nextSelected = Boolean(next && isApproved(next) && registrationMatchesEvent(next, event));
            const delta = (nextSelected ? 1 : 0) - (previousSelected ? 1 : 0);
            const currentCount =
                typeof event.approved_participants === "number"
                    ? event.approved_participants
                    : approvedRegistrations.filter((registration) => registrationMatchesEvent(registration, event)).length;
            const nextCount = currentCount + delta;

            if (nextCount > (event.max_participants ?? 0)) {
                throw new Error(`${event.type} has reached the maximum participants.`);
            }
            if (nextCount < 0) {
                throw new Error(`${event.type} participant count cannot be negative.`);
            }
            if (delta !== 0 || typeof event.approved_participants !== "number") {
                eventUpdates.push({ref, count: nextCount});
            }
        }

        writeRegistration(transaction);
        if (profile && profileSnap && next) {
            const profileData = profileSnap.data() as FirestoreUser;
            const existingRecords = profileData.registration_records ?? [];
            const existingRecord = existingRecords.find((record) => record.tournament_id === next.tournament_id);
            transaction.update(profile.ref, {
                registration_records: [
                    ...existingRecords.filter((record) => record.tournament_id !== next.tournament_id),
                    mergeUserRegistrationRecord(existingRecord, next, Timestamp.now()),
                ],
                updated_at: Timestamp.now(),
            });
        } else if (profile && profileSnap && previous) {
            const profileData = profileSnap.data() as FirestoreUser;
            transaction.update(profile.ref, {
                registration_records: (profileData.registration_records ?? []).filter(
                    (record) => record.tournament_id !== previous.tournament_id,
                ),
                updated_at: Timestamp.now(),
            });
        }
        if (participantDelta !== 0) {
            transaction.update(tournamentRef, {participants: Math.max(0, currentTournamentParticipants + participantDelta)});
        }
        for (const eventUpdate of eventUpdates) {
            transaction.update(eventUpdate.ref, {approved_participants: eventUpdate.count, updated_at: Timestamp.now()});
        }
    });
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

    const ref = doc(collection(db, "registrations"));
    const now = Timestamp.now();
    const registration = {...data, id: ref.id, created_at: data.created_at ?? now, updated_at: now} as Registration;
    await writeRegistrationWithCapacity(data.tournament_id, null, registration, (transaction) => {
        transaction.set(ref, registration);
    });
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
 * Returns the authoritative registrations for one profile. Both identifiers are
 * queried because older imported registrations may only contain one of them.
 */
export async function fetchRegistrationsForUser(userId?: string | null, globalId?: string | null): Promise<Registration[]> {
    const queries = [];
    if (userId?.trim()) {
        queries.push(getDocs(query(collection(db, "registrations"), where("user_id", "==", userId.trim()))));
    }
    if (globalId?.trim()) {
        queries.push(getDocs(query(collection(db, "registrations"), where("user_global_id", "==", globalId.trim()))));
    }

    const snapshots = await Promise.all(queries);
    const registrations = new Map<string, Registration>();
    for (const snapshot of snapshots) {
        for (const docSnap of snapshot.docs) {
            registrations.set(docSnap.id, {...(docSnap.data() as Registration), id: docSnap.id});
        }
    }
    return Array.from(registrations.values());
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

    const next = {...old, ...toUpdate} as Registration;
    await writeRegistrationWithCapacity(data.tournament_id, old, next, (transaction) => {
        transaction.update(registrationRef, toUpdate);
    });
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
            await updateRegistration({
                ...registrationData,
                id: registrationDoc.id,
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
                await deleteTeam(tournamentId, team.id ?? teamDoc.id);
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
                    await updateTeam(tournamentId, team.id ?? teamDoc.id, {...team, members: updatedMembers});
                } else {
                    // 如果用户是队员，则将其从队伍中移除
                    const updatedMembers = (team.members ?? []).filter(
                        (member) => member.global_id !== registrationData.user_global_id,
                    );
                    await updateTeam(tournamentId, team.id ?? teamDoc.id, {...team, members: updatedMembers});
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

        // Delete the registration document, release approved event places, and remove the profile cache atomically.
        await writeRegistrationWithCapacity(tournamentId, registrationData, null, (transaction) => {
            transaction.delete(registrationRef);
        });

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

    } catch (error) {
        console.error("Error deleting registration:", error);
        throw error;
    }
}
