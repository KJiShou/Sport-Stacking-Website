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
    updateDoc,
    where,
} from "firebase/firestore";
import type {FirestoreUser, Tournament} from "../../schema";
import {db} from "./config";

export async function createTournament(user: FirestoreUser, data: Omit<Tournament, "id">): Promise<string> {
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

    if (data.max_participants < 0) {
        throw new Error("Max participants must be greater than or equal 0.");
    }

    if (!data.events || data.events.length === 0) {
        throw new Error("At least one event is required.");
    }

    if (!data.final_criteria || data.final_criteria.length === 0) {
        throw new Error("At least one final criteria is required.");
    }

    if (!data.final_categories || data.final_categories.length === 0) {
        throw new Error("At least one final category is required.");
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

    const docRef = await addDoc(collection(db, "tournaments"), {
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        country: data.country,
        venue: data.venue,
        address: data.address,
        registration_start_date: data.registration_start_date,
        registration_end_date: data.registration_end_date,
        max_participants: data.max_participants,
        events: data.events,
        final_criteria: data.final_criteria,
        final_categories: data.final_categories,
        description: data.description ?? null,
        participants: 0, // 初始参与者数为0
        status: "Up Coming",
        created_at: Timestamp.now(),
    });

    return docRef.id;
}

export async function updateTournament(user: FirestoreUser, tournamentId: string, data: Omit<Tournament, "id">): Promise<void> {
    if (!user?.roles?.edit_tournament) {
        throw new Error("Unauthorized");
    }

    const tournamentRef = doc(db, "tournaments", tournamentId);
    const snap = await getDoc(tournamentRef);
    if (!snap.exists()) throw new Error("Tournament not found");

    const old = snap.data() as Tournament;
    const toUpdate: Partial<Record<keyof Tournament, Tournament[keyof Tournament]>> = {};

    // 对比字段，仅当值有变化（或有值）时才加入更新对象
    (Object.keys(data) as (keyof typeof data)[]).forEach((key) => {
        const newVal = data[key];
        const oldVal = old[key];
        // 简单比较，可根据需要做深度比较
        if (newVal !== undefined && JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
            toUpdate[key] = newVal;
        }
    });

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

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Tournament[];
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

        return {...docSnap.data()} as Tournament;
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
        const tournamentRef = doc(db, "tournaments", tournamentId);
        await deleteDoc(tournamentRef);
    } catch (error) {
        console.error("Error deleting tournament:", error);
        throw error;
    }
}
