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

const INDIVIDUAL_EVENT_TYPES: Array<Exclude<EventType, "Overall">> = ["3-3-3", "3-6-3", "Cycle"];
const EVENT_TYPES: EventType[] = [...INDIVIDUAL_EVENT_TYPES, "Overall"];

const getBestTimeValue = (entry: BestTimeRecord): number | null => {
    if (typeof entry === "number") {
        return Number.isFinite(entry) && entry > 0 ? entry : null;
    }
    if (entry && typeof entry.time === "number" && Number.isFinite(entry.time) && entry.time > 0) {
        return entry.time;
    }
    return null;
};

const buildSeasonLabel = (date: Date): string => {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth(); // 0-11
    const seasonStartYear = month >= 6 ? year : year - 1;
    return `${seasonStartYear}-${seasonStartYear + 1}`;
};

const deriveOverallFromIndividualBests = (bestTimes: BestTimes): number | null => {
    const values = INDIVIDUAL_EVENT_TYPES.map((eventType) => getBestTimeValue(bestTimes[eventType]));
    if (values.some((value) => value == null)) {
        return null;
    }
    const numericValues = values as number[];
    const total = numericValues.reduce((sum, value) => sum + value, 0);
    return Math.round(total * 1000) / 1000;
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
        const now = new Date();
        const season = buildSeasonLabel(now);
        const updatedBestTimes: BestTimes = {...currentBestTimes};
        let didChange = false;

        // Ignore direct "Overall" updates and always derive Overall from the three individual PBs.
        if (eventType !== "Overall") {
            const currentEntry = currentBestTimes[eventType];
            const currentBestTime = getBestTimeValue(currentEntry);

            // If no current best time exists or new time is better (lower), update it.
            if (currentBestTime === null || normalizedTime < currentBestTime) {
                updatedBestTimes[eventType] = {time: normalizedTime, updated_at: now, season};
                didChange = true;
            }
        }

        const derivedOverall = deriveOverallFromIndividualBests(updatedBestTimes);
        const currentOverall = getBestTimeValue(currentBestTimes.Overall);

        if (derivedOverall == null) {
            if (currentBestTimes.Overall != null) {
                delete updatedBestTimes.Overall;
                didChange = true;
            }
        } else if (currentOverall === null || derivedOverall !== currentOverall) {
            updatedBestTimes.Overall = {
                time: derivedOverall,
                updated_at: now,
                season,
            };
            didChange = true;
        }

        if (!didChange) {
            return false;
        }

        await updateDoc(usersRef, {
            best_times: updatedBestTimes,
            updated_at: now,
        });

        return true;
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

const normalizeTime = (value: unknown): number | null => {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return null;
    }
    return Math.round(numeric * 1000) / 1000;
};

const getCurrentSeason = (): string => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth();
    const seasonStartYear = month >= 6 ? year : year - 1;
    return `${seasonStartYear}-${seasonStartYear + 1}`;
};

/**
 * Recalculate athlete best_times from persisted non-prelim records.
 * Useful after bulk deletions (e.g., deleting a tournament) where prior
 * personal bests may no longer exist.
 */
export const recalculateUserBestTimesByGlobalIds = async (globalIds: Iterable<string>): Promise<void> => {
    const season = getCurrentSeason();

    for (const rawGlobalId of globalIds) {
        const globalId = rawGlobalId?.trim();
        if (!globalId) {
            continue;
        }

        const userQuery = query(collection(db, "users"), where("global_id", "==", globalId), limit(1));
        const userSnap = await getDocs(userQuery);
        if (userSnap.empty) {
            continue;
        }

        const userDoc = userSnap.docs[0];
        const userData = userDoc.data() as {best_times?: Record<string, BestTimeRecord>};
        const currentBestTimes = (userData.best_times ?? {}) as Record<string, BestTimeRecord>;
        const nextBestTimes: Record<string, BestTimeRecord> = {...currentBestTimes};

        const recordSnap = await getDocs(query(collection(db, "records"), where("participant_global_id", "==", globalId)));

        const bestByEvent: Partial<Record<EventType, number>> = {};

        for (const docSnap of recordSnap.docs) {
            const data = docSnap.data() as {classification?: string; code?: string; best_time?: unknown};
            if (data.classification === "prelim") {
                continue;
            }
            if (data.code !== "3-3-3" && data.code !== "3-6-3" && data.code !== "Cycle") {
                continue;
            }
            const bestTime = normalizeTime(data.best_time);
            if (bestTime == null) {
                continue;
            }
            const prev = bestByEvent[data.code];
            if (prev == null || bestTime < prev) {
                bestByEvent[data.code] = bestTime;
            }
        }

        const derivedOverall =
            bestByEvent["3-3-3"] != null && bestByEvent["3-6-3"] != null && bestByEvent.Cycle != null
                ? Math.round(((bestByEvent["3-3-3"] ?? 0) + (bestByEvent["3-6-3"] ?? 0) + (bestByEvent.Cycle ?? 0)) * 1000) / 1000
                : null;

        if (derivedOverall == null) {
            delete bestByEvent.Overall;
        } else {
            bestByEvent.Overall = derivedOverall;
        }

        for (const eventType of EVENT_TYPES) {
            const value = bestByEvent[eventType];
            if (value == null) {
                delete nextBestTimes[eventType];
            } else {
                nextBestTimes[eventType] = {
                    time: value,
                    updated_at: new Date(),
                    season,
                };
            }
        }

        await updateDoc(userDoc.ref, {
            best_times: nextBestTimes,
            updated_at: new Date(),
        });
    }
};
