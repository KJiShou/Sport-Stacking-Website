// src/services/firebase/authService.ts

import {
    type Query,
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type {FirestoreUser, Registration, Team, Tournament, TournamentEvent} from "../../schema";
import {EventSchema, TournamentSchema} from "../../schema";
import {removeUserRegistrationRecordsByTournament} from "./authService";
import {db} from "./config";
import {deleteDoubleRecruitment, getDoubleRecruitmentsByTournament} from "./doubleRecruitmentService";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByTournament} from "./individualRecruitmentService";
import {deleteTournamentStorage} from "./storageService";
import {deleteTeamRecruitment, getActiveTeamRecruitments} from "./teamRecruitmentService";

// Utility function to check if a string is a UUID v4
function isUUID(value: string): boolean {
    // RFC4122 v4 UUID pattern
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidV4Regex.test(value);
}

export async function createTournament(
    user: FirestoreUser,
    data: Omit<Tournament, "id">,
    events: TournamentEvent[],
): Promise<string> {
    if (!user?.roles?.edit_tournament) {
        throw new Error("Unauthorized: You do not have permission to create a tournament.");
    }

    if (!data.name) {
        throw new Error("Tournament name is required.");
    }

    if (!data.start_date || !data.end_date) {
        throw new Error("Start and end dates are required.");
    }

    if (data.start_date >= data.end_date) {
        throw new Error("Start date must be before end date.");
    }

    if (!data.registration_start_date || !data.registration_end_date) {
        throw new Error("Registration start and end dates are required.");
    }

    if (data.registration_start_date >= data.registration_end_date) {
        throw new Error("Registration start date must be before end date.");
    }

    if (data.registration_start_date > data.start_date || data.registration_end_date > data.end_date) {
        throw new Error("Registration dates must be within the tournament dates.");
    }

    if (typeof data.max_participants === "number" && data.max_participants < 0) {
        throw new Error("Max participants must be greater than or equal 0.");
    }

    if (!data.country) {
        throw new Error("Country is required.");
    }

    if (!data.venue) {
        throw new Error("Venue is required.");
    }

    if (!data.address) {
        throw new Error("Address is required.");
    }

    if (!events || events.length === 0) {
        throw new Error("At least one event is required.");
    }

    const docRef = await addDoc(collection(db, "tournaments"), {
        registration_fee: data.registration_fee,
        member_registration_fee: data.member_registration_fee,
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        country: data.country,
        venue: data.venue,
        address: data.address,
        registration_start_date: data.registration_start_date,
        registration_end_date: data.registration_end_date,
        max_participants: data.max_participants,
        description: data.description ?? null,
        agenda: data.agenda ?? null,
        logo: data.logo ?? null,
        isDraft: data.isDraft ?? false,
        editor: data.editor ?? "",
        recorder: data.recorder ?? "",
        participants: 0,
        status: "Up Coming",
        created_at: Timestamp.now(),
    });

    // use shared isUUID function

    await Promise.all(
        events.map(async (event) => {
            const {id, ...restEvent} = event;
            if (typeof id === "string" && id.length > 0) {
                if (isUUID(id)) {
                    // Treat UUID as a client placeholder: create new doc, then update id field to the docRef.id
                    const docEventRef = await addDoc(collection(db, "events"), {
                        ...restEvent,
                        tournament_id: docRef.id,
                    });
                    await updateDoc(docEventRef, {id: docEventRef.id});
                } else {
                    // Non-UUID id assumed to be an existing Firestore doc id: update in place
                    await updateDoc(doc(db, "events", id), {
                        ...restEvent,
                        id,
                        tournament_id: docRef.id,
                    });
                }
            } else {
                // No id provided: create new doc and set its id field
                const docEventRef = await addDoc(collection(db, "events"), {
                    ...restEvent,
                    tournament_id: docRef.id,
                });
                await updateDoc(docEventRef, {id: docEventRef.id});
            }
        }),
    );

    return docRef.id;
}

