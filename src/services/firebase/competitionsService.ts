// src/services/firebase/authService.ts
import type {User} from "firebase/auth";
import {
    createUserWithEmailAndPassword,
    EmailAuthProvider,
    GoogleAuthProvider,
    reauthenticateWithCredential,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updatePassword,
} from "firebase/auth";
import type {DocumentData, QueryDocumentSnapshot, QuerySnapshot} from "firebase/firestore";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    runTransaction,
    setDoc,
    where,
    updateDoc,
    Timestamp,
    addDoc,
    orderBy,
} from "firebase/firestore";
import type {Competition, FirestoreUser} from "../../schema";
import {FirestoreUserSchema} from "../../schema";
import {auth, db} from "./config";

export async function createCompetition(user: FirestoreUser, data: Omit<Competition, "id">): Promise<string> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to create a competition.");
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
        age_brackets: data.age_brackets,
        events: data.events,
        final_criteria: data.final_criteria,
        final_categories: data.final_categories,
        status: "Up Coming",
    });

    return docRef.id;
}

export async function updateCompetition(
    user: FirestoreUser,
    competitionId: string,
    data: Omit<Competition, "id">,
): Promise<void> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to update a competition.");
    }

    const competitionRef = doc(db, "competitions", competitionId);

    await updateDoc(competitionRef, {
        name: data.name,
        start_date: data.start_date,
        end_date: data.end_date,
        country: data.country,
        address: data.address,
        registration_start_date: data.registration_start_date,
        registration_end_date: data.registration_end_date,
        max_participants: data.max_participants,
        age_brackets: data.age_brackets,
        events: data.events,
        final_criteria: data.final_criteria,
        final_categories: data.final_categories,
        status: data.status ?? "Up Coming",
    });
}

export async function fetchCompetitionsByType(type: "current" | "history"): Promise<Competition[]> {
    try {
        const today = new Date();
        const todayTimestamp = Timestamp.fromDate(today);

        let competitionsQuery;

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
