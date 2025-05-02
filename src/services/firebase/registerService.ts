
import {
    collection,
    Timestamp,
    addDoc,
} from "firebase/firestore";
import type { FirestoreUser, Registration } from "../../schema";
import { db } from "./config";

export async function createRegistration(user: FirestoreUser, data: Omit<Registration, "id">): Promise<string> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to create a competition.");
    }

    const docRef = await addDoc(collection(db, `competitions/${data.competition_id}/registrations`), {
        registered_at: Timestamp.now(),
    });

    return docRef.id;
}
