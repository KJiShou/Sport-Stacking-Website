// src/services/firebase/authService.ts

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    updateDoc,
    Timestamp,
    addDoc,
    orderBy,
    type Query,
    deleteDoc,
} from "firebase/firestore";
import type { Competition, FirestoreUser } from "../../schema";
import { db } from "./config";

export async function createCompetition(user: FirestoreUser, data: Omit<Competition, "id">): Promise<string> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to create a competition.");
    }

    if (!data.name) {
        throw new Error("Competition name is required.");
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

    if (data.registration_start_date < data.start_date || data.registration_end_date > data.end_date) {
        throw new Error("Registration dates must be within the competition dates.");
    }

    if (data.max_participants <= 0) {
        throw new Error("Max participants must be greater than 0.");
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

    if (!data.address) {
        throw new Error("Address is required.");
    }

    const docRef = await addDoc(collection(db, "competitions"), {
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        country: data.country,
        address: data.address,
        registration_start_date: data.registration_start_date,
        registration_end_date: data.registration_end_date,
        max_participants: data.max_participants,
        events: data.events,
        final_criteria: data.final_criteria,
        final_categories: data.final_categories,
        status: "Up Coming",
        created_at: Timestamp.now(),
    });

    return docRef.id;
}

export async function updateCompetition(
    user: FirestoreUser,
    competitionId: string,
    data: Omit<Competition, "id">,
): Promise<void> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized");
    }

    const competitionRef = doc(db, "competitions", competitionId);
    const snap = await getDoc(competitionRef);
    if (!snap.exists()) throw new Error("Competition not found");

    const old = snap.data() as Competition;
    const toUpdate: Partial<Record<keyof Competition, Competition[keyof Competition]>> = {};

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

    await updateDoc(competitionRef, toUpdate);
}

export async function fetchCompetitionsByType(type: "current" | "history"): Promise<Competition[]> {
    try {
        const today = new Date();
        const todayTimestamp = Timestamp.fromDate(today);

        let competitionsQuery: Query | null = null;

        if (type === "current") {
            competitionsQuery = query(
                collection(db, "competitions"),
                where("end_date", ">=", todayTimestamp),
                orderBy("end_date", "asc"),
            );
        } else if (type === "history") {
            competitionsQuery = query(
                collection(db, "competitions"),
                where("end_date", "<", todayTimestamp),
                orderBy("end_date", "desc"),
            );
        } else {
            throw new Error("Invalid competition type");
        }

        const snapshot = await getDocs(competitionsQuery);

        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as Competition[];
    } catch (error) {
        console.error("Failed to fetch competitions:", error);
        throw error;
    }
}

export async function fetchCompetitionById(competitionId: string): Promise<Competition | null> {
    try {
        const docRef = doc(db, "competitions", competitionId);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            console.info("Competition document not found:", competitionId);
            return null;
        }

        return { ...docSnap.data() } as Competition;
    } catch (error) {
        console.error("Error fetching competition:", error);
        throw error;
    }
}

export async function deleteCompetitionById(user: FirestoreUser, competitionId: string): Promise<void> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to delete a competition.");
    }

    try {
        const competitionRef = doc(db, "competitions", competitionId);
        await deleteDoc(competitionRef);
    } catch (error) {
        console.error("Error deleting competition:", error);
        throw error;
    }
}
