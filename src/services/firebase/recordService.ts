import {sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import {
    Timestamp,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    limit,
    orderBy,
    query,
    setDoc,
    updateDoc,
    where,
} from "firebase/firestore";
import type {TeamMember, TournamentEvent} from "../../schema";
import {
    type GetFastestRecordData,
    type GlobalResult,
    type GlobalTeamResult,
    type TournamentOverallRecord,
    TournamentOverallRecordSchema,
    type TournamentRecord,
    TournamentRecordSchema,
    type TournamentTeamRecord,
    TournamentTeamRecordSchema,
} from "../../schema/RecordSchema";
import {db as firestore} from "./config";
import {fetchTournamentEvents} from "./tournamentsService";
import {updateUserBestTime} from "./userBestTimesService";

type Category = "individual" | "double" | "parent_&_child" | "team_relay" | "special_need";
type RecordEventType = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

const CATEGORIES: Category[] = ["individual", "double", "parent_&_child", "team_relay", "special_need"];
// Event types constant for maintainability
const EVENT_TYPES: RecordEventType[] = ["3-3-3", "3-6-3", "Cycle", "Overall"];

const CATEGORY_LABELS: Record<Category, string> = {
    individual: "Individual",
    double: "Double",
    "parent_&_child": "Parent & Child",
    team_relay: "Team Relay",
    special_need: "Special Need",
};

const EVENT_NAME_TO_COMBOS: Record<string, Array<{category: Category; eventType: RecordEventType}>> = {
    "3-3-3": [{category: "individual", eventType: "3-3-3"}],
    "3-6-3": [{category: "individual", eventType: "3-6-3"}],
    Cycle: [{category: "individual", eventType: "Cycle"}],
    Double: [{category: "double", eventType: "Cycle"}],
    "Team Relay": [
        {category: "team_relay", eventType: "Cycle"},
        {category: "team_relay", eventType: "3-6-3"},
    ],
    "Parent & Child": [{category: "parent_&_child", eventType: "Cycle"}],
    "Special Need": [
        {category: "special_need", eventType: "3-3-3"},
        {category: "special_need", eventType: "3-6-3"},
        {category: "special_need", eventType: "Cycle"},
    ],
};

const safeMin = (...values: Array<number | undefined>): number | undefined => {
    const valid = values.filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
    return valid.length > 0 ? Math.min(...valid) : undefined;
};

const buildEventKeyForCategory = (eventType: RecordEventType, category: Category): string =>
    `${eventType}-${CATEGORY_LABELS[category]}`;

const isTeamTournamentRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    "team_id" in record && typeof record.team_id === "string";

const determineRecordRound = (
    record: TournamentRecord | TournamentTeamRecord,
): "prelim" | "advance" | "intermediate" | "beginner" => {
    if (record.classification === "prelim") {
        return "prelim";
    }
    if (record.classification === "advance") {
        return "advance";
    }
    if (record.classification === "intermediate") {
        return "intermediate";
    }
    if (record.classification === "beginner") {
        return "beginner";
    }
    // Default to intermediate if classification is undefined
    return "intermediate";
};

interface FetchRecordsOptions {
    round?: "prelim" | "advance" | "intermediate" | "beginner";
    classification?: string;
}

export const saveRecord = async (data: TournamentRecord): Promise<string> => {
    const now = new Date().toISOString();
    const hasValidId = typeof data.id === "string" && data.id.trim().length > 0;
    const recordRef = hasValidId ? doc(firestore, "records", data.id) : doc(collection(firestore, "records"));
    const recordId = recordRef.id;
    const isExistingRecord = hasValidId;

    // Determine if this is a team event
    const isTeamEvent =
        data.event.toLowerCase().includes("double") ||
        data.event.toLowerCase().includes("team relay") ||
        data.event.toLowerCase().includes("parent & child");

    if (isTeamEvent) {
        return Promise.reject(new Error("Use saveTeamRecord for team events"));
    }
    if (isExistingRecord) {
        await updateDoc(recordRef, TournamentRecordSchema.parse({...data, updated_at: now}));
    } else {
        await setDoc(
            recordRef,
            TournamentRecordSchema.parse({...data, id: recordId, submitted_at: now, created_at: now, updated_at: now}),
            {
                merge: true,
            },
        );
    }

    // Update user's best time after saving the record
    if (data.participant_global_id && data.best_time > 0 && data.code) {
        // Use the code field directly for best times tracking
        let eventType: "3-3-3" | "3-6-3" | "Cycle" | null = null;

        if (data.code === "3-3-3") {
            eventType = "3-3-3";
        } else if (data.code === "3-6-3") {
            eventType = "3-6-3";
        } else if (data.code === "Cycle") {
            eventType = "Cycle";
        }

        if (eventType) {
            try {
                await updateUserBestTime(data.participant_global_id, eventType, data.best_time);
            } catch (error) {
                console.error("Failed to update user best time:", error);
                // Don't fail the record save if best time update fails
            }
        }
    }

    return recordId;
};

export const saveTeamRecord = async (data: TournamentTeamRecord): Promise<string> => {
    const now = new Date().toISOString();
    const recordRef = data.id ? doc(firestore, "records", data.id) : doc(collection(firestore, "records"));
    const recordId = recordRef.id;
    const isExistingRecord = Boolean(data.id);

    // Save to tournament-specific records
    if (isExistingRecord) {
        await updateDoc(recordRef, TournamentTeamRecordSchema.parse({...data, updated_at: now}));
    } else {
        await setDoc(recordRef, TournamentTeamRecordSchema.parse({...data, created_at: now, updated_at: now}), {merge: true});
    }
    return recordId;
};

export const saveOverallRecord = async (data: TournamentOverallRecord): Promise<string> => {
    const now = new Date().toISOString();
    let recordRef: ReturnType<typeof doc>;
    let recordId: string;
    let isExistingRecord = Boolean(data.id);

    // If no ID provided, check if an overall record already exists for this participant
    if (!data.id && data.participant_global_id && data.tournament_id) {
        // Query for existing overall record for this participant in this tournament
        const existingRecordsQuery = query(
            collection(firestore, "overall_records"),
            where("participant_global_id", "==", data.participant_global_id),
            where("tournament_id", "==", data.tournament_id),
            where("event_id", "==", data.event_id),
            where("classification", "==", data.classification),
            limit(1),
        );

        const existingRecordsSnap = await getDocs(existingRecordsQuery);

        if (!existingRecordsSnap.empty) {
            // Found existing record, use it for update
            const existingDoc = existingRecordsSnap.docs[0];
            recordRef = existingDoc.ref;
            recordId = existingDoc.id;
            isExistingRecord = true;
        } else {
            // No existing record, create new one
            recordRef = doc(collection(firestore, "overall_records"));
            recordId = recordRef.id;
        }
    } else {
        // ID was provided, use it
        recordRef = data.id ? doc(firestore, "overall_records", data.id) : doc(collection(firestore, "overall_records"));
        recordId = recordRef.id;
    }

    if (isExistingRecord) {
        await updateDoc(recordRef, TournamentOverallRecordSchema.parse({...data, id: recordId, updated_at: now}));
    } else {
        await setDoc(
            recordRef,
            TournamentOverallRecordSchema.parse({...data, id: recordId, submitted_at: now, created_at: now, updated_at: now}),
            {merge: true},
        );
    }

    if (data.participant_global_id) {
        try {
            // Update individual event best times
            if (data.three_three_three > 0) {
                await updateUserBestTime(data.participant_global_id, "3-3-3", data.three_three_three);
            }
            if (data.three_six_three > 0) {
                await updateUserBestTime(data.participant_global_id, "3-6-3", data.three_six_three);
            }
            if (data.cycle > 0) {
                await updateUserBestTime(data.participant_global_id, "Cycle", data.cycle);
            }
            if (data.overall_time > 0) {
                await updateUserBestTime(data.participant_global_id, "Overall", data.overall_time);
            }
        } catch (error) {
            console.error("Failed to update user best times:", error);
            // Don't fail the record save if best time update fails
        }
    }

    return recordId;
};

export const getTournamentPrelimRecords = async (tournamentId: string): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
        return records;
    }

    const prelimRecordsQuery = query(
        collection(firestore, `records`),
        where("tournament_id", "==", tournamentId),
        where("classification", "==", "prelim"),
    );

    const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
    for (const recordDoc of prelimRecordsSnapshot.docs) {
        const data = {...recordDoc.data(), id: recordDoc.id};
        records.push(data as TournamentRecord | TournamentTeamRecord);
    }
    return records;
};