export type TournamentWithEvents = Tournament & {events: TournamentEvent[]};

export async function fetchTournamentEvents(tournamentId: string): Promise<TournamentEvent[]> {
    const eventsQuery = query(collection(db, "events"), where("tournament_id", "==", tournamentId));
    const snapshot = await getDocs(eventsQuery);

    return snapshot.docs
        .map((docSnapshot) => {
            const raw = {id: docSnapshot.id, ...docSnapshot.data()} as Record<string, unknown>;
            if (raw.team_size != null && raw.teamSize == null) {
                raw.teamSize = raw.team_size;
            }
            if (raw.code == null && Array.isArray(raw.codes) && raw.codes.length === 1) {
                raw.code = raw.codes[0];
            }
            const parsed = EventSchema.safeParse(raw);
            if (!parsed.success) {
                console.warn(`Failed to parse event ${docSnapshot.id}`, parsed.error.flatten());
                return null;
            }

            return parsed.data;
        })
        .filter((event): event is TournamentEvent => event !== null)
        .map((event) => ({...event, tournament_id: event.tournament_id ?? tournamentId}));
}

export async function saveTournamentEvents(tournamentId: string, events: TournamentEvent[]): Promise<void> {
    const eventsCollection = collection(db, "events");
    const snapshot = await getDocs(query(eventsCollection, where("tournament_id", "==", tournamentId)));

    const incomingIds = new Set(events.map((event) => event.id).filter((id): id is string => typeof id === "string"));

    const deletions = snapshot.docs.filter((docSnapshot) => !incomingIds.has(docSnapshot.id));
    await Promise.all(deletions.map((docSnapshot) => deleteDoc(docSnapshot.ref)));

    const isUUID = (value: string): boolean => {
        // RFC4122 v4 UUID pattern
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidV4Regex.test(value);
    };

    await Promise.all(
        events.map(async (event) => {
            const {id, ...restEvent} = event;
            if (typeof id === "string" && id.length > 0) {
                if (isUUID(id)) {
                    // Treat UUID as a client placeholder: create new doc, then update id field to the docRef.id
                    const docRef = await addDoc(collection(db, "events"), {
                        ...restEvent,
                        tournament_id: tournamentId,
                    });
                    await updateDoc(docRef, {id: docRef.id});
                } else {
                    // Non-UUID id assumed to be an existing Firestore doc id: update in place
                    await updateDoc(doc(db, "events", id), {
                        ...restEvent,
                        id,
                        tournament_id: tournamentId,
                    });
                }
            } else {
                // No id provided: create new doc and set its id field
                const docRef = await addDoc(collection(db, "events"), {
                    ...restEvent,
                    tournament_id: tournamentId,
                });
                await updateDoc(docRef, {id: docRef.id});
            }
        }),
    );
}

export async function updateTournament(user: FirestoreUser, tournamentId: string, data: Omit<Tournament, "id">): Promise<void> {
    if (!user?.roles?.edit_tournament && !(user.global_id === data.editor || user.global_id === data.recorder)) {
        throw new Error("Unauthorized");
    }

    const tournamentRef = doc(db, "tournaments", tournamentId);
    const snap = await getDoc(tournamentRef);
    if (!snap.exists()) throw new Error("Tournament not found");

    const old = snap.data() as Tournament;
    const toUpdate: Partial<Record<keyof Tournament, Tournament[keyof Tournament]>> = {};

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
    toUpdate.status = data.status ?? old.status ?? "Up Coming";
    toUpdate.updated_at = Timestamp.now();
    if (Object.keys(toUpdate).length === 0) {
        // 完全没变化
        return;
    }

    await updateDoc(tournamentRef, toUpdate);
}

