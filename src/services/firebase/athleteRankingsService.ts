import {collection, getDocs, limit, orderBy, query, where} from "firebase/firestore";
import type {FirestoreUser} from "../../schema/UserSchema";
import {db} from "./config";

export type EventType = "3-3-3" | "3-6-3" | "Cycle";

/**
 * Get top athletes by best time for a specific event
 * @param eventType - The event type to rank by
 * @param maxResults - Maximum number of results to return
 * @returns Array of users sorted by best time (ascending)
 */
export const getTopAthletesByEvent = async (eventType: EventType, maxResults = 100): Promise<FirestoreUser[]> => {
    try {
        const usersRef = collection(db, "users");
        const bestTimeField = `best_times.${eventType}.time`;

        // Query users who have a best time for this event, ordered by best time
        const q = query(usersRef, where(bestTimeField, ">", 0), orderBy(bestTimeField, "asc"), limit(maxResults));

        const snapshot = await getDocs(q);
        return snapshot.docs.map(
            (doc) =>
                ({
                    ...doc.data(),
                    id: doc.id,
                }) as FirestoreUser,
        );
    } catch (error) {
        console.error(`Failed to fetch top athletes for ${eventType}:`, error);
        return [];
    }
};

/**
 * Get top athletes by best time for a specific event and gender
 * @param eventType - The event type to rank by
 * @param gender - Filter by gender ("Male" or "Female")
 * @param maxResults - Maximum number of results to return
 * @returns Array of users sorted by best time (ascending)
 */
export const getTopAthletesByEventAndGender = async (
    eventType: EventType,
    gender: "Male" | "Female",
    maxResults = 100,
): Promise<FirestoreUser[]> => {
    try {
        const usersRef = collection(db, "users");
        const bestTimeField = `best_times.${eventType}.time`;

        // First get all users with best times for this event
        const q = query(
            usersRef,
            where(bestTimeField, ">", 0),
            where("gender", "==", gender),
            orderBy(bestTimeField, "asc"),
            limit(maxResults),
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(
            (doc) =>
                ({
                    ...doc.data(),
                    id: doc.id,
                }) as FirestoreUser,
        );
    } catch (error) {
        console.error(`Failed to fetch top athletes for ${eventType} (${gender}):`, error);
        return [];
    }
};

/**
 * Get top athletes by best time for a specific event and age group
 * @param eventType - The event type to rank by
 * @param maxAge - Maximum age for the age group (e.g., 12 for "12 & Under")
 * @param maxResults - Maximum number of results to return
 * @returns Array of users sorted by best time (ascending)
 */
export const getTopAthletesByEventAndAge = async (
    eventType: EventType,
    maxAge: number,
    maxResults = 100,
): Promise<FirestoreUser[]> => {
    try {
        const usersRef = collection(db, "users");
        const bestTimeField = `best_times.${eventType}.time`;

        // Get all users with best times, then filter by age in memory
        const q = query(
            usersRef,
            where(bestTimeField, ">", 0),
            orderBy(bestTimeField, "asc"),
            limit(maxResults * 2), // Get more to account for age filtering
        );

        const snapshot = await getDocs(q);
        const now = new Date();

        const filtered = snapshot.docs
            .map(
                (doc) =>
                    ({
                        ...doc.data(),
                        id: doc.id,
                    }) as FirestoreUser,
            )
            .filter((user) => {
                if (!user.birthdate) return false;
                const birthdate = user.birthdate instanceof Date ? user.birthdate : user.birthdate.toDate();
                const age = now.getFullYear() - birthdate.getFullYear();
                const monthDiff = now.getMonth() - birthdate.getMonth();
                const adjustedAge = monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthdate.getDate()) ? age - 1 : age;
                return adjustedAge <= maxAge;
            })
            .slice(0, maxResults);

        return filtered;
    } catch (error) {
        console.error(`Failed to fetch top athletes for ${eventType} (age ${maxAge} & under):`, error);
        return [];
    }
};

/**
 * Get athlete's ranking for a specific event among all athletes
 * @param globalId - The athlete's global_id
 * @param eventType - The event type to get ranking for
 * @returns The athlete's rank (1-based) or null if not ranked
 */