const getEventCategoryFromType = (typeLabel: string): string => {
    const normalized = typeLabel.toLowerCase();
    if (normalized === "double") return "double";
    if (normalized === "team relay") return "team_relay";
    if (normalized === "parent & child") return "parent_&_child";
    if (normalized === "special need") return "special_need";
    return "individual";
};

const parseEventKey = (eventKey: string): {eventName: string; eventCategory: string} => {
    let eventName = eventKey;
    let typeLabel = "";

    if (eventKey.includes("-Team Relay")) {
        typeLabel = "Team Relay";
        eventName = eventKey.replace("-Team Relay", "");
    } else if (eventKey.includes("-Parent & Child")) {
        typeLabel = "Parent & Child";
        eventName = eventKey.replace("-Parent & Child", "");
    } else if (eventKey.includes("-Special Need")) {
        typeLabel = "Special Need";
        eventName = eventKey.replace("-Special Need", "");
    } else {
        const eventParts = eventKey.split("-");
        typeLabel = eventParts.pop() || "";
        eventName = eventParts.join("-");
    }

    return {
        eventName: eventName.trim(),
        eventCategory: getEventCategoryFromType(typeLabel.trim()),
    };
};

export const getTournamentFinalRecords = async (tournamentId: string): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
        return records;
    }

    // Get records for all non-prelim classifications (advance, intermediate, beginner)
    const nonPrelimRecordsQuery = query(
        collection(firestore, `records`),
        where("tournament_id", "==", tournamentId),
        where("classification", "!=", "prelim"),
    );

    const nonPrelimRecordsSnapshot = await getDocs(nonPrelimRecordsQuery);
    for (const recordDoc of nonPrelimRecordsSnapshot.docs) {
        const data = {...recordDoc.data(), id: recordDoc.id};
        records.push(data as TournamentRecord | TournamentTeamRecord);
    }
    return records;
};

