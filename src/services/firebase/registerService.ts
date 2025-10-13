import {Timestamp, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where} from "firebase/firestore";
import type {FirestoreUser, Registration} from "../../schema";
import {db} from "./config";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByParticipant} from "./individualRecruitmentService";
import {deleteTeamRecruitment, getTeamRecruitmentsByLeader} from "./teamRecruitmentService";

export async function createRegistration(
    user: FirestoreUser,
    data: Omit<Registration, "id" | "registrationFee" | "memberRegistrationFee">,
): Promise<string> {
    if (!user?.id) {
        throw new Error("User global_id is missing.");
    }

    const tournamentDoc = await getDoc(doc(db, `tournaments/${data.tournament_id}`));
    const tournament = tournamentDoc.data();
    if (!tournament) {
        throw new Error("Tournament not found");
    }

    const docRef = doc(db, `tournaments/${data.tournament_id}/registrations/${user.id}`);

    // 确保 created_at / updated_at 都有填入
    const payload: Omit<Registration, "id"> = {
        ...data,
        registrationFee: tournament.registration_fee,
        memberRegistrationFee: tournament.member_registration_fee,
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
        const registrationRef = doc(db, `tournaments/${tournamentId}/registrations`, registrationId);
        const regSnap = await getDoc(registrationRef);
        if (!regSnap.exists()) {
            throw new Error("Registration not found");
        }
        const registrationData = regSnap.data() as Registration;
        const userId = registrationId;

        // Delete associated teams
        const teamsRef = collection(db, `tournaments/${tournamentId}/teams`);
        const q = query(teamsRef, where("leader_id", "==", registrationData.user_id));
        const querySnapshot = await getDocs(q);
        for (const doc of querySnapshot.docs) {
            await deleteDoc(doc.ref);
        }

        // Delete associated individual recruitment records
        try {
            const recruitments = await getIndividualRecruitmentsByParticipant(registrationData.user_id);
            const tournamentRecruitments = recruitments.filter((recruitment) => recruitment.tournament_id === tournamentId);
            for (const recruitment of tournamentRecruitments) {
                await deleteIndividualRecruitment(recruitment.id);
            }
        } catch (recruitmentError) {
            console.error("Error deleting individual recruitment records:", recruitmentError);
            // Don't throw error here to avoid breaking the main deletion flow
        }

        // Delete associated team recruitment records
        try {
            const teamRecruitments = await getTeamRecruitmentsByLeader(registrationData.user_id);
            const tournamentTeamRecruitments = teamRecruitments.filter(
                (recruitment) => recruitment.tournament_id === tournamentId,
            );
            for (const recruitment of tournamentTeamRecruitments) {
                await deleteTeamRecruitment(recruitment.id);
            }
        } catch (teamRecruitmentError) {
            console.error("Error deleting team recruitment records:", teamRecruitmentError);
            // Don't throw error here to avoid breaking the main deletion flow
        }

        // Delete the registration document
        await deleteDoc(registrationRef);

        // Remove the registration record from the user's document
        if (userId) {
            const userRef = doc(db, "users", userId);
            const userSnap = await getDoc(userRef);
            if (userSnap.exists()) {
                const userData = userSnap.data() as FirestoreUser;
                const updatedRecords =
                    userData.registration_records?.filter((record) => record.tournament_id !== tournamentId) ?? [];
                await updateDoc(userRef, {registration_records: updatedRecords});
            }
        }
    } catch (error) {
        console.error("Error deleting registration:", error);
        throw error;
    }
}
