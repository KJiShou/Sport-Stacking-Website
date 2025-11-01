// Update team recruitment's max_members_needed and status
export async function updateTeamRecruitmentMembersNeeded(
    recruitmentId: string,
    max_members_needed: number,
    status: "active" | "closed",
) {
    try {
        const recruitmentRef = doc(db, TEAM_RECRUITMENT_COLLECTION, recruitmentId);
        await import("firebase/firestore").then(({updateDoc}) => updateDoc(recruitmentRef, {max_members_needed, status}));
    } catch (error) {
        console.error("Error updating team recruitment members needed:", error);
        throw error;
    }
}
import {addDoc, collection, deleteDoc, doc, getDocs, query, where} from "firebase/firestore";
import type {TeamRecruitment} from "../../schema/TeamRecruitmentSchema";
import {db} from "./config";

const TEAM_RECRUITMENT_COLLECTION = "team_recruitment";

export async function createTeamRecruitment(data: Omit<TeamRecruitment, "id" | "created_at" | "status">) {
    try {
        const recruitmentData = {
            ...data,
            created_at: new Date(),
            status: "active",
        };

        const docRef = await addDoc(collection(db, TEAM_RECRUITMENT_COLLECTION), recruitmentData);
        return docRef.id;
    } catch (error) {
        console.error("Error creating team recruitment:", error);
        throw error;
    }
}

export async function getActiveTeamRecruitments(tournamentId: string) {
    try {
        const q = query(
            collection(db, TEAM_RECRUITMENT_COLLECTION),
            where("tournament_id", "==", tournamentId),
            where("status", "==", "active"),
        );
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as TeamRecruitment[];
    } catch (error) {
        console.error("Error fetching team recruitments:", error);
        throw error;
    }
}

export async function getAllTeamRecruitments() {
    try {
        const querySnapshot = await getDocs(collection(db, TEAM_RECRUITMENT_COLLECTION));
        return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as TeamRecruitment[];
    } catch (error) {
        console.error("Error fetching all team recruitments:", error);
        throw error;
    }
}

// Get team recruitment records by leader ID
export async function getTeamRecruitmentsByLeader(leaderId: string): Promise<TeamRecruitment[]> {
    try {
        const q = query(collection(db, TEAM_RECRUITMENT_COLLECTION), where("leader_id", "==", leaderId));
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as TeamRecruitment[];
    } catch (error) {
        console.error("Error fetching team recruitments by leader:", error);
        throw error;
    }
}

// Delete team recruitment record
export async function deleteTeamRecruitment(recruitmentId: string): Promise<void> {
    try {
        const recruitmentRef = doc(db, TEAM_RECRUITMENT_COLLECTION, recruitmentId);
        await deleteDoc(recruitmentRef);
    } catch (error) {
        console.error("Error deleting team recruitment:", error);
        throw error;
    }
}