export async function fetchTournamentsByType(type: "current" | "history"): Promise<TournamentWithEvents[]> {
    try {
        const today = new Date();
        const todayTimestamp = Timestamp.fromDate(today);

        let tournamentsQuery: Query | null = null;

        if (type === "current") {
            tournamentsQuery = query(
                collection(db, "tournaments"),
                where("end_date", ">=", todayTimestamp),
                orderBy("end_date", "asc"),
            );
        } else if (type === "history") {
            tournamentsQuery = query(
                collection(db, "tournaments"),
                where("end_date", "<", todayTimestamp),
                orderBy("end_date", "desc"),
            );
        } else {
            throw new Error("Invalid tournament type");
        }

        const snapshot = await getDocs(tournamentsQuery);

        const tournaments = snapshot.docs
            .map((doc) => {
                const parsed = TournamentSchema.safeParse({
                    id: doc.id,
                    ...doc.data(),
                });

                if (!parsed.success) {
                    console.warn(`Failed to parse tournament ${doc.id}`, parsed.error.flatten());
                    return null;
                }

                return parsed.data;
            })
            .filter((tournament): tournament is Tournament => tournament !== null);

        return await Promise.all(
            tournaments.map(async (tournament) => {
                if (!tournament.id) {
                    return {...tournament, events: []};
                }
                const events = await fetchTournamentEvents(tournament.id);
                return {...tournament, events};
            }),
        );
    } catch (error) {
        console.error("Failed to fetch tournaments:", error);
        throw error;
    }
}

export async function fetchTournamentById(tournamentId: string): Promise<Tournament | null> {
    try {
        const docRef = doc(db, "tournaments", tournamentId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.info("Tournament document not found:", tournamentId);
            return null;
        }

        return docSnap.data() as Tournament;
    } catch (error) {
        console.error("Error fetching tournament:", error);
        throw error;
    }
}

export async function deleteTournamentById(user: FirestoreUser, tournamentId: string): Promise<void> {
    if (!user?.roles?.edit_tournament) {
        throw new Error("Unauthorized: You do not have permission to delete a tournament.");
    }

    try {
        // Delete all related data in sequence
        await deleteTournamentCascade(tournamentId);
    } catch (error) {
        console.error("Error deleting tournament:", error);
        throw error;
    }
}

