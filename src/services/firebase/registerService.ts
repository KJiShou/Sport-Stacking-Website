import {Timestamp, doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc} from "firebase/firestore";
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

export async function fetchRegistrationById(tournamentId: string, registrationId: string): Promise<Registration | null> {
    try {
        const regDoc = await getDoc(doc(db, `tournaments/${tournamentId}/registrations`, registrationId));
        if (regDoc.exists()) {
            return regDoc.data() as Registration;
        }
        return null;
    } catch (err) {
        console.error("Error fetching registration by ID:", err);
        throw err;
    }
}

export async function fetchRegistrations(tournamentId: string): Promise<Registration[]> {
    try {
        const registrations: Registration[] = [];

        const registrationsRef = collection(db, `tournaments/${tournamentId}/registrations`);
        const querySnapshot = await getDocs(registrationsRef);

        for (const doc of querySnapshot.docs) {
            const data = doc.data() as Registration;
            registrations.push({
                ...data,
                id: doc.id, // 添加 Firestore 自动生成的 ID
            });
        }

        return registrations;
    } catch (err) {
        console.error("Error fetching registrations:", err);
        throw err;
    }
}

/**
 * 根据 tournamentId + user global_id fetch 用户报名资料
 */
export async function fetchUserRegistration(tournamentId: string, userId: string): Promise<Registration | null> {
    try {
        const regDoc = await getDoc(doc(db, `tournaments/${tournamentId}/registrations`, userId));
        if (regDoc.exists()) {
            return regDoc.data() as Registration;
        }
        return null;
    } catch (err) {
        console.error("Error fetching user registration:", err);
        throw err;
    }
}

/**
 * 更新用户报名资料
 */

export async function updateRegistration(data: Registration): Promise<void> {
    if (!data.user_id) throw new Error("No user_id in registration data.");

    const registrationRef = doc(db, `tournaments/${data.tournament_id}/registrations`, data.id);
    const snap = await getDoc(registrationRef);
    if (!snap.exists()) throw new Error("Registration not found");

    const old = snap.data() as Registration;
    const toUpdate: Partial<Record<keyof Registration, Registration[keyof Registration]>> = {};

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
    toUpdate.updated_at = Timestamp.now();
    if (Object.keys(toUpdate).length === 0) {
        // 完全没变化
        return;
    }

    await updateDoc(registrationRef, toUpdate);
}

export async function deleteRegistrationById(tournamentId: string, registrationId: string): Promise<void> {
    try {
        const tournamentRef = doc(db, `tournaments/${tournamentId}/registrations`, registrationId);
        await deleteDoc(tournamentRef);
    } catch (error) {
        console.error("Error deleting registration:", error);
        throw error;
    }
}