// Fetch overall records for a tournament (prelim)
export const getTournamentPrelimOverallRecords = async (tournamentId: string): Promise<TournamentOverallRecord[]> => {
    const records: TournamentOverallRecord[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
        return records;
    }

    const overallRecordsQuery = query(
        collection(firestore, "overall_records"),
        where("tournament_id", "==", tournamentId),
        where("classification", "==", "prelim"),
    );

    const overallRecordsSnapshot = await getDocs(overallRecordsQuery);
    for (const recordDoc of overallRecordsSnapshot.docs) {
        const data = {...recordDoc.data(), id: recordDoc.id};
        records.push(data as TournamentOverallRecord);
    }
    return records;
};

// Fetch overall records for a tournament (non-prelim: advance, intermediate, beginner)
export const getTournamentFinalOverallRecords = async (tournamentId: string): Promise<TournamentOverallRecord[]> => {
    const records: TournamentOverallRecord[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
        return records;
    }

    // Get records for all non-prelim classifications (advance, intermediate, beginner)
    const overallRecordsQuery = query(
        collection(firestore, "overall_records"),
        where("tournament_id", "==", tournamentId),
        where("classification", "!=", "prelim"),
    );

    const overallRecordsSnapshot = await getDocs(overallRecordsQuery);
    for (const recordDoc of overallRecordsSnapshot.docs) {
        const data = {...recordDoc.data(), id: recordDoc.id};
        records.push(data as TournamentOverallRecord);
    }
    return records;
};

// Keep the original function for backward compatibility
export const getTournamentRecords = async (tournamentId: string): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const [prelimRecords, finalRecords] = await Promise.all([
        getTournamentPrelimRecords(tournamentId),
        getTournamentFinalRecords(tournamentId),
    ]);

    return [...prelimRecords, ...finalRecords];
};

export const updateRecord = async (
    recordId: string,
    event: string,
    type: "Individual" | "Team",
    updates: Partial<GlobalResult>,
): Promise<void> => {
    const now = new Date().toISOString();
    const updatedData = {
        ...updates,
        updated_at: now,
    };

    const recordRef = doc(firestore, `globalResult/${type}/${event}`, recordId);
    await setDoc(recordRef, updatedData, {merge: true});
};

export const getFastestRecord = async (data: GetFastestRecordData): Promise<GlobalResult | null> => {
    const {event, type} = data; // Keep parameters for backward compatibility

    try {
        const q = query(
            collection(firestore, `globalResult/${type}/${event}`),
            where("event", "==", event),
            // Remove round filtering as global results don't have round field
            orderBy("time", "asc"), // Use 'time' instead of 'bestTime'
            limit(1),
        );

        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data() as GlobalResult;
        }
        return null;
    } catch (error) {
        console.error(`Failed to get fastest record for ${event}:`, error);
        return null;
    }
};

export const getPrelimRecords = async (
    tournamentId: string,
    code: string,
    eventType: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];

    try {
        // Gather prelim records stored in the consolidated "records" collection
        const topLevelQuery = query(
            collection(firestore, "records"),
            where("tournament_id", "==", tournamentId),
            where("classification", "==", "prelim"),
            where("event", "==", eventType),
            where("code", "==", code),
        );
        const topLevelSnapshot = await getDocs(topLevelQuery);
        for (const recordDoc of topLevelSnapshot.docs) {
            const data = recordDoc.data();
            records.push(data as TournamentRecord | TournamentTeamRecord);
        }
    } catch (error) {
        console.error("Error fetching prelim records:", error);
        throw error;
    }

    return records;
};

