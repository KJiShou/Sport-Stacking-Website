import {addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where} from "firebase/firestore";
import type {DoubleRecruitment} from "../../schema/DoubleRecruitmentSchema";
import {db} from "./config";

const DOUBLE_RECRUITMENT_COLLECTION = "double_recruitment";

export async function createDoubleRecruitment(data: Omit<DoubleRecruitment, "id" | "created_at" | "status">): Promise<string> {
    try {
        const recruitmentData = {
            ...data,
            created_at: new Date(),
            status: "active" as const,
        };

        const docRef = await addDoc(collection(db, DOUBLE_RECRUITMENT_COLLECTION), recruitmentData);
        return docRef.id;
    } catch (error) {
        console.error("Error creating double recruitment:", error);
        throw error;
    }
}

export async function getDoubleRecruitmentsByTournament(tournamentId: string): Promise<DoubleRecruitment[]> {
    try {
        const q = query(
            collection(db, DOUBLE_RECRUITMENT_COLLECTION),
            where("tournament_id", "==", tournamentId),
            where("status", "==", "active"),
        );
        const querySnapshot = await getDocs(q);
        const results = querySnapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
        })) as DoubleRecruitment[];

        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime();
        });
    } catch (error) {
        console.error("Error fetching double recruitments:", error);
        throw error;
    }
}

export async function getAllDoubleRecruitments(): Promise<DoubleRecruitment[]> {
    try {
        const querySnapshot = await getDocs(collection(db, DOUBLE_RECRUITMENT_COLLECTION));
        const results = querySnapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
        })) as DoubleRecruitment[];

        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime();
        });
    } catch (error) {
        console.error("Error fetching all double recruitments:", error);
        throw error;
    }
}

export async function getDoubleRecruitmentsByParticipant(participantId: string): Promise<DoubleRecruitment[]> {
    try {
        const q = query(collection(db, DOUBLE_RECRUITMENT_COLLECTION), where("participant_id", "==", participantId));
        const querySnapshot = await getDocs(q);
        const results = querySnapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
        })) as DoubleRecruitment[];

        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime();
        });
    } catch (error) {
        console.error("Error fetching participant double recruitments:", error);
        throw error;
    }
}

export async function updateDoubleRecruitmentStatus(
    recruitmentId: string,
    status: "active" | "matched" | "closed",
    matchedPartnerId?: string,
    matchedTeamId?: string,
): Promise<void> {
    try {
        const recruitmentRef = doc(db, DOUBLE_RECRUITMENT_COLLECTION, recruitmentId);
        const updateData: Partial<DoubleRecruitment> = {
            status,
            updated_at: new Date(),
        };

        if (matchedPartnerId) {
            updateData.matched_partner_id = matchedPartnerId;
        }
        if (matchedTeamId) {
            updateData.matched_team_id = matchedTeamId;
        }

        await updateDoc(recruitmentRef, updateData);
    } catch (error) {
        console.error("Error updating double recruitment status:", error);
        throw error;
    }
}

export async function deleteDoubleRecruitment(recruitmentId: string): Promise<void> {
    try {
        const recruitmentRef = doc(db, DOUBLE_RECRUITMENT_COLLECTION, recruitmentId);
        await deleteDoc(recruitmentRef);
    } catch (error) {
        console.error("Error deleting double recruitment:", error);
        throw error;
    }
}

export async function getDoubleRecruitmentById(recruitmentId: string): Promise<DoubleRecruitment | null> {
    try {
        const recruitmentRef = doc(db, DOUBLE_RECRUITMENT_COLLECTION, recruitmentId);
        const recruitmentSnap = await getDoc(recruitmentRef);
        if (recruitmentSnap.exists()) {
            return {
                id: recruitmentSnap.id,
                ...recruitmentSnap.data(),
            } as DoubleRecruitment;
        }
        return null;
    } catch (error) {
        console.error("Error fetching double recruitment:", error);
        throw error;
    }
}
