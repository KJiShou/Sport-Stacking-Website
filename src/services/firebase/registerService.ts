import {collection, Timestamp, addDoc} from "firebase/firestore";
import type {FirestoreUser, Registration} from "../../schema";
import {db} from "./config";

export async function createRegistration(user: FirestoreUser, data: Omit<Registration, "id">): Promise<string> {
    if (!user?.roles?.edit_tournament) {
        throw new Error("Unauthorized: You do not have permission to create a tournament.");
    }

    const docRef = await addDoc(collection(db, `tournaments/${data.tournament_id}/registrations`), {
        registered_at: Timestamp.now(),
    });

    return docRef.id;
}