function isCategory(x: string): x is Category {
    return (CATEGORIES as string[]).includes(x);
}
function isEventType(x: string): x is RecordEventType {
    return (EVENT_TYPES as string[]).includes(x);
}

/**
 * New form:
 *   getEventRankings(category, eventType)
 * Legacy form (kept for compatibility):
 *   getEventRankings(event)          // returns across all categories for that event
 *   getEventRankings(event, round)   // round ignored; maintained for callers
 */

// Display categories (for UI)
type DisplayCategory = "Individual" | "Double" | "Parent & Child" | "Team Relay" | "Special Need";

// Map from system categories to display categories
const CATEGORY_DISPLAY_MAP: Record<Category, DisplayCategory> = {
    individual: "Individual",
    double: "Double",
    "parent_&_child": "Parent & Child",
    team_relay: "Team Relay",
    special_need: "Special Need",
};

// Delete record service
export const deleteRecord = async (recordId: string): Promise<void> => {
    try {
        const recordRef = doc(firestore, "records", recordId);
        await deleteDoc(recordRef);
    } catch (error) {
        console.error(`Failed to delete record ${recordId}:`, error);
        throw error;
    }
};

// Verify/Unverify record service
export const toggleRecordVerification = async (
    recordId: string,
    verifiedBy: string,
    currentStatus?: "submitted" | "verified",
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, "records", recordId);

        // Default to "submitted" if status is undefined or invalid
        const status = currentStatus === "verified" ? "verified" : "submitted";

        if (status === "submitted") {
            // Verify the record
            await updateDoc(recordRef, {
                status: "verified",
                verified_by: verifiedBy,
                verified_at: now,
                updated_at: now,
            });
        } else {
            // Unverify the record
            await updateDoc(recordRef, {
                status: "submitted",
                verified_by: null,
                verified_at: null,
                updated_at: now,
            });
        }
    } catch (error) {
        console.error(`Failed to toggle verification for record ${recordId}:`, error);
        throw error;
    }
};

// Add/Update video URL service
export const updateRecordVideoUrl = async (recordId: string, videoUrl: string): Promise<void> => {
    try {
        const now = new Date().toISOString();

        // Try to update in 'records' collection first
        const recordRef = doc(firestore, "records", recordId);
        const recordSnap = await getDoc(recordRef);

        if (recordSnap.exists()) {
            await updateDoc(recordRef, {
                video_url: videoUrl,
                updated_at: now,
            });
            return;
        }

        // If not found, try 'overall_records' collection
        const overallRecordRef = doc(firestore, "overall_records", recordId);
        const overallRecordSnap = await getDoc(overallRecordRef);

        if (overallRecordSnap.exists()) {
            await updateDoc(overallRecordRef, {
                video_url: videoUrl,
                updated_at: now,
            });
            return;
        }

        throw new Error(`Record with ID ${recordId} not found in either 'records' or 'overall_records' collection`);
    } catch (error) {
        console.error(`Failed to update video URL for record ${recordId}:`, error);
        throw error;
    }
};

// Get individual event records for a participant (for editing overall records)
export const getParticipantEventRecords = async (
    tournamentId: string,
    participantGlobalId: string,
    eventId: string,
    classification: string,
): Promise<TournamentRecord[]> => {
    try {
        const recordsQuery = query(
            collection(firestore, "records"),
            where("tournament_id", "==", tournamentId),
            where("participant_global_id", "==", participantGlobalId),
            where("event_id", "==", eventId),
            where("classification", "==", classification),
        );
        const recordsSnapshot = await getDocs(recordsQuery);

        const records: TournamentRecord[] = [];
        for (const doc of recordsSnapshot.docs) {
            records.push({...doc.data(), id: doc.id} as TournamentRecord);
        }

        return records;
    } catch (error) {
        console.error("Failed to get participant event records:", error);
        throw error;
    }
};

// Delete overall record service - also deletes the three individual event records (3-3-3, 3-6-3, Cycle)
export const deleteOverallRecord = async (recordId: string): Promise<void> => {
    try {
        // First, get the overall record to retrieve participant and tournament info
        const recordRef = doc(firestore, "overall_records", recordId);
        const recordSnap = await getDoc(recordRef);

        if (!recordSnap.exists()) {
            throw new Error(`Overall record ${recordId} not found`);
        }

        const overallRecord = recordSnap.data() as TournamentOverallRecord;

        // Delete the three individual event records (3-3-3, 3-6-3, Cycle)
        const eventCodes = ["3-3-3", "3-6-3", "Cycle"];
        const deleteIndividualPromises = eventCodes.map(async (eventCode) => {
            const individualRecordsQuery = query(
                collection(firestore, "records"),
                where("tournament_id", "==", overallRecord.tournament_id),
                where("participant_global_id", "==", overallRecord.participant_global_id),
                where("event_id", "==", overallRecord.event_id),
                where("classification", "==", overallRecord.classification),
                where("code", "==", eventCode),
            );
            const individualRecordsSnapshot = await getDocs(individualRecordsQuery);

            // Delete all matching individual records for this event code
            const deletePromises = individualRecordsSnapshot.docs.map((doc) => deleteDoc(doc.ref));
            await Promise.all(deletePromises);
        });

        // Wait for all individual records to be deleted
        await Promise.all(deleteIndividualPromises);

        // Finally, delete the overall record
        await deleteDoc(recordRef);
    } catch (error) {
        console.error(`Failed to delete overall record ${recordId}:`, error);
        throw error;
    }
};

