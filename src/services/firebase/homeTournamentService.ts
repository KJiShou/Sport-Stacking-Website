import {type Timestamp, collection, getDocs, orderBy, query, where} from "firebase/firestore";
import type {Tournament} from "../../schema/TournamentSchema";
import {db} from "./config";

/**
 * Convert Firestore Timestamp to Date for comparison
 */
function toDate(value: Timestamp | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    return value.toDate();
}

/**
 * Fetch upcoming and ongoing tournaments, sorted by start date (earliest first)
 * Returns tournaments with status "Up Coming" or "On Going"
 */
export async function getUpcomingAndOngoingTournaments(): Promise<Tournament[]> {
    try {
        const tournamentsRef = collection(db, "tournaments");

        // Fetch both upcoming and ongoing tournaments
        const [upcomingSnapshot, ongoingSnapshot] = await Promise.all([
            getDocs(query(tournamentsRef, where("status", "==", "Up Coming"), orderBy("start_date", "asc"))),
            getDocs(query(tournamentsRef, where("status", "==", "On Going"), orderBy("start_date", "asc"))),
        ]);

        const tournaments: Tournament[] = [
            ...upcomingSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}) as Tournament),
            ...ongoingSnapshot.docs.map((doc) => ({id: doc.id, ...doc.data()}) as Tournament),
        ];

        // Sort combined results by start_date (earliest first)
        tournaments.sort((a, b) => {
            const dateA = toDate(a.start_date);
            const dateB = toDate(b.start_date);

            if (!dateA && !dateB) return 0;
            if (!dateA) return 1;
            if (!dateB) return -1;

            return dateA.getTime() - dateB.getTime();
        });

        return tournaments;
    } catch (error) {
        console.error("Failed to fetch upcoming/ongoing tournaments:", error);
        return [];
    }
}

/**
 * Fetch the next N tournaments (ongoing first, then upcoming by earliest date)
 */
export async function getNextTournaments(limit = 3): Promise<Tournament[]> {
    const tournaments = await getUpcomingAndOngoingTournaments();
    return tournaments.slice(0, limit);
}
