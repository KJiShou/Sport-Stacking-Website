import {collection, getDocs} from "firebase/firestore";
import {updateParticipantRankingsAndResults} from "./recordService";
import {db} from "./config";
import {recalculateUserBestTimesByGlobalIds} from "./userBestTimesService";

type Classification = "prelim" | "advance" | "intermediate" | "beginner";

export interface RecalculateAllDataSummary {
    athletesProcessed: number;
    tournamentsProcessed: number;
    rankingJobsAttempted: number;
    rankingJobsSucceeded: number;
    rankingJobsFailed: number;
    failedRankingJobs: Array<{tournamentId: string; classification: Classification; error: string}>;
}

const CLASSIFICATIONS: Classification[] = ["prelim", "advance", "intermediate", "beginner"];

const normalizeErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
};

export async function recalculateAllAthletesBestPerformanceAndTournamentHistory(): Promise<RecalculateAllDataSummary> {
    const usersSnapshot = await getDocs(collection(db, "users"));
    const athleteGlobalIds = new Set<string>();

    for (const userDoc of usersSnapshot.docs) {
        const globalId = userDoc.data()?.global_id;
        if (typeof globalId !== "string") {
            continue;
        }
        const trimmed = globalId.trim();
        if (trimmed.length > 0) {
            athleteGlobalIds.add(trimmed);
        }
    }

    await recalculateUserBestTimesByGlobalIds(athleteGlobalIds);

    const tournamentsSnapshot = await getDocs(collection(db, "tournaments"));
    const tournamentIds = tournamentsSnapshot.docs.map((docSnap) => docSnap.id);

    const failedRankingJobs: Array<{tournamentId: string; classification: Classification; error: string}> = [];
    let rankingJobsSucceeded = 0;
    let rankingJobsAttempted = 0;

    for (const tournamentId of tournamentIds) {
        for (const classification of CLASSIFICATIONS) {
            rankingJobsAttempted += 1;
            try {
                await updateParticipantRankingsAndResults(tournamentId, classification);
                rankingJobsSucceeded += 1;
            } catch (error) {
                failedRankingJobs.push({
                    tournamentId,
                    classification,
                    error: normalizeErrorMessage(error),
                });
            }
        }
    }

    return {
        athletesProcessed: athleteGlobalIds.size,
        tournamentsProcessed: tournamentIds.length,
        rankingJobsAttempted,
        rankingJobsSucceeded,
        rankingJobsFailed: failedRankingJobs.length,
        failedRankingJobs,
    };
}