// Delete all records for a participant in a tournament (for individual events - 3-3-3, 3-6-3, Cycle)
export const deleteParticipantRecords = async (
    tournamentId: string,
    participantGlobalId: string,
    eventId: string,
    classification: string,
): Promise<void> => {
    try {
        // Delete individual event records (3-3-3, 3-6-3, Cycle)
        const recordsQuery = query(
            collection(firestore, "records"),
            where("tournament_id", "==", tournamentId),
            where("participant_global_id", "==", participantGlobalId),
            where("event_id", "==", eventId),
            where("classification", "==", classification),
        );
        const recordsSnapshot = await getDocs(recordsQuery);

        // Delete all matching records
        const deletePromises = recordsSnapshot.docs.map((doc) => deleteDoc(doc.ref));
        await Promise.all(deletePromises);

        // Delete the overall record
        const overallRecordsQuery = query(
            collection(firestore, "overall_records"),
            where("tournament_id", "==", tournamentId),
            where("participant_global_id", "==", participantGlobalId),
            where("event_id", "==", eventId),
            where("classification", "==", classification),
        );
        const overallRecordsSnapshot = await getDocs(overallRecordsQuery);

        const deleteOverallPromises = overallRecordsSnapshot.docs.map((doc) => deleteDoc(doc.ref));
        await Promise.all(deleteOverallPromises);
    } catch (error) {
        console.error("Failed to delete participant records:", error);
        throw error;
    }
};

// Update tournament record times
export const updateTournamentRecord = async (
    recordId: string,
    updates: {
        try1?: number;
        try2?: number;
        try3?: number;
        best_time?: number;
        video_url?: string | null;
    },
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, "records", recordId);

        await updateDoc(recordRef, {
            ...updates,
            updated_at: now,
        });
    } catch (error) {
        console.error(`Failed to update tournament record ${recordId}:`, error);
        throw error;
    }
};

// Update overall record times
export const updateOverallRecord = async (
    recordId: string,
    updates: {
        three_three_three?: number;
        three_six_three?: number;
        cycle?: number;
        overall_time?: number;
        video_url?: string | null;
    },
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, "overall_records", recordId);

        await updateDoc(recordRef, {
            ...updates,
            updated_at: now,
        });

        const shouldUpdateBestTimes =
            (updates.three_three_three ?? 0) > 0 ||
            (updates.three_six_three ?? 0) > 0 ||
            (updates.cycle ?? 0) > 0 ||
            (updates.overall_time ?? 0) > 0;

        if (shouldUpdateBestTimes) {
            const recordSnap = await getDoc(recordRef);
            if (recordSnap.exists()) {
                const record = recordSnap.data() as TournamentOverallRecord;
                const globalId = record.participant_global_id;

                if (globalId) {
                    const threeThreeThree = updates.three_three_three;
                    const threeSixThree = updates.three_six_three;
                    const cycle = updates.cycle;
                    const overallTime = updates.overall_time;

                    if (typeof threeThreeThree === "number" && threeThreeThree > 0) {
                        await updateUserBestTime(globalId, "3-3-3", threeThreeThree);
                    }
                    if (typeof threeSixThree === "number" && threeSixThree > 0) {
                        await updateUserBestTime(globalId, "3-6-3", threeSixThree);
                    }
                    if (typeof cycle === "number" && cycle > 0) {
                        await updateUserBestTime(globalId, "Cycle", cycle);
                    }
                    if (typeof overallTime === "number" && overallTime > 0) {
                        await updateUserBestTime(globalId, "Overall", overallTime);
                    }
                }
            }
        }
    } catch (error) {
        console.error(`Failed to update overall record ${recordId}:`, error);
        throw error;
    }
};

