import {collection, getDocs, limit, query, updateDoc, where} from "firebase/firestore";
import {db} from "./config";

export type EventType = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

type BestTimeObject = {time: number; updated_at?: Date | null; season?: string | null};
type BestTimeRecord = BestTimeObject | null | undefined;
type BestTimes = {
    "3-3-3"?: BestTimeRecord;
    "3-6-3"?: BestTimeRecord;
    Cycle?: BestTimeRecord;
    Overall?: BestTimeRecord;
};

/**
 * Updates a user's best time for a specific event if the new time is better
 * @param globalId - The user's global_id
 * @param eventType - The event type (3-3-3, 3-6-3, Cycle, Overall)
 * @param newTime - The new time to compare
 * @returns true if the best time was updated, false otherwise
 */
export const updateUserBestTime = async (globalId: string, eventType: EventType, newTime: number): Promise<boolean> => {
    try {
        if (!globalId || !eventType || typeof newTime !== "number" || newTime <= 0) {
            console.warn("Invalid parameters for updateUserBestTime", {globalId, eventType, newTime});
            return false;
        }

        // Normalize to three decimal places (thousandths)
        const normalizedTime = Math.round(newTime * 1000) / 1000;

        // Find user by global_id
        const user = query(collection(db, "users"), where("global_id", "==", globalId), limit(1));
        const userSnap = await getDocs(user);

        if (userSnap.empty) {
            console.warn(`User not found with global_id: ${globalId}`);
            return false;
        }

        const userData = userSnap.docs[0].data();
        const usersRef = userSnap.docs[0].ref;
        const currentBestTimes: BestTimes = (userData?.best_times as BestTimes) || {};
        const currentEntry = currentBestTimes[eventType];
        let currentBestTime: number | null = null;
        if (typeof currentEntry === "number") {
            currentBestTime = currentEntry;
        } else if (currentEntry && typeof (currentEntry as BestTimeObject).time === "number") {
            currentBestTime = (currentEntry as BestTimeObject).time;
        }

        // If no current best time exists or new time is better (lower), update it
        if (currentBestTime === null || currentBestTime === undefined || normalizedTime < currentBestTime) {
            const now = new Date();
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth(); // 0-11
            const seasonStartYear = month >= 6 ? year : year - 1;
            const season = `${seasonStartYear}-${seasonStartYear + 1}`;
            const updatedBestTimes: BestTimes = {
                ...currentBestTimes,
                [eventType]: {time: normalizedTime, updated_at: now, season},
            };

            await updateDoc(usersRef, {
                best_times: updatedBestTimes,
                updated_at: now,
            });

            return true;
        }

        return false;
    } catch (error) {
        console.error("Error updating user best time:", error);
        return false;
    }
};

/**
 * Batch update best times for multiple events
 * Useful when saving a record with multiple attempts
 * @param globalId - The user's global_id
 * @param times - Object with event types and their best times
 */
export const updateUserBestTimes = async (globalId: string, times: Partial<Record<EventType, number>>): Promise<void> => {
    const eventTypes = Object.keys(times) as EventType[];

    for (const eventType of eventTypes) {
        const time = times[eventType];
        if (time !== undefined && time > 0) {
            await updateUserBestTime(globalId, eventType, time);
        }
    }
};
