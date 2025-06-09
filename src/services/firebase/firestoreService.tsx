import {db} from "./config";
import {collection, addDoc, getDocs} from "firebase/firestore";

import {TournamentSchema, type Tournament} from "@/schema";

const collectionRef = collection(db, "tournaments");

export async function getTournaments(): Promise<Tournament[]> {
    const snapshot = await getDocs(collectionRef);

    return snapshot.docs
        .map((docSnap) => {
            const data = {id: docSnap.id, ...docSnap.data()};

            // Zod 验证
            const parsed = TournamentSchema.safeParse(data);
            if (!parsed.success) {
                console.warn(`Invalid tournament data for ID ${docSnap.id}:`, parsed.error.format());
                return null;
            }

            return parsed.data;
        })
        .filter(Boolean) as Tournament[];
}

export async function addTournament(data: Omit<Tournament, "id">): Promise<string> {
    // 验证数据结构
    TournamentSchema.omit({id: true}).parse(data);

    const docRef = await addDoc(collectionRef, data);
    return docRef.id;
}