async function deleteTournamentCascade(tournamentId: string): Promise<void> {
    // 1. Delete all registrations
    try {
        const registrationsQuery = query(collection(db, "registrations"), where("tournament_id", "==", tournamentId));
        const registrationsSnapshot = await getDocs(registrationsQuery);

        const registrationDeletePromises = registrationsSnapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref));

        await Promise.all(registrationDeletePromises);
    } catch (error) {
        console.error("Error deleting registrations:", error);
        throw new Error("Failed to delete tournament registrations");
    }

    // 2. Delete all teams
    try {
        const teamsQuery = query(collection(db, "teams"), where("tournament_id", "==", tournamentId));
        const teamsSnapshot = await getDocs(teamsQuery);

        const teamDeletePromises = teamsSnapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref));

        await Promise.all(teamDeletePromises);
    } catch (error) {
        console.error("Error deleting teams:", error);
        throw new Error("Failed to delete tournament teams");
    }

    // 3. Delete tournament records stored in records collections
    try {
        const [recordsSnapshot, overallRecordsSnapshot] = await Promise.all([
            getDocs(query(collection(db, "records"), where("tournament_id", "==", tournamentId))),
            getDocs(query(collection(db, "overall_records"), where("tournament_id", "==", tournamentId))),
        ]);

        const recordDeletePromises = [
            ...recordsSnapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref)),
            ...overallRecordsSnapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref)),
        ];

        await Promise.all(recordDeletePromises);
    } catch (error) {
        console.error("Error deleting tournament records:", error);
        throw new Error("Failed to delete tournament records");
    }

    // 4. Delete global result records (legacy/aggregated views)
    try {
        const globalResultTypes = ["Individual", "Team", "individual", "team"];
        const globalResultEvents = ["3-3-3", "3-6-3", "Cycle", "Overall"];

        for (const type of globalResultTypes) {
            for (const event of globalResultEvents) {
                const globalRef = collection(db, `globalResult/${type}/${event}`);
                const [byTournamentId, byLegacyId] = await Promise.all([
                    getDocs(query(globalRef, where("tournamentId", "==", tournamentId))),
                    getDocs(query(globalRef, where("tournament_id", "==", tournamentId))),
                ]);

                const docsById = new Map<string, (typeof byTournamentId.docs)[number]>();
                for (const docSnap of byTournamentId.docs) {
                    docsById.set(docSnap.id, docSnap);
                }
                for (const docSnap of byLegacyId.docs) {
                    docsById.set(docSnap.id, docSnap);
                }

                const deletePromises = Array.from(docsById.values()).map((docSnap) => deleteDoc(docSnap.ref));
                await Promise.all(deletePromises);
            }
        }
    } catch (error) {
        console.error("Error deleting global result records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 5. Delete scoring/results data if they exist in subcollections
    try {
        // Check for other subcollections like scores, finalists, etc.
        const subcollections = ["scores", "finalists", "results"];

        for (const subcollectionName of subcollections) {
            const subcollectionRef = collection(db, "tournaments", tournamentId, subcollectionName);
            const subcollectionSnapshot = await getDocs(subcollectionRef);

            if (subcollectionSnapshot.docs.length > 0) {
                const deletePromises = subcollectionSnapshot.docs.map((doc) => deleteDoc(doc.ref));

                await Promise.all(deletePromises);
            }
        }
    } catch (error) {
        console.error("Error deleting subcollection data:", error);
        // Don't throw here as these subcollections might not exist
    }

    // 6. Delete individual recruitment records
    try {
        const individualRecruitments = await getIndividualRecruitmentsByTournament(tournamentId);
        const individualDeletePromises = individualRecruitments.map((recruitment) => deleteIndividualRecruitment(recruitment.id));
        await Promise.all(individualDeletePromises);
    } catch (error) {
        console.error("Error deleting individual recruitment records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 7. Delete double recruitment records
    try {
        const doubleRecruitments = await getDoubleRecruitmentsByTournament(tournamentId);
        const doubleDeletePromises = doubleRecruitments.map((recruitment) => deleteDoubleRecruitment(recruitment.id));
        await Promise.all(doubleDeletePromises);
    } catch (error) {
        console.error("Error deleting double recruitment records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 8. Delete team recruitment records
    try {
        const teamRecruitments = await getActiveTeamRecruitments(tournamentId);
        const teamDeletePromises = teamRecruitments.map((recruitment) => deleteTeamRecruitment(recruitment.id));
        await Promise.all(teamDeletePromises);
    } catch (error) {
        console.error("Error deleting team recruitment records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 9. Clean up user registration records
    try {
        await removeUserRegistrationRecordsByTournament(tournamentId);
    } catch (error) {
        console.error("Error cleaning up user registration records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 10. Delete tournament events stored in the shared events collection
    try {
        const eventSnapshots = await getDocs(query(collection(db, "events"), where("tournament_id", "==", tournamentId)));
        const eventDeletePromises = eventSnapshots.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref));
        await Promise.all(eventDeletePromises);
    } catch (error) {
        console.error("Error deleting tournament events:", error);
        throw new Error("Failed to delete tournament events");
    }

    // 11. Delete all tournament storage files (agenda, logo, payment proofs, etc.)
    try {
        await deleteTournamentStorage(tournamentId);
    } catch (error) {
        console.error("Error deleting tournament storage files:", error);
        // Don't throw here as storage deletion shouldn't block tournament deletion
    }

    // 12. Finally, delete the tournament document itself
    try {
        const tournamentRef = doc(db, "tournaments", tournamentId);
        await deleteDoc(tournamentRef);
    } catch (error) {
        console.error("Error deleting tournament document:", error);
        throw new Error("Failed to delete tournament document");
    }
}

export async function createTeam(tournamentId: string, teamData: Omit<Team, "id" | "tournament_id">): Promise<string> {
    const teamsCollectionRef = collection(db, "teams");

    const memberIds = [teamData.leader_id, ...teamData.members.map((m) => m.global_id)].filter(Boolean) as string[];
    const ages: number[] = [];
    for (const id of memberIds) {
        const registrationQuery = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("user_id", "==", id),
        );
        const registrationSnapshot = await getDocs(registrationQuery);
        const registration = registrationSnapshot.docs[0]?.data() as Registration | undefined;
        if (registration?.age != null) {
            ages.push(registration.age);
        }
    }

    const docRef = await addDoc(teamsCollectionRef, {
        ...teamData,
        tournament_id: tournamentId,
        event_id: teamData.event_id ?? null,
    });
    await updateDoc(docRef, {id: docRef.id});
    return docRef.id;
}

export async function deleteTeam(teamId: string): Promise<void> {
    try {
        const teamRef = doc(db, "teams", teamId);
        const teamDoc = await getDoc(teamRef);

        if (!teamDoc.exists()) {
            throw new Error("Team not found");
        }

        await deleteDoc(teamRef);
    } catch (error) {
        console.error("Error deleting team:", error);
        throw error;
    }
}

export async function fetchTeamsByTournament(tournamentId: string): Promise<Team[]> {
    const teamsCollectionRef = collection(db, "teams");
    const q = query(teamsCollectionRef, where("tournament_id", "==", tournamentId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Team;
        return {...data, id: docSnap.id};
    });
}

export async function fetchTeamsByRegistrationId(registrationId: string): Promise<Team[]> {
    const teamsCollectionRef = collection(db, "teams");
    const q = query(teamsCollectionRef, where("registration_id", "==", registrationId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Team;
        return {...data, id: docSnap.id};
    });
}

export async function fetchTeamsLookingForMembers(tournamentId: string, eventFilter?: string): Promise<Team[]> {
    const teamsCollectionRef = collection(db, "teams");
    const q = query(teamsCollectionRef, where("looking_for_member", "==", true), where("tournament_id", "==", tournamentId));
    const snapshot = await getDocs(q);
    const teams = snapshot.docs.map((doc) => doc.data() as Team);
    if (!eventFilter) {
        return teams;
    }

    const trimmedFilter = eventFilter.trim();
    if (trimmedFilter.length === 0) {
        return teams;
    }

    const normalizedFilter = trimmedFilter.toLowerCase();

    return teams.filter((team) => {
        const eventId = typeof team.event_id === "string" ? team.event_id.trim().toLowerCase() : "";
        if (eventId && eventId === normalizedFilter) {
            return true;
        }

        const eventNames = Array.isArray(team.event) ? team.event : [];
        return eventNames.some((value) => value?.trim().toLowerCase() === normalizedFilter);
    });
}

export async function addMemberToTeam(tournamentId: string, teamId: string, memberId: string, verified = false): Promise<void> {
    try {
        const teamRef = doc(db, "teams", teamId);
        const teamDoc = await getDoc(teamRef);

        if (!teamDoc.exists()) {
            throw new Error("Team not found");
        }

        const team = teamDoc.data() as Team;

        // Ensure members array exists
        const members = team.members || [];

        // Check if member is already in the team
        const isAlreadyMember = members.some((member) => member.global_id === memberId) || team.leader_id === memberId;

        if (isAlreadyMember) {
            throw new Error("Member is already in this team");
        }

        // Add new member with verified status
        const newMember = {
            global_id: memberId,
            verified, // Use the verified parameter
        };

        const updatedMembers = [...members, newMember];

        await updateDoc(teamRef, {
            members: updatedMembers,
            looking_for_member: updatedMembers.length >= 3 ? false : team.looking_for_member, // Stop looking if team is full
        });
    } catch (error) {
        console.error("Error adding member to team:", error);
        throw error;
    }
}

export async function removeMemberFromTeam(teamId: string, memberId: string): Promise<void> {
    try {
        const teamRef = doc(db, "teams", teamId);
        const teamDoc = await getDoc(teamRef);

        if (!teamDoc.exists()) {
            throw new Error("Team not found");
        }

        const team = teamDoc.data() as Team;
        const members = team.members || [];
        const updatedMembers = members.filter((member) => member.global_id !== memberId);

        if (updatedMembers.length === members.length) {
            return;
        }

        await updateDoc(teamRef, {members: updatedMembers});
    } catch (error) {
        console.error("Error removing member from team:", error);
        throw error;
    }
}

export async function updateTeam(tournamentId: string, teamId: string, teamData: Team): Promise<void> {
    const teamRef = doc(db, "teams", teamId);

    const memberIds = [teamData.leader_id, ...teamData.members.map((m) => m.global_id)].filter(Boolean) as string[];
    const ages: number[] = [];

    // Normalize event names and get event ids (if present)
    const normalizedEventNames = Array.isArray(teamData.event)
        ? teamData.event
              .map((value) => (typeof value === "string" ? value.trim() : ""))
              .filter((value): value is string => value.length > 0)
        : [];
    // If event_id is present, use it, else fallback to normalizedEventNames
    const eventIds: string[] = [];
    if (typeof teamData.event_id === "string" && teamData.event_id.length > 0) {
        eventIds.push(teamData.event_id);
    } else if (Array.isArray(teamData.event_id)) {
        eventIds.push(...teamData.event_id.filter((e: string) => typeof e === "string" && e.length > 0));
    }
    // If no event_id, try to use normalizedEventNames as event ids (if they look like ids)
    if (eventIds.length === 0) {
        eventIds.push(...normalizedEventNames.filter((e) => e.length > 0));
    }

    // For each member, ensure their registration includes the event id(s)
    for (const id of memberIds) {
        const registrationQuery = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("user_id", "==", id),
        );
        const registrationSnapshot = await getDocs(registrationQuery);
        const registrationDoc = registrationSnapshot.docs[0];
        const registration = registrationDoc?.data() as Registration | undefined;
        if (registration?.age != null) {
            ages.push(registration.age);
        }
        if (registrationDoc && registration) {
            // Ensure registration.events_registered is an array
            const regEvents: string[] = Array.isArray(registration.events_registered)
                ? registration.events_registered.filter((e: string) => typeof e === "string" && e.length > 0)
                : [];
            let updated = false;
            for (const eid of eventIds) {
                if (!regEvents.includes(eid)) {
                    regEvents.push(eid);
                    updated = true;
                }
            }
            if (updated) {
                await updateDoc(registrationDoc.ref, {events_registered: regEvents});
            }
        }
    }

    const {id, tournament_id: _ignoredTournamentId, ...restTeamData} = teamData;
    const teamAge = restTeamData.team_age ?? (ages.length > 0 ? Math.max(...ages) : 0);

    await updateDoc(teamRef, {
        ...restTeamData,
        event: normalizedEventNames,
        team_age: teamAge,
        tournament_id: tournamentId,
    });
}

export async function updateTournamentStatus(
    user: FirestoreUser,
    tournamentId: string,
    status: "Up Coming" | "On Going" | "Close Registration" | "End",
): Promise<void> {
    if (!user?.roles?.edit_tournament) {
        throw new Error("Unauthorized: You do not have permission to update the tournament status.");
    }

    const tournamentRef = doc(db, "tournaments", tournamentId);
    await updateDoc(tournamentRef, {
        status: status,
        updated_at: Timestamp.now(),
    });
}
