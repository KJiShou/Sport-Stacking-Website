import {addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, updateDoc, where} from "firebase/firestore";
import type {IndividualRecruitment} from "../../schema/IndividualRecruitmentSchema";
import {db} from "./config";

const INDIVIDUAL_RECRUITMENT_COLLECTION = "individual_recruitment";

// Create a new individual recruitment record
export async function createIndividualRecruitment(
    data: Omit<IndividualRecruitment, "id" | "created_at" | "status">,
): Promise<string> {
    try {
        const recruitmentData = {
            ...data,
            created_at: new Date(),
            status: "active" as const,
        };

        const docRef = await addDoc(collection(db, INDIVIDUAL_RECRUITMENT_COLLECTION), recruitmentData);
        return docRef.id;
    } catch (error) {
        console.error("Error creating individual recruitment:", error);
        throw error;
    }
}

// Get all active individual recruitments for a tournament
export async function getIndividualRecruitmentsByTournament(tournamentId: string): Promise<IndividualRecruitment[]> {
    try {
        const q = query(
            collection(db, INDIVIDUAL_RECRUITMENT_COLLECTION),
            where("tournament_id", "==", tournamentId),
            where("status", "==", "active"),
        );
        const querySnapshot = await getDocs(q);
        const results = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as IndividualRecruitment[];

        // Sort by created_at in memory to avoid composite index requirement
        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime(); // Descending order
        });
    } catch (error) {
        console.error("Error fetching individual recruitments:", error);
        throw error;
    }
}

// Get all individual recruitments (for admin overview)
export async function getAllIndividualRecruitments(): Promise<IndividualRecruitment[]> {
    try {
        const querySnapshot = await getDocs(collection(db, INDIVIDUAL_RECRUITMENT_COLLECTION));
        const results = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as IndividualRecruitment[];

        // Sort by created_at in memory
        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime(); // Descending order
        });
    } catch (error) {
        console.error("Error fetching all individual recruitments:", error);
        throw error;
    }
}

// Get individual recruitments by participant
export async function getIndividualRecruitmentsByParticipant(participantId: string): Promise<IndividualRecruitment[]> {
    try {
        const q = query(collection(db, INDIVIDUAL_RECRUITMENT_COLLECTION), where("participant_id", "==", participantId));
        const querySnapshot = await getDocs(q);
        const results = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as IndividualRecruitment[];

        // Sort by created_at in memory
        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime(); // Descending order
        });
    } catch (error) {
        console.error("Error fetching participant recruitments:", error);
        throw error;
    }
}

// Update individual recruitment status (when matched to team)
export async function updateIndividualRecruitmentStatus(
    recruitmentId: string,
    status: "active" | "matched" | "closed",
    matchedTeamId?: string,
): Promise<void> {
    try {
        const recruitmentRef = doc(db, INDIVIDUAL_RECRUITMENT_COLLECTION, recruitmentId);
        const updateData: Partial<IndividualRecruitment> = {
            status,
            updated_at: new Date(),
        };

        if (matchedTeamId) {
            updateData.matched_team_id = matchedTeamId;
        }

        await updateDoc(recruitmentRef, updateData);
    } catch (error) {
        console.error("Error updating individual recruitment status:", error);
        throw error;
    }
}

// Delete individual recruitment record
export async function deleteIndividualRecruitment(recruitmentId: string): Promise<void> {
    try {
        const recruitmentRef = doc(db, INDIVIDUAL_RECRUITMENT_COLLECTION, recruitmentId);
        await deleteDoc(recruitmentRef);
    } catch (error) {
        console.error("Error deleting individual recruitment:", error);
        throw error;
    }
}

// Get individual recruitment by ID
export async function getIndividualRecruitmentById(recruitmentId: string): Promise<IndividualRecruitment | null> {
    try {
        const recruitmentRef = doc(db, INDIVIDUAL_RECRUITMENT_COLLECTION, recruitmentId);
        const recruitmentSnap = await getDoc(recruitmentRef);

        if (recruitmentSnap.exists()) {
            return {
                id: recruitmentSnap.id,
                ...recruitmentSnap.data(),
            } as IndividualRecruitment;
        }
        return null;
    } catch (error) {
        console.error("Error fetching individual recruitment:", error);
        throw error;
    }
}

// Get recruitments by tournament and events
export async function getIndividualRecruitmentsByTournamentAndEvents(
    tournamentId: string,
    events: string[],
): Promise<IndividualRecruitment[]> {
    try {
        const q = query(
            collection(db, INDIVIDUAL_RECRUITMENT_COLLECTION),
            where("tournament_id", "==", tournamentId),
            where("status", "==", "active"),
            where("events_interested", "array-contains-any", events),
        );
        const querySnapshot = await getDocs(q);
        const results = querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as IndividualRecruitment[];

        // Sort by created_at in memory
        return results.sort((a, b) => {
            const dateA = a.created_at instanceof Date ? a.created_at : new Date(a.created_at);
            const dateB = b.created_at instanceof Date ? b.created_at : new Date(b.created_at);
            return dateB.getTime() - dateA.getTime(); // Descending order
        });
    } catch (error) {
        console.error("Error fetching recruitments by events:", error);
        throw error;
    }
}