// Toggle verification for overall records
export const toggleOverallRecordVerification = async (
    recordId: string,
    verifiedBy: string,
    currentStatus?: "submitted" | "verified",
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, "overall_records", recordId);

        // Default to "submitted" if status is undefined or invalid
        const status = currentStatus === "verified" ? "verified" : "submitted";

        if (status === "submitted") {
            // Verify the record
            await updateDoc(recordRef, {
                status: "verified",
                verified_by: verifiedBy,
                verified_at: now,
                updated_at: now,
            });
        } else {
            // Unverify the record
            await updateDoc(recordRef, {
                status: "submitted",
                verified_by: null,
                verified_at: null,
                updated_at: now,
            });
        }
    } catch (error) {
        console.error(`Failed to toggle verification for overall record ${recordId}:`, error);
        throw error;
    }
};

// ------------------------------
// Records aggregation for Records page
// ------------------------------
type EventTypeKey = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

type BestRecordsShape = Record<
    DisplayCategory,
    Partial<Record<EventTypeKey, Array<(GlobalResult | GlobalTeamResult) & {id: string}>>>
>;

const emptyBestRecordsShape = (): BestRecordsShape => ({
    Individual: {},
    Double: {},
    "Parent & Child": {},
    "Team Relay": {},
    "Special Need": {},
});

const toGlobalFromIndividual = (r: TournamentRecord & {id: string}): (GlobalResult & {id: string}) | null => {
    const time = typeof r.best_time === "number" ? r.best_time : Number(r.best_time ?? 0);
    if (!Number.isFinite(time)) return null;
    return {
        id: r.id,
        event: (r.code as EventTypeKey) ?? "Cycle",
        gender: r.gender ?? "Overall",
        participantId: r.participant_id,
        participantGlobalId: r.participant_global_id,
        participantName: r.participant_name,
        country: r.country ?? undefined,
        time,
        status: r.status,
        videoUrl: r.video_url ?? undefined,
        verified_by: r.verified_by ?? null,
        verified_at: r.verified_at ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
        updated_at: r.updated_at ?? r.created_at ?? new Date().toISOString(),
        age: (typeof r.age === "number" ? r.age : Number.NaN) as number,
        round: r.classification ?? "intermediate",
        classification: r.classification ?? undefined,
        bestTime: time,
        try1: r.try1,
        try2: r.try2,
        try3: r.try3,
        tournamentId: r.tournament_id,
        tournament_name: r.tournament_name ?? null,
    };
};

const toGlobalFromTeam = (r: TournamentTeamRecord & {id: string}): (GlobalTeamResult & {id: string}) | null => {
    const time = typeof r.best_time === "number" ? r.best_time : Number(r.best_time ?? 0);
    if (!Number.isFinite(time)) return null;
    return {
        id: r.id,
        event: (r.code as EventTypeKey) ?? "Cycle",
        country: (r.country as string | undefined) ?? undefined,
        time,
        teamName: r.team_name ?? undefined,
        leaderId: r.leader_id ?? undefined,
        members: r.member_global_ids ?? undefined,
        status: r.status,
        videoUrl: r.video_url ?? undefined,
        verified_by: r.verified_by ?? null,
        verified_at: r.verified_at ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
        updated_at: r.updated_at ?? r.created_at ?? new Date().toISOString(),
        age: (typeof r.age === "number" ? r.age : Number.NaN) as number,
        round: r.classification ?? "intermediate",
        classification: r.classification ?? undefined,
        bestTime: time,
        try1: r.try1,
        try2: r.try2,
        try3: r.try3,
        tournamentId: r.tournament_id,
        teamId: r.team_id,
        tournament_name: r.tournament_name ?? null,
    } as unknown as GlobalTeamResult & {id: string};
};

const toGlobalFromOverall = (r: TournamentOverallRecord & {id: string}): (GlobalResult & {id: string}) | null => {
    const time = typeof r.overall_time === "number" ? r.overall_time : Number(r.overall_time ?? 0);
    if (!Number.isFinite(time)) return null;
    return {
        id: r.id,
        event: "Overall",
        gender: r.gender ?? "N/A",
        participantId: r.participant_id,
        participantGlobalId: r.participant_global_id,

        participantName: r.participant_name,
        country: r.country ?? undefined,
        time,
        status: r.status,
        videoUrl: r.video_url ?? undefined,
        verified_by: r.verified_by ?? null,
        verified_at: r.verified_at ?? null,
        created_at: r.created_at ?? new Date().toISOString(),
        updated_at: r.updated_at ?? r.created_at ?? new Date().toISOString(),
        age: (typeof r.age === "number" ? r.age : Number.NaN) as number,
        classification: r.classification ?? undefined,
        bestTime: time,
        tournamentId: r.tournament_id,
        tournament_name: r.tournament_name ?? null,
    };
};

