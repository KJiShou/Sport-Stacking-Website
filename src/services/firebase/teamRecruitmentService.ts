import {addDoc, collection, getDocs, query, where} from "firebase/firestore";
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