export const getAthleteRankingByEvent = async (globalId: string, eventType: EventType): Promise<number | null> => {
    try {
        const usersRef = collection(db, "users");
        const bestTimeField = `best_times.${eventType}.time`;

        // Get the athlete's best time first
        const athleteQuery = query(usersRef, where("global_id", "==", globalId), limit(1));
        const athleteSnap = await getDocs(athleteQuery);

        if (athleteSnap.empty) {
            return null;
        }

        const athleteData = athleteSnap.docs[0].data() as FirestoreUser;
        const athleteBestTime = (athleteData.best_times?.[eventType] as {time?: number} | undefined)?.time;

        if (!athleteBestTime || athleteBestTime <= 0) {
            return null;
        }

        // Count how many athletes have a better (lower) time
        const betterQuery = query(usersRef, where(bestTimeField, ">", 0), where(bestTimeField, "<", athleteBestTime));

        const betterSnap = await getDocs(betterQuery);
        const rank = betterSnap.size + 1; // +1 because rank is 1-based

        return rank;
    } catch (error) {
        console.error(`Failed to get ranking for athlete ${globalId} in ${eventType}:`, error);
        return null;
    }
};

/**
 * Get all best times for a specific athlete
 * @param globalId - The athlete's global_id
 * @returns Object with best times for all events
 */
export const getAthleteBestTimes = async (globalId: string) => {
    try {
        const usersRef = collection(db, "users");
        const q = query(usersRef, where("global_id", "==", globalId), limit(1));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            return null;
        }

        const userData = snapshot.docs[0].data() as FirestoreUser;
        return {
            "3-3-3": (userData.best_times?.["3-3-3"] as {time?: number} | undefined)?.time ?? null,
            "3-6-3": (userData.best_times?.["3-6-3"] as {time?: number} | undefined)?.time ?? null,
            Cycle: (userData.best_times?.Cycle as {time?: number} | undefined)?.time ?? null,
        };
    } catch (error) {
        console.error(`Failed to fetch best times for athlete ${globalId}:`, error);
        return null;
    }
};

/**
 * Get athletes with personal bests in multiple events
 * Useful for finding all-around athletes
 * @param maxResults - Maximum number of results
 * @returns Array of users who have best times in all component events
 */
export const getAllAroundAthletes = async (maxResults = 100): Promise<FirestoreUser[]> => {
    try {
        const usersRef = collection(db, "users");

        // Strategy: order by 3-3-3 time, then filter in-memory for athletes who also have 3-6-3 and Cycle
        const baseField = "best_times.3-3-3.time";
        const q = query(usersRef, where(baseField, ">", 0), orderBy(baseField, "asc"), limit(maxResults * 3));

        const snapshot = await getDocs(q);
        const users = snapshot.docs.map(
            (doc) =>
                ({
                    ...doc.data(),
                    id: doc.id,
                }) as FirestoreUser,
        );

        const filtered = users.filter((u) => {
            const three = (u.best_times?.["3-3-3"] as {time?: number} | undefined)?.time ?? null;
            const six = (u.best_times?.["3-6-3"] as {time?: number} | undefined)?.time ?? null;
            const cycle = (u.best_times?.Cycle as {time?: number} | undefined)?.time ?? null;
            return [three, six, cycle].every((v) => typeof v === "number" && v > 0);
        });

        // Sort by sum of times
        filtered.sort((a, b) => {
            const sum = (u: FirestoreUser) =>
                ((u.best_times?.["3-3-3"] as {time?: number})?.time ?? Number.POSITIVE_INFINITY) +
                ((u.best_times?.["3-6-3"] as {time?: number})?.time ?? Number.POSITIVE_INFINITY) +
                ((u.best_times?.Cycle as {time?: number})?.time ?? Number.POSITIVE_INFINITY);
            return sum(a) - sum(b);
        });

        return filtered.slice(0, maxResults);
    } catch (error) {
        console.error("Failed to fetch all-around athletes:", error);
        return [];
    }
};