export const getBestRecords = async (): Promise<BestRecordsShape> => {
    const result = emptyBestRecordsShape();

    // 1) Load per-code records from 'records'
    const recSnap = await getDocs(collection(firestore, "records"));
    for (const docSnap of recSnap.docs) {
        const data = {
            ...docSnap.data(),
            id: docSnap.id,
        } as Partial<TournamentRecord & TournamentTeamRecord> & {id: string};
        const isTeam = "team_id" in data && typeof (data as Partial<TournamentTeamRecord>).team_id === "string";
        const displayCategory = (data.event as DisplayCategory) ?? "Individual";
        const eventKey = (data.code as EventTypeKey) ?? "Cycle";

        if (displayCategory === "Individual" && (eventKey === "3-3-3" || eventKey === "3-6-3" || eventKey === "Cycle")) {
            const global = toGlobalFromIndividual(data as TournamentRecord & {id: string});
            if (global) {
                result.Individual[eventKey] = [...(result.Individual[eventKey] ?? []), global];
            }
            continue;
        }

        if (
            isTeam &&
            (displayCategory === "Team Relay" || displayCategory === "Double" || displayCategory === "Parent & Child")
        ) {
            const global = toGlobalFromTeam(data as TournamentTeamRecord & {id: string});
            if (global) {
                const target = displayCategory as DisplayCategory;
                result[target][eventKey] = [...(result[target][eventKey] ?? []), global];
            }
            continue;
        }

        // Special Need and other individual-like categories
        if (!isTeam && displayCategory === "Special Need") {
            const global = toGlobalFromIndividual(data as TournamentRecord & {id: string});
            if (global) {
                result["Special Need"][eventKey] = [...(result["Special Need"][eventKey] ?? []), global];
            }
        }
    }

    // 2) Load overall individual results from 'overall_records'
    const overallSnap = await getDocs(collection(firestore, "overall_records"));
    for (const docSnap of overallSnap.docs) {
        const data = {...docSnap.data(), id: docSnap.id} as TournamentOverallRecord & {id: string};
        // Only show for Individual category
        const global = toGlobalFromOverall(data);
        if (global) {
            result.Individual.Overall = [...(result.Individual.Overall ?? []), global];
        }
    }

    // 3) Sort each bucket by time asc
    for (const cat of Object.keys(result) as DisplayCategory[]) {
        const evMap = result[cat];
        for (const ev of Object.keys(evMap) as EventTypeKey[]) {
            const arr = evMap[ev] ?? [];
            arr.sort((a, b) => {
                const timeA = typeof a.time === "number" ? a.time : Number(a.time ?? 0);
                const timeB = typeof b.time === "number" ? b.time : Number(b.time ?? 0);
                const diff = timeA - timeB;
                if (diff !== 0) return diff;
                const tsA = a.created_at ? Date.parse(a.created_at) : Number.POSITIVE_INFINITY;
                const tsB = b.created_at ? Date.parse(b.created_at) : Number.POSITIVE_INFINITY;
                return tsA - tsB; // earlier date ranks higher
            });
            evMap[ev] = arr;
        }
    }

    return result;
};

// Backwards compatibility: stub
export const getBestRecordsByAgeGroup = async (): Promise<BestRecordsShape> => {
    return getBestRecords();
};

/**
 * Update participant registration records with rankings and overall results
 * @param tournamentId - The tournament ID
 * @param classification - The classification type ('prelim', 'advance', 'intermediate', or 'beginner')
 */
