import {collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where} from "firebase/firestore";
import type {TeamMember, TournamentEvent} from "../../schema";
import {sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import {
    type GetFastestRecordData,
    type GlobalResult,
    type GlobalTeamResult,
    type TournamentRecord,
    TournamentRecordSchema,
    type TournamentTeamRecord,
    TournamentTeamRecordSchema,
} from "../../schema/RecordSchema";
import {db as firestore} from "./config";
import {fetchTournamentEvents} from "./tournamentsService";

type Category = "individual" | "double" | "parent_&_child" | "team_relay" | "special_need";
type EventType = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

const CATEGORIES: Category[] = ["individual", "double", "parent_&_child", "team_relay", "special_need"];
// Event types constant for maintainability
const EVENT_TYPES: EventType[] = ["3-3-3", "3-6-3", "Cycle", "Overall"];

const CATEGORY_LABELS: Record<Category, string> = {
    individual: "Individual",
    double: "Double",
    "parent_&_child": "Parent & Child",
    team_relay: "Team Relay",
    special_need: "Special Need",
};

const EVENT_NAME_TO_COMBOS: Record<string, Array<{category: Category; eventType: EventType}>> = {
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

const buildEventKeyForCategory = (eventType: EventType, category: Category): string =>
    `${eventType}-${CATEGORY_LABELS[category]}`;

const isTeamTournamentRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    "team_id" in record && typeof record.team_id === "string";

const determineRecordRound = (record: TournamentRecord | TournamentTeamRecord): "prelim" | "final" => {
    if (record.round === "prelim" || record.classification === "prelim") {
        return "prelim";
    }
    return "final";
};

const convertRecordToGlobalRecord = (
    record: TournamentRecord | TournamentTeamRecord,
): (GlobalResult | GlobalTeamResult) & {id: string} => {
    const round = determineRecordRound(record);
    const time = typeof record.best_time === "number" ? record.best_time : Number(record.best_time ?? 0);
    const age = typeof record.age === "number" ? record.age : Number.NaN;

    const createdAt =
        (record as TournamentRecord).created_at ?? (record as TournamentTeamRecord).created_at ?? new Date().toISOString();
    const updatedAt = (record as TournamentRecord).updated_at ?? (record as TournamentTeamRecord).updated_at ?? createdAt;

    const base = {
        id: record.id ?? "",
        event: record.event,
        time,
        bestTime: time,
        try1: record.try1,
        try2: record.try2,
        try3: record.try3,
        status: record.status,
        videoUrl: (record as TournamentRecord).video_url ?? (record as TournamentTeamRecord).video_url ?? null,
        verified_by: record.verified_by ?? null,
        verified_at: record.verified_at ?? null,
        created_at: createdAt,
        updated_at: updatedAt,
        age,
        classification: record.classification ?? undefined,
        round,
        tournamentId: record.tournament_id,
        teamId: undefined as string | undefined,
        ageGroup: undefined as string | undefined,
    };

    if (isTeamTournamentRecord(record)) {
        return {
            ...base,
            country: record.country ?? "Unknown",
            teamName: record.team_name ?? "Unknown Team",
            leaderId: record.leader_id ?? undefined,
            members: record.member_global_ids ?? [],
            teamId: record.team_id ?? record.participant_id ?? undefined,
            time,
        } as GlobalTeamResult & {id: string};
    }

    return {
        ...base,
        gender: record.gender ?? "Overall",
        participantId: record.participant_id ?? "",
        participantName: record.participant_name ?? "Unknown",
        country: record.country ?? "Unknown",
    } as GlobalResult & {id: string};
};

interface FetchRecordsOptions {
    round?: "prelim" | "final";
    classification?: string;
}

const fetchVerifiedRecordsForCombos = async (
    combos: Array<{category: Category; eventType: EventType}>,
    options: FetchRecordsOptions = {},
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];

    for (const {category, eventType} of combos) {
        const eventKey = buildEventKeyForCategory(eventType, category);
        const constraints = [where("event", "==", eventKey), where("status", "==", "verified")];

        if (options.classification) {
            constraints.push(where("classification", "==", options.classification));
        }

        if (options.round === "prelim") {
            constraints.push(where("round", "==", "prelim"));
        }

        const recordsQuery = query(collection(firestore, "records"), ...constraints);
        const snapshot = await getDocs(recordsQuery);
        for (const docSnapshot of snapshot.docs) {
            const data = {...docSnapshot.data(), id: docSnapshot.id};
            records.push(normalizeTournamentRecord(data));
        }
    }

    if (options.round === "final") {
        return records.filter((record) => determineRecordRound(record) === "final");
    }

    return records;
};

export const saveRecord = async (data: TournamentRecord): Promise<string> => {
    const now = new Date().toISOString();
    const recordRef = data.id ? doc(firestore, "records", data.id) : doc(collection(firestore, "records"));
    const recordId = recordRef.id;
    const isExistingRecord = Boolean(data.id);

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

    const prelimRecordsQuery = query(
        collection(firestore, `records`),
        where("tournament_id", "==", tournamentId),
        where("classification", "!=", "prelim"),
    );

    const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
    for (const recordDoc of prelimRecordsSnapshot.docs) {
        const data = {...recordDoc.data(), id: recordDoc.id};
        records.push(data as TournamentRecord | TournamentTeamRecord);
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

export const getFinalRecords = async (
    tournamentId: string,
    eventKey: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const seenRecordIds = new Set<string>();
    const normalizedEventKey = eventKey.trim().toLowerCase();
    const addRecord = (raw: Record<string, unknown>) => {
        const normalized = normalizeTournamentRecord(raw);
        const participantKey = "team_id" in normalized ? normalized.team_id : normalized.participant_id;
        const key = normalized.id || `${normalized.tournament_id}-${normalized.event}-${participantKey ?? ""}`;
        if (seenRecordIds.has(key)) {
            return;
        }
        seenRecordIds.add(key);
        records.push(normalized);
    };

    // Split event key to get event type and name
    const eventParts = eventKey.split("-");
    const eventType = eventParts.pop()?.toLowerCase() || "";
    const eventName = eventParts.join("-");

    // Validate that we have a valid event name to avoid double slashes in path
    if (!eventName || eventName.trim() === "") {
        console.warn(`Invalid event key format: ${eventKey}. Expected format: "EventCode-EventType"`);
        return records;
    }
    const trimmedEventName = eventName.trim();

    // Determine event category
    const normalizedType = eventType.toLowerCase().replace(/\s+/g, "");

    let eventCategory: string;
    switch (normalizedType) {
        case "double":
            eventCategory = "double";
            break;
        case "teamrelay":
            eventCategory = "team_relay";
            break;
        case "parent&child":
        case "parentchild":
            eventCategory = "parent_&_child";
            break;
        case "individual":
            eventCategory = "individual";
            break;
        default: {
            // Check if it's a team event based on the full event key
            const isTeamEvent =
                eventKey.toLowerCase().includes("double") ||
                eventKey.toLowerCase().includes("team") ||
                eventKey.toLowerCase().includes("parent");
            eventCategory = isTeamEvent ? "team_relay" : "individual";
            break;
        }
    }

    try {
        const consolidatedQuery = query(collection(firestore, "records"), where("tournament_id", "==", tournamentId));
        const consolidatedSnapshot = await getDocs(consolidatedQuery);
        for (const recordDoc of consolidatedSnapshot.docs) {
            const data = recordDoc.data();
            const eventValue = typeof data.event === "string" ? data.event.trim() : "";
            if (!eventValue || eventValue.toLowerCase() !== normalizedEventKey) {
                continue;
            }
            const classification = typeof data.classification === "string" ? data.classification.toLowerCase() : "";
            if (classification === "prelim") {
                continue;
            }
            addRecord({
                ...data,
                id: recordDoc.id,
                round: data.round ?? "final",
                event: eventValue,
                tournament_id: data.tournament_id ?? tournamentId,
            });
        }
    } catch (error) {
        console.warn(`Unable to load consolidated final records for ${eventKey}:`, error);
    }

    try {
        const finalQuery = query(
            collection(firestore, `tournaments/${tournamentId}/events/final/${eventCategory}/${trimmedEventName}/records`),
        );

        const finalSnapshot = await getDocs(finalQuery);

        // Add final records
        for (const recordDoc of finalSnapshot.docs) {
            const data = recordDoc.data();
            addRecord({
                ...data,
                id: recordDoc.id,
                round: "final",
                event: data.event ?? eventKey,
                tournament_id: data.tournament_id ?? tournamentId,
            });
        }

        // Also check legacy paths for backward compatibility
        if (eventCategory === "team_relay") {
            const legacyFinalQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/final/team-relay/${trimmedEventName}/records`),
            );
            const legacyFinalSnapshot = await getDocs(legacyFinalQuery);
            for (const recordDoc of legacyFinalSnapshot.docs) {
                const data = recordDoc.data();
                addRecord({
                    ...data,
                    id: recordDoc.id,
                    round: "final",
                    event: data.event ?? eventKey,
                    tournament_id: data.tournament_id ?? tournamentId,
                });
            }
        }
        if (eventCategory === "parent_&_child") {
            const legacyFinalQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/final/parent-child/${trimmedEventName}/records`),
            );
            const legacyFinalSnapshot = await getDocs(legacyFinalQuery);
            for (const recordDoc of legacyFinalSnapshot.docs) {
                const data = recordDoc.data();
                addRecord({
                    ...data,
                    id: recordDoc.id,
                    round: "final",
                    event: data.event ?? eventKey,
                    tournament_id: data.tournament_id ?? tournamentId,
                });
            }
        }
    } catch (error) {
        console.error("Error fetching final records:", error);
        throw error;
    }

    return records;
};

// Keep the original function for backward compatibility
export const getRecords = async (
    tournamentId: string,
    eventKey: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const [prelimRecords, finalRecords] = await Promise.all([
        getPrelimRecords(tournamentId, eventKey),
        getFinalRecords(tournamentId, eventKey),
    ]);

    return [...prelimRecords, ...finalRecords];
};

function isCategory(x: string): x is Category {
    return (CATEGORIES as string[]).includes(x);
}
function isEventType(x: string): x is EventType {
    return (EVENT_TYPES as string[]).includes(x);
}

/**
 * New form:
 *   getEventRankings(category, eventType)
 * Legacy form (kept for compatibility):
 *   getEventRankings(event)          // returns across all categories for that event
 *   getEventRankings(event, round)   // round ignored; maintained for callers
 */
export async function getEventRankings(category: Category, eventType: EventType): Promise<(GlobalResult | GlobalTeamResult)[]>;
export async function getEventRankings(event: string, round?: "prelim" | "final"): Promise<(GlobalResult | GlobalTeamResult)[]>;
export async function getEventRankings(a: string, b?: string): Promise<(GlobalResult | GlobalTeamResult)[]> {
    try {
        let combos: Array<{category: Category; eventType: EventType}> = [];
        let roundFilter: "prelim" | "final" | undefined;

        if (b === "prelim" || b === "final") {
            roundFilter = b;
            combos = EVENT_NAME_TO_COMBOS[a] ?? [];
        } else if (b && isCategory(a) && isEventType(b)) {
            combos = [{category: a as Category, eventType: b as EventType}];
        } else {
            combos = EVENT_NAME_TO_COMBOS[a] ?? [];
        }

        if (combos.length === 0) {
            return [];
        }

        const records = await fetchVerifiedRecordsForCombos(combos, {round: roundFilter});
        const converted = records.map(convertRecordToGlobalRecord);

        const filtered = roundFilter ? converted.filter((record) => (record.round ?? "final") === roundFilter) : converted;

        return filtered
            .filter((record) => (record.bestTime ?? record.time ?? Number.MAX_VALUE) > 0)
            .sort((a, b) => (a.bestTime ?? a.time ?? Number.MAX_VALUE) - (b.bestTime ?? b.time ?? Number.MAX_VALUE));
    } catch (error) {
        console.error(`getEventRankings failed:`, error);
        return [];
    }
}

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

export const getBestRecords = async (): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const result: (TournamentRecord | TournamentTeamRecord)[] = [];

    try {
        const recordsQuery = query(collection(firestore, "records"), orderBy("best_time", "asc"));
        const recordsSnapshot = await getDocs(recordsQuery);
        for (const doc of recordsSnapshot.docs) {
            const data = doc.data();
            result.push(normalizeTournamentRecord({...data, id: doc.id}));
        }
    } catch (error) {
        console.error("Error fetching best records:", error);
    }

    return result;
};

