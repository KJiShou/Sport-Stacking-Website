import {doc, getDoc, setDoc, Timestamp, updateDoc} from "firebase/firestore";
import type {FirestoreUser, Registration} from "../../schema";
import {db} from "./config";

export async function createRegistration(user: FirestoreUser, data: Omit<Registration, "id">): Promise<string> {
    if (!user?.id) {
        throw new Error("User global_id is missing.");
    }

    const docRef = doc(db, `tournaments/${data.tournament_id}/registrations/${user.id}`);

    // 确保 created_at / updated_at 都有填入
    const payload: Omit<Registration, "id"> = {
        ...data,
        created_at: data.created_at ?? Timestamp.now(),
        updated_at: Timestamp.now(),
    };

    await setDoc(docRef, payload);
    return user.id; // 直接返回 global_id 作为 document id
}

/**
 * 根据 tournamentId + user global_id fetch 用户报名资料
 */
export async function fetchUserRegistration(tournamentId: string, userId: string): Promise<Registration | null> {
    try {
        const regDoc = await getDoc(doc(db, `tournaments/${tournamentId}/registrations`, userId));
        console.log(5);
        if (regDoc.exists()) {
            return regDoc.data() as Registration;
        } else {
            return null;
        }
    } catch (err) {
        console.error("Error fetching user registration:", err);
        throw err;
    }
}

/**
 * 更新用户报名资料
 */
export async function updateRegistration(user: {id: string}, data: Registration): Promise<void> {
    if (!data.user_id) throw new Error("No user_id in registration data.");
    try {
        await updateDoc(doc(db, `tournaments/${data.tournament_id}/registrations`, data.user_id), data);
    } catch (err) {
        console.error("Error updating registration:", err);
        throw err;
    }
}