export const updateParticipantRankingsAndResults = async (
    tournamentId: string,
    classification: "prelim" | "advance" | "intermediate" | "beginner",
): Promise<void> => {
    try {
        const computeBestTime = (record: TournamentRecord): number | null => {
            if (typeof record.best_time === "number" && Number.isFinite(record.best_time) && record.best_time > 0) {
                return record.best_time;
            }
            const tries = [record.try1, record.try2, record.try3]
                .map((value) => (typeof value === "number" ? value : Number(value)))
                .filter((value) => Number.isFinite(value) && value > 0);
            return tries.length > 0 ? Math.min(...tries) : null;
        };

        // Get all individual records for this tournament and classification
        const recordsQuery = query(
            collection(firestore, "records"),
            where("tournament_id", "==", tournamentId),
            where("classification", "==", classification),
        );
        const recordsSnap = await getDocs(recordsQuery);
        const individualRecords = recordsSnap.docs
            .map((doc) => ({...doc.data(), id: doc.id}))
            .filter((r) => "participant_id" in r && r.participant_id) as Array<TournamentRecord & {id: string}>;

        // Get overall records for this tournament and classification
        const overallQuery = query(
            collection(firestore, "overall_records"),
            where("tournament_id", "==", tournamentId),
            where("classification", "==", classification),
        );
        const overallSnap = await getDocs(overallQuery);
        const overallRecords = overallSnap.docs.map((doc) => ({
            ...doc.data(),
            id: doc.id,
        })) as Array<TournamentOverallRecord & {id: string}>;

        // Calculate rankings based on overall results
        // Sort by overall_time (ascending - lower is better)
        const sortedOverall = [...overallRecords].sort((a, b) => {
            const timeA = a.overall_time ?? Number.POSITIVE_INFINITY;
            const timeB = b.overall_time ?? Number.POSITIVE_INFINITY;
            return timeA - timeB;
        });

        // Create ranking map: participant_global_id -> {rank, overall_time}
        const rankingMap = new Map<
            string,
            {
                rank: number;
                overall_time: number | null;
            }
        >();

        sortedOverall.forEach((record, index) => {
            if (record.participant_global_id && record.overall_time) {
                rankingMap.set(record.participant_global_id, {
                    rank: index + 1, // 1-based ranking
                    overall_time: record.overall_time,
                });
            }
        });

        if (overallRecords.length === 0) {
            const allowedCodes = new Set(["3-3-3", "3-6-3", "Cycle"]);
            const perParticipant = new Map<string, Map<string, number>>();

            for (const record of individualRecords) {
                if (record.event !== "Individual") continue;
                const code = record.code ?? "";
                if (!allowedCodes.has(code)) continue;
                const globalId = record.participant_global_id ?? "";
                if (!globalId) continue;
                const bestTime = computeBestTime(record);
                if (!bestTime) continue;

                const codeMap = perParticipant.get(globalId) ?? new Map<string, number>();
                const existing = codeMap.get(code);
                if (existing == null || bestTime < existing) {
                    codeMap.set(code, bestTime);
                }
                perParticipant.set(globalId, codeMap);
            }

            const fallbackOverall = Array.from(perParticipant.entries())
                .map(([globalId, codeMap]) => {
                    if (!Array.from(allowedCodes).every((code) => codeMap.has(code))) {
                        return null;
                    }
                    const total = (codeMap.get("3-3-3") ?? 0) + (codeMap.get("3-6-3") ?? 0) + (codeMap.get("Cycle") ?? 0);
                    return {globalId, overall_time: total};
                })
                .filter((entry): entry is {globalId: string; overall_time: number} => Boolean(entry))
                .sort((a, b) => a.overall_time - b.overall_time);

            fallbackOverall.forEach((entry, index) => {
                rankingMap.set(entry.globalId, {
                    rank: index + 1,
                    overall_time: entry.overall_time,
                });
            });
        }

        // Get all participants from individual records
        const participantGlobalIds = new Set(individualRecords.map((r) => r.participant_global_id).filter(Boolean));

        // Update each participant's registration record
        for (const globalId of participantGlobalIds) {
            if (!globalId) continue;

            // Find user by global_id
            const usersQuery = query(collection(firestore, "users"), where("global_id", "==", globalId), limit(1));
            const usersSnap = await getDocs(usersQuery);

            if (usersSnap.empty) continue;

            const userDoc = usersSnap.docs[0];
            const userData = userDoc.data();
            const registrationRecords = (userData.registration_records ?? []) as Array<{
                tournament_id: string;
                events?: string[];
                registration_date?: unknown;
                status?: string;
                rejection_reason?: string | null;
                prelim_rank?: number | null;
                final_rank?: number | null;
                prelim_overall_result?: number | null;
                final_overall_result?: number | null;
                created_at?: unknown;
                updated_at?: unknown;
            }>;

            // Find the registration record for this tournament
            const recordIndex = registrationRecords.findIndex((r) => r.tournament_id === tournamentId);

            if (recordIndex === -1) continue; // No registration record found

            // Get ranking and overall result for this participant
            const ranking = rankingMap.get(globalId);

            // Update the registration record
            const updatedRecord = {
                ...registrationRecords[recordIndex],
                updated_at: Timestamp.now(),
            };

            if (classification === "prelim") {
                updatedRecord.prelim_rank = ranking?.rank ?? null;
                updatedRecord.prelim_overall_result = ranking?.overall_time ?? null;
            } else {
                updatedRecord.final_rank = ranking?.rank ?? null;
                updatedRecord.final_overall_result = ranking?.overall_time ?? null;
            }

            // Replace the record in the array
            const updatedRecords = [...registrationRecords];
            updatedRecords[recordIndex] = updatedRecord;

            // Update the user document
            await updateDoc(userDoc.ref, {
                registration_records: updatedRecords,
                updated_at: Timestamp.now(),
            });
        }
    } catch (error) {
        console.error("Error updating participant rankings and results:", error);
        throw error;
    }
};