// 获取按年龄分组的最佳记录 - 修正版本
export const getBestRecordsByAgeGroup = async (): Promise<
    Record<DisplayCategory, Partial<Record<EventType, (GlobalResult | GlobalTeamResult)[]>>>
> => {
    const result: Record<DisplayCategory, Partial<Record<EventType, (GlobalResult | GlobalTeamResult)[]>>> = {
        Individual: {},
        Double: {},
        "Parent & Child": {},
        "Team Relay": {},
        "Special Need": {},
    };

    // Define the exact combinations you want to display in the backend
    const combos: [Category, EventType][] = [
        ["individual", "3-3-3"],
        ["individual", "3-6-3"],
        ["individual", "Cycle"],
        ["double", "Cycle"],
        ["parent_&_child", "Cycle"],
        ["team_relay", "Cycle"],
        ["team_relay", "3-6-3"],
        ["special_need", "3-3-3"],
        ["special_need", "3-6-3"],
        ["special_need", "Cycle"],
    ];

    for (const [category, eventType] of combos) {
        try {
            // Use the new (category, eventType) signature
            const rows = await getEventRankings(category, eventType);
            // filter invalid times & keep top 10
            const top10 = rows.filter((r) => (r.time ?? 0) > 0).slice(0, 10);
            const displayCategory = CATEGORY_DISPLAY_MAP[category];
            result[displayCategory][eventType] = top10;
        } catch (err) {
            console.warn(`Could not fetch best records for ${category} ${eventType}:`, err);
            const displayCategory = CATEGORY_DISPLAY_MAP[category];
            result[displayCategory][eventType] = [];
        }
    }

    return result;
};

