// src/services/firebase/authService.ts

import {
    type Query,
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    deleteField,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type {FirestoreUser, Team, Tournament, TournamentEvent} from "../../schema";
import {EventSchema, TournamentSchema} from "../../schema";
import {removeUserRegistrationRecordsByTournament} from "./authService";
import {db} from "./config";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByTournament} from "./individualRecruitmentService";
import {deleteTournamentStorage} from "./storageService";
import {deleteTeamRecruitment, getActiveTeamRecruitments} from "./teamRecruitmentService";

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
        editor: data.editor ?? "",
        recorder: data.recorder ?? "",
        participants: 0,
        status: "Up Coming",
        created_at: Timestamp.now(),
    });

    events.map(async (event) => {
        await addDoc(collection(db, "events"), {
            ...event,
            tournament_id: docRef.id,
        });
    });

    return docRef.id;
}

export async function fetchTournamentEvents(tournamentId: string): Promise<TournamentEvent[]> {
    const eventsQuery = query(collection(db, "events"), where("tournament_id", "==", tournamentId));
    const snapshot = await getDocs(eventsQuery);

    return snapshot.docs
        .map((docSnapshot) => {
            const parsed = EventSchema.safeParse({id: docSnapshot.id, ...docSnapshot.data()});
            if (!parsed.success) {
                console.warn(`Failed to parse event ${docSnapshot.id}`, parsed.error.flatten());
                return null;
            }

            return parsed.data;
        })
        .filter((event): event is TournamentEvent => event !== null);
}

