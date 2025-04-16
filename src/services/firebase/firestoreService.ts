import {db} from "./config";
import {collection, addDoc, getDocs} from "firebase/firestore";
import {Athlete} from "../../types";

import {CompetitionSchema, type Competition} from "@/schema";

const collectionRef = collection(db, "competitions");

export async function getCompetitions(): Promise<Competition[]> {
    const snapshot = await getDocs(collectionRef);

    return snapshot.docs
        .map((docSnap) => {
            const data = {id: docSnap.id, ...docSnap.data()};

            // Zod 验证
            const parsed = CompetitionSchema.safeParse(data);
            if (!parsed.success) {
                console.warn(`Invalid competition data for ID ${docSnap.id}:`, parsed.error.format());
                return null;
            }

            return parsed.data;
        })
        .filter(Boolean) as Competition[];
}

export async function addCompetition(data: Omit<Competition, "id">): Promise<string> {
    // 验证数据结构
    CompetitionSchema.omit({id: true}).parse(data);

    const docRef = await addDoc(collectionRef, data);
    return docRef.id;
}