// 获取分类排名记录 - 修正版本
export const getClassificationRankings = async (
    event: string,
    classification: "beginner" | "intermediate" | "advance" | "prelim",
    round?: "prelim" | "final",
): Promise<(GlobalResult | GlobalTeamResult)[]> => {
    try {
        const combos = EVENT_NAME_TO_COMBOS[event] ?? [];
        if (combos.length === 0) {
            return [];
        }

        const records = await fetchVerifiedRecordsForCombos(combos, {classification, round});
        const converted = records.map(convertRecordToGlobalRecord);

        return converted
            .filter((record) => (record.bestTime ?? record.time ?? Number.MAX_VALUE) > 0)
            .sort((a, b) => (a.bestTime ?? a.time ?? Number.MAX_VALUE) - (b.bestTime ?? b.time ?? Number.MAX_VALUE));
    } catch (error) {
        console.error(`获取 ${event} ${classification} 分类排名失败:`, error);
        return [];
    }
};

// 获取所有事件的世界记录 - 修正版本
export const getWorldRecords = async (): Promise<Record<string, (GlobalResult | GlobalTeamResult)[]>> => {
    const worldRecords: Record<string, (GlobalResult | GlobalTeamResult)[]> = {};

    // 定义所有事件类型 - 匹配实际数据库结构
    const events = ["3-3-3", "3-6-3", "Cycle", "Double", "Team Relay"];

    for (const event of events) {
        try {
            const rankings = await getEventRankings(event);
            if (rankings.length > 0) {
                // 只取前10名作为世界记录，过滤掉无效记录
                const validRankings = rankings.filter((record) => record.time > 0);
                worldRecords[event] = validRankings.slice(0, 10);
            } else {
                worldRecords[event] = [];
            }
        } catch (error) {
            console.warn(`Could not fetch world records for ${event}:`, error);
            worldRecords[event] = [];
        }
    }

    return worldRecords;
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
    currentStatus: "submitted" | "verified",
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, "records", recordId);

        if (currentStatus === "submitted") {
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
        const recordRef = doc(firestore, "records", recordId);

        await updateDoc(recordRef, {
            videoUrl: videoUrl,
            updated_at: now,
        });
    } catch (error) {
        console.error(`Failed to update video URL for record ${recordId}:`, error);
        throw error;
    }
};
