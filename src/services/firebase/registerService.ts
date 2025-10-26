import {
    Timestamp,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where,
    addDoc,
} from "firebase/firestore";
import type {FirestoreUser, Registration, Team} from "../../schema";
import {db} from "./config";
import {deleteIndividualRecruitment, getIndividualRecruitmentsByParticipant} from "./individualRecruitmentService";
import {deleteTeamRecruitment, getTeamRecruitmentsByLeader} from "./teamRecruitmentService";

export async function createRegistration(user: FirestoreUser, data: Registration): Promise<string> {
    if (!user?.id) {
        throw new Error("User global_id is missing.");
    }

    if (!data.user_id) {
        throw new Error("User id is required in registration payload.");
    }

    const tournamentDoc = await getDoc(doc(db, "tournaments", data.tournament_id));
    const tournament = tournamentDoc.data();
    if (!tournament) {
        throw new Error("Tournament not found");
    }

    // 确保 created_at / updated_at 都有填入
    const payload: Omit<Registration, "id"> = {
        ...data,
        created_at: data.created_at ?? Timestamp.now(),
        updated_at: Timestamp.now(),
    };

    const ref = await addDoc(collection(db, "registrations"), {
        ...data,
        created_at: data.created_at ?? Timestamp.now(),
        updated_at: Timestamp.now(),
    });
    return ref.id;
}

export async function fetchRegistrationById(tournamentId: string, registrationId: string): Promise<Registration | null> {
    try {
        const regDoc = await getDoc(doc(db, "registrations", registrationId));
        if (regDoc.exists()) {
            const data = regDoc.data() as Registration;
            if (data.tournament_id !== tournamentId) {
                return null;
            }
            return {
                ...data,
                id: regDoc.id,
            };
        }
        return null;
    } catch (err) {
        console.error("Error fetching registration by ID:", err);
        throw err;
    }
}

export async function fetchApprovedRegistrations(tournamentId: string): Promise<Registration[]> {
    try {
        const registrationsRef = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("registration_status", "==", "approved"),
        );
        const querySnapshot = await getDocs(registrationsRef);

        return querySnapshot.docs.map((docSnap) => ({
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        }));
    } catch (err) {
        console.error("Error fetching registrations:", err);
        throw err;
    }
}

export async function fetchRegistrations(tournamentId: string): Promise<Registration[]> {
    try {
        const registrationsRef = query(collection(db, "registrations"), where("tournament_id", "==", tournamentId));
        const querySnapshot = await getDocs(registrationsRef);

        return querySnapshot.docs.map((docSnap) => ({
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        }));
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
        const regQuery = query(
            collection(db, "registrations"),
            where("tournament_id", "==", tournamentId),
            where("user_global_id", "==", userId),
        );
        const querySnapshot = await getDocs(regQuery);
        if (querySnapshot.empty) {
            return null;
        }
        const docSnap = querySnapshot.docs[0];
        return {
            ...(docSnap.data() as Registration),
            id: docSnap.id,
        };
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
    if (!data.tournament_id) throw new Error("No tournament_id in registration data.");
    if (!data.id) throw new Error("No registration id provided.");

    const registrationRef = doc(db, "registrations", data.id);
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
        let registrationRef = doc(db, "registrations", registrationId);
        let regSnap = await getDoc(registrationRef);

        if (!regSnap.exists()) {
            const fallbackQuery = query(
                collection(db, "registrations"),
                where("tournament_id", "==", tournamentId),
                where("user_id", "==", registrationId),
            );
            const fallbackSnapshot = await getDocs(fallbackQuery);

            if (fallbackSnapshot.empty) {
                throw new Error("Registration not found");
            }

            registrationRef = fallbackSnapshot.docs[0].ref;
            regSnap = fallbackSnapshot.docs[0];
        }

        const registrationData = regSnap.data() as Registration;
        const userId = registrationData.user_id;

        // Delete associated teams
        const teamsRef = collection(db, "teams");
        const teamsSnapshot = await getDocs(query(teamsRef, where("tournament_id", "==", tournamentId)));
        for (const teamDoc of teamsSnapshot.docs) {
            const team = teamDoc.data() as Team;
            const memberIds = (team.members ?? []).map((member) => member.global_id);
            if (team.leader_id === registrationData.user_global_id) {
                await deleteDoc(teamDoc.ref);
            } else if (memberIds.includes(registrationData.user_global_id)) {
                // 如果用户是队员，则将其从队伍中移除
                const updatedMembers = (team.members ?? []).filter(
                    (member) => member.global_id !== registrationData.user_global_id,
                );
                await updateDoc(teamDoc.ref, {members: updatedMembers});
            }
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