export async function saveTournamentEvents(tournamentId: string, events: TournamentEvent[]): Promise<void> {
    const eventsCollection = collection(db, "events");
    const snapshot = await getDocs(query(eventsCollection, where("tournament_id", "==", tournamentId)));

    const incomingIds = new Set(events.map((event) => event.id).filter((id): id is string => typeof id === "string"));

    const deletions = snapshot.docs.filter((docSnapshot) => !incomingIds.has(docSnapshot.id));
    await Promise.all(deletions.map((docSnapshot) => deleteDoc(docSnapshot.ref)));

    await Promise.all(
        events.map(async (event) => {
            const eventId = event.id && event.id.length > 0 ? event.id : crypto.randomUUID();
            await setDoc(doc(db, "events", eventId), {
                ...event,
                id: eventId,
                tournament_id: tournamentId,
            });
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

export async function fetchTournamentsByType(type: "current" | "history"): Promise<Tournament[]> {
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

        return snapshot.docs
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

        const parsed = TournamentSchema.safeParse({
            id: docSnap.id,
            ...docSnap.data(),
        });

        if (!parsed.success) {
            console.warn(`Tournament document failed validation: ${tournamentId}`, parsed.error.flatten());
            return null;
        }

        return parsed.data;
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
        const registrationsRef = collection(db, "tournaments", tournamentId, "registrations");
        const registrationsSnapshot = await getDocs(registrationsRef);

        const registrationDeletePromises = registrationsSnapshot.docs.map((doc) => deleteDoc(doc.ref));

        await Promise.all(registrationDeletePromises);
    } catch (error) {
        console.error("Error deleting registrations:", error);
        throw new Error("Failed to delete tournament registrations");
    }

    // 2. Delete all teams
    try {
        const teamsRef = collection(db, "tournaments", tournamentId, "teams");
        const teamsSnapshot = await getDocs(teamsRef);

        const teamDeletePromises = teamsSnapshot.docs.map((doc) => deleteDoc(doc.ref));

        await Promise.all(teamDeletePromises);
    } catch (error) {
        console.error("Error deleting teams:", error);
        throw new Error("Failed to delete tournament teams");
    }

    // 3. Delete scoring/results data if they exist in subcollections
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

    // 4. Delete individual recruitment records
    try {
        const individualRecruitments = await getIndividualRecruitmentsByTournament(tournamentId);
        const individualDeletePromises = individualRecruitments.map((recruitment) => deleteIndividualRecruitment(recruitment.id));
        await Promise.all(individualDeletePromises);
    } catch (error) {
        console.error("Error deleting individual recruitment records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 5. Delete team recruitment records
    try {
        const teamRecruitments = await getActiveTeamRecruitments(tournamentId);
        const teamDeletePromises = teamRecruitments.map((recruitment) => deleteTeamRecruitment(recruitment.id));
        await Promise.all(teamDeletePromises);
    } catch (error) {
        console.error("Error deleting team recruitment records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 6. Clean up user registration records
    try {
        await removeUserRegistrationRecordsByTournament(tournamentId);
    } catch (error) {
        console.error("Error cleaning up user registration records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }

    // 7. Delete tournament events stored in the shared events collection
    try {
        const eventSnapshots = await getDocs(query(collection(db, "events"), where("tournament_id", "==", tournamentId)));
        const eventDeletePromises = eventSnapshots.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref));
        await Promise.all(eventDeletePromises);
    } catch (error) {
        console.error("Error deleting tournament events:", error);
        throw new Error("Failed to delete tournament events");
    }

    // 8. Delete all tournament storage files (agenda, logo, payment proofs, etc.)
    try {
        await deleteTournamentStorage(tournamentId);
    } catch (error) {
        console.error("Error deleting tournament storage files:", error);
        // Don't throw here as storage deletion shouldn't block tournament deletion
    }

    // 9. Finally, delete the tournament document itself
    try {
        const tournamentRef = doc(db, "tournaments", tournamentId);
        await deleteDoc(tournamentRef);
    } catch (error) {
        console.error("Error deleting tournament document:", error);
        throw new Error("Failed to delete tournament document");
    }
}

export async function createTeam(tournamentId: string, teamData: Omit<Team, "id" | "tournament_id">): Promise<string> {
    const teamsCollectionRef = collection(db, "tournaments", tournamentId, "teams");

    const memberIds = [teamData.leader_id, ...teamData.members.map((m) => m.global_id)];
    const ages: number[] = [];
    for (const id of memberIds) {
        const regDoc = await getDoc(doc(db, `tournaments/${tournamentId}/registrations`, id));
        if (regDoc.exists()) {
            const reg = regDoc.data();
            if (reg?.age) {
                ages.push(reg.age);
            }
        }
    }

    const {events, event_ids, ...restTeamData} = teamData;
    const normalizedEventIds = Array.from(new Set(event_ids?.length ? event_ids : (events ?? [])));

    const docRef = await addDoc(teamsCollectionRef, {
        ...restTeamData,
        event_ids: normalizedEventIds,
        tournament_id: tournamentId,
    });
    await updateDoc(docRef, {id: docRef.id});
    return docRef.id;
}

export async function fetchTeamsByTournament(tournamentId: string): Promise<Team[]> {
    const teamsCollectionRef = collection(db, "tournaments", tournamentId, "teams");
    const snapshot = await getDocs(teamsCollectionRef);
    return snapshot.docs.map((doc) => doc.data() as Team);
}

export async function fetchTeamsLookingForMembers(tournamentId: string, eventFilter?: string): Promise<Team[]> {
    const teamsCollectionRef = collection(db, "tournaments", tournamentId, "teams");
    const q = query(teamsCollectionRef, where("looking_for_member", "==", true));
    const snapshot = await getDocs(q);
    const teams = snapshot.docs.map((doc) => doc.data() as Team);
    if (!eventFilter) {
        return teams;
    }

    return teams.filter((team) => {
        const eventIds = team.event_ids ?? [];
        if (eventIds.includes(eventFilter)) {
            return true;
        }

        return (team.events ?? []).includes(eventFilter);
    });
}

export async function addMemberToTeam(tournamentId: string, teamId: string, memberId: string): Promise<void> {
    try {
        const teamRef = doc(db, "tournaments", tournamentId, "teams", teamId);
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

        // Add new member
        const newMember = {
            global_id: memberId,
            verified: false, // Will need verification
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

export async function updateTeam(tournamentId: string, teamId: string, teamData: Team): Promise<void> {
    const teamRef = doc(db, "tournaments", tournamentId, "teams", teamId);

    const memberIds = [teamData.leader_id, ...teamData.members.map((m) => m.global_id)];
    const ages: number[] = [];
    for (const id of memberIds) {
        const regDoc = await getDoc(doc(db, `tournaments/${tournamentId}/registrations`, id));
        if (regDoc.exists()) {
            const reg = regDoc.data();
            if (reg?.age) {
                ages.push(reg.age);
            }
        }
    }

    const {events, event_ids, ...restTeamData} = teamData;
    const normalizedEventIds = Array.from(new Set(event_ids?.length ? event_ids : (events ?? [])));

    await updateDoc(teamRef, {
        ...restTeamData,
        event_ids: normalizedEventIds,
        events: deleteField(),
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
