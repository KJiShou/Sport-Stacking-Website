import {collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, setDoc, updateDoc, where} from "firebase/firestore";
import type {TeamMember} from "../../schema";
import type {GlobalResult, GlobalTeamResult, TournamentRecord, TournamentTeamRecord} from "../../schema/RecordSchema";
import {db as firestore} from "./config";

export const saveRecord = async (data: {
    tournamentId: string;
    event: string;
    participantId: string;
    participantName: string;
    participantAge?: number;
    country: string;
    gender: string;
    round: "prelim" | "final";
    classification?: "beginner" | "intermediate" | "advance";
    try1: number;
    try2: number;
    try3: number;
    status: "submitted" | "verified";
    videoUrl?: string;
    submitted_at: string;
    verified_by?: string;
    verified_at?: string;
    memberIds?: string[];
    memberNames?: string[];
    leaderId?: string;
}): Promise<void> => {
    const {
        tournamentId,
        event,
        participantId,
        participantName,
        participantAge,
        country,
        round,
        try1,
        try2,
        try3,
        status,
        videoUrl,
        submitted_at,
        verified_by,
        verified_at,
    } = data;

    const bestTime = Math.min(try1, try2, try3);
    const now = new Date().toISOString();

    // Determine if this is a team event
    const isTeamEvent =
        event.toLowerCase().includes("double") ||
        event.toLowerCase().includes("team relay") ||
        event.toLowerCase().includes("parent & child");

    // Split event name to get event type and category
    // Handle multi-word event types like "Team Relay" and "Parent & Child"
    let eventType = "";
    let eventName = "";

    if (event.includes("-Team Relay")) {
        eventType = "team_relay";
        eventName = event.replace("-Team Relay", "");
    } else if (event.includes("-Parent & Child")) {
        eventType = "parent_&_child";
        eventName = event.replace("-Parent & Child", "");
    } else if (event.includes("-Special Need")) {
        eventType = "special_need";
        eventName = event.replace("-Special Need", "");
    } else if (event.includes("-Individual")) {
        eventType = "individual";
        eventName = event.replace("-Individual", "");
    } else if (event.includes("-Double")) {
        eventType = "double";
        eventName = event.replace("-Double", "");
    } else {
        // Fallback for any other formats
        const eventParts = event.split("-");
        eventType = eventParts.pop()?.toLowerCase().replace(/\s+/g, "_") || "";
        eventName = eventParts.join("-");
    }

    // Determine the event category path
    let eventCategory: string;
    switch (eventType) {
        case "double":
            eventCategory = "double";
            break;
        case "team_relay":
            eventCategory = "team_relay";
            break;
        case "parent_&_child":
            eventCategory = "parent_&_child";
            break;
        default:
            eventCategory = "individual";
    }

    // Save to tournament-specific records under the correct path structure
    const recordRef = doc(
        firestore,
        `tournaments/${tournamentId}/events/${round}/${eventCategory}/${eventName}/records`,
        participantId,
    );

    // Base record data
    const baseRecordData = {
        participantId,
        participantAge,
        country,
        event,
        try1,
        try2,
        try3,
        bestTime,
        status,
        classification: data.classification ?? null,
        videoUrl: videoUrl ?? null,
        submitted_at,
        verified_by: verified_by ?? null,
        verified_at: verified_at ?? null,
        created_at: now,
        updated_at: now,
    };

    // Add team-specific fields if it's a team event
    const recordData = isTeamEvent
        ? ({
              ...baseRecordData,
              memberIds: (data as TournamentTeamRecord).memberIds,
              memberNames: (data as TournamentTeamRecord).memberNames,
              leaderId: (data as TournamentTeamRecord).leaderId,
          } as TournamentTeamRecord)
        : (baseRecordData as TournamentRecord);
    await setDoc(recordRef, recordData, {merge: true});

    // Save to global results using new structure: globalResult/Category/Event
    const lowerEvent = event.toLowerCase();
    let globalEventName: string;

    // Extract event code from event name
    if (eventName.includes("3-3-3")) {
        globalEventName = "3-3-3";
    } else if (eventName.includes("3-6-3")) {
        globalEventName = "3-6-3";
    } else if (eventName.includes("cycle")) {
        globalEventName = "Cycle";
    } else {
        globalEventName = eventName || "Unknown";
    }

    const globalResultId = `${tournamentId}_${event}_${participantId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/${eventType}/${globalEventName}`, globalResultId);
    const globalResultData: GlobalResult = {
        event: `${globalEventName}-${eventType}`,
        gender: data.gender,
        participantId,
        participantName,
        country,
        time: bestTime, // Schema uses 'time' not 'bestTime'
        status: data.status,
        videoUrl: data.videoUrl ?? null,
        verified_by: data.verified_by ?? null,
        verified_at: data.verified_at ?? null,
        created_at: now,
        updated_at: now,
        age: participantAge || 0, // Required by schema
    };
    await setDoc(globalResultRef, globalResultData);
};

export const saveTeamRecord = async (data: {
    tournamentId: string;
    event: string;
    participantId: string; // Used as teamId
    teamName: string;
    country: string;
    round: "prelim" | "final";
    classification?: "beginner" | "intermediate" | "advance";
    try1: number;
    try2: number;
    try3: number;
    status: "submitted" | "verified";
    videoUrl?: string;
    submitted_at: string;
    verified_by?: string;
    verified_at?: string;
    leaderId: string;
    memberIds?: string[];
    memberNames?: string[];
    members: TeamMember[];
}): Promise<void> => {
    const {
        tournamentId,
        event,
        participantId, // This is used as teamId
        teamName,
        leaderId,
        members,
        round,
        try1,
        try2,
        try3,
        status,
        videoUrl,
        submitted_at,
        verified_by,
        verified_at,
    } = data;

    const bestTime = Math.min(try1, try2, try3);
    const now = new Date().toISOString();

    // Split event name to get event type and category
    // Handle multi-word event types like "Team Relay" and "Parent & Child"
    let eventType = "";
    let eventName = "";

    if (event.includes("-Team Relay")) {
        eventType = "team_relay";
        eventName = event.replace("-Team Relay", "");
    } else if (event.includes("-Parent & Child")) {
        eventType = "parent_&_child";
        eventName = event.replace("-Parent & Child", "");
    } else if (event.includes("-Special Need")) {
        eventType = "special_need";
        eventName = event.replace("-Special Need", "");
    } else if (event.includes("-Individual")) {
        eventType = "individual";
        eventName = event.replace("-Individual", "");
    } else if (event.includes("-Double")) {
        eventType = "double";
        eventName = event.replace("-Double", "");
    } else {
        // Fallback for any other formats
        const eventParts = event.split("-");
        eventType = eventParts.pop()?.toLowerCase().replace(/\s+/g, "_") || "";
        eventName = eventParts.join("-");
    }

    // Determine the event category path
    let eventCategory: string;
    switch (eventType) {
        case "double":
            eventCategory = "double";
            break;
        case "team_relay":
            eventCategory = "team_relay";
            break;
        case "parent_&_child":
            eventCategory = "parent_&_child";
            break;
        default:
            eventCategory = "team_relay"; // Default for any other team events
    }

    // Save to tournament-specific records
    const recordRef = doc(
        firestore,
        `tournaments/${tournamentId}/events/${round}/${eventCategory}/${eventName}/records`,
        participantId,
    );
    const recordData: TournamentTeamRecord = {
        participantId, // This is the teamId
        leaderId,
        memberIds: members.map((m) => m.global_id || ""),
        memberNames: [], // This will be populated from user data
        country: data.country || "",
        event,
        try1,
        try2,
        try3,
        bestTime,
        status,
        classification: data.classification ?? null,
        videoUrl: videoUrl || null,
        submitted_at,
        verified_by: verified_by || null,
        verified_at: verified_at || null,
        created_at: now,
        updated_at: now,
    };
    await setDoc(recordRef, recordData, {merge: true});

    // Save to global results using new structure: globalResult/Category/Event
    let globalEventName: string;

    // Extract event code from event name
    if (eventName.includes("3-3-3")) {
        globalEventName = "3-3-3";
    } else if (eventName.includes("3-6-3")) {
        globalEventName = "3-6-3";
    } else if (eventName.includes("cycle")) {
        globalEventName = "Cycle";
    } else {
        globalEventName = eventName || "Unknown";
    }

    const globalResultId = `${tournamentId}_${event}_${participantId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/${eventType}/${globalEventName}`, globalResultId);
    const globalResultData: GlobalTeamResult = {
        event: `${globalEventName}-${eventType}`,
        country: data.country || "",
        time: bestTime, // Schema uses 'time' not 'bestTime'
        teamName,
        leaderId,
        members: members.map((m) => m.global_id || ""), // Schema expects array of strings
        status: data.status,
        videoUrl: data.videoUrl ?? null,
        verified_by: data.verified_by ?? null,
        verified_at: data.verified_at ?? null,
        created_at: now,
        updated_at: now,
        age: 0, // Required by schema
    };
    await setDoc(globalResultRef, globalResultData);
};

export const getTournamentPrelimRecords = async (tournamentId: string): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (tournamentSnap.exists()) {
        const tournamentData = tournamentSnap.data();
        if (tournamentData.events && Array.isArray(tournamentData.events)) {
            for (const event of tournamentData.events) {
                // Handle new event structure with codes array
                if (event.codes && Array.isArray(event.codes)) {
                    for (const code of event.codes) {
                        const eventKey = `${code}-${event.type}`;
                        // Handle multi-word event types like "Team Relay" and "Parent & Child"
                        let eventType = "";
                        let eventName = "";

                        if (eventKey.includes("-Team Relay")) {
                            eventType = "team_relay";
                            eventName = eventKey.replace("-Team Relay", "");
                        } else if (eventKey.includes("-Parent & Child")) {
                            eventType = "parent_&_child";
                            eventName = eventKey.replace("-Parent & Child", "");
                        } else if (eventKey.includes("-Special Need")) {
                            eventType = "special_need";
                            eventName = eventKey.replace("-Special Need", "");
                        } else {
                            // Handle single-word types like Individual, Double
                            const eventParts = eventKey.split("-");
                            eventType = eventParts.pop()?.toLowerCase() || "";
                            eventName = eventParts.join("-");
                        }

                        let eventCategory: string;
                        switch (eventType) {
                            case "double":
                                eventCategory = "double";
                                break;
                            case "team_relay":
                                eventCategory = "team_relay";
                                break;
                            case "parent_&_child":
                                eventCategory = "parent_&_child";
                                break;
                            default:
                                eventCategory = "individual";
                        }

                        // Try new path first
                        const prelimRecordsQuery = query(
                            collection(
                                firestore,
                                `tournaments/${tournamentId}/events/prelim/${eventCategory}/${eventName}/records`,
                            ),
                        );

                        const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
                        for (const recordDoc of prelimRecordsSnapshot.docs) {
                            const data = recordDoc.data();
                            data.round = "prelim"; // Ensure round is set
                            records.push(
                                eventCategory === "individual" ? (data as TournamentRecord) : (data as TournamentTeamRecord),
                            );
                        }
                    }
                } else {
                    // Fallback for old event structure (backward compatibility)
                    const eventKey = `${event.code}-${event.type}`;
                    const eventParts = eventKey.split("-");
                    const eventType = eventParts.pop()?.toLowerCase() || "";
                    const eventName = eventParts.join("-");

                    let eventCategory: string;
                    switch (eventType) {
                        case "double":
                            eventCategory = "double";
                            break;
                        case "team_relay":
                            eventCategory = "team_relay";
                            break;
                        case "parent_&_child":
                            eventCategory = "parent_&_child";
                            break;
                        default:
                            eventCategory = "individual";
                    }

                    // Try new path first
                    const prelimRecordsQuery = query(
                        collection(firestore, `tournaments/${tournamentId}/events/prelim/${eventCategory}/${eventName}/records`),
                    );

                    const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
                    for (const recordDoc of prelimRecordsSnapshot.docs) {
                        const data = recordDoc.data();
                        data.round = "prelim"; // Ensure round is set
                        records.push(
                            eventCategory === "individual" ? (data as TournamentRecord) : (data as TournamentTeamRecord),
                        );
                    }
                }
            }
        }
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

    if (tournamentSnap.exists()) {
        const tournamentData = tournamentSnap.data();
        if (tournamentData.events && Array.isArray(tournamentData.events)) {
            for (const event of tournamentData.events) {
                // Handle new event structure with codes array
                if (event.codes && Array.isArray(event.codes)) {
                    for (const code of event.codes) {
                        const eventKey = `${code}-${event.type}`;
                        const {eventName, eventCategory} = parseEventKey(eventKey);

                        const finalRecordsQuery = query(
                            collection(
                                firestore,
                                `tournaments/${tournamentId}/events/final/${eventCategory}/${eventName}/records`,
                            ),
                        );

                        const finalRecordsSnapshot = await getDocs(finalRecordsQuery);
                        for (const recordDoc of finalRecordsSnapshot.docs) {
                            const data = recordDoc.data();
                            data.round = "final"; // Ensure round is set
                            records.push(
                                eventCategory === "individual" ? (data as TournamentRecord) : (data as TournamentTeamRecord),
                            );
                        }
                    }
                } else {
                    // Fallback for old event structure (backward compatibility)
                    const eventKey = `${event.code}-${event.type}`;
                    const {eventName, eventCategory} = parseEventKey(eventKey);

                    const finalRecordsQuery = query(
                        collection(firestore, `tournaments/${tournamentId}/events/final/${eventCategory}/${eventName}/records`),
                    );

                    const finalRecordsSnapshot = await getDocs(finalRecordsQuery);
                    for (const recordDoc of finalRecordsSnapshot.docs) {
                        const data = recordDoc.data();
                        data.round = "final"; // Ensure round is set
                        records.push(
                            eventCategory === "individual" ? (data as TournamentRecord) : (data as TournamentTeamRecord),
                        );
                    }
                }
            }
        }
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

interface GetFastestRecordData {
    event: string;
    round: "prelim" | "final";
    type: "Individual" | "Team Relay";
}

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
    eventKey: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];

    // Split event key to get event type and name
    const eventParts = eventKey.split("-");
    const eventType = eventParts.pop()?.toLowerCase() || "";
    const eventName = eventParts.join("-");

    // Validate that we have a valid event name to avoid double slashes in path
    if (!eventName || eventName.trim() === "") {
        console.warn(`Invalid event key format: ${eventKey}. Expected format: "EventCode-EventType"`);
        return records;
    }

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
        const prelimQuery = query(
            collection(firestore, `tournaments/${tournamentId}/events/prelim/${eventCategory}/${eventName}/records`),
        );

        const prelimSnapshot = await getDocs(prelimQuery);

        // Add prelim records
        for (const recordDoc of prelimSnapshot.docs) {
            const data = recordDoc.data();
            data.round = "prelim"; // Ensure round is set
            records.push(data as TournamentRecord | TournamentTeamRecord);
        }

        // Also check legacy paths for backward compatibility
        if (eventCategory === "team_relay") {
            const legacyPrelimQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/prelim/team-relay/${eventName}/records`),
            );
            const legacyPrelimSnapshot = await getDocs(legacyPrelimQuery);
            for (const recordDoc of legacyPrelimSnapshot.docs) {
                const data = recordDoc.data();
                data.round = "prelim";
                records.push(data as TournamentTeamRecord);
            }
        }
        if (eventCategory === "parent_&_child") {
            const legacyPrelimQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/prelim/parent-child/${eventName}/records`),
            );
            const legacyPrelimSnapshot = await getDocs(legacyPrelimQuery);
            for (const recordDoc of legacyPrelimSnapshot.docs) {
                const data = recordDoc.data();
                data.round = "prelim";
                records.push(data as TournamentTeamRecord);
            }
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

    // Split event key to get event type and name
    const eventParts = eventKey.split("-");
    const eventType = eventParts.pop()?.toLowerCase() || "";
    const eventName = eventParts.join("-");

    // Validate that we have a valid event name to avoid double slashes in path
    if (!eventName || eventName.trim() === "") {
        console.warn(`Invalid event key format: ${eventKey}. Expected format: "EventCode-EventType"`);
        return records;
    }

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
        const finalQuery = query(
            collection(firestore, `tournaments/${tournamentId}/events/final/${eventCategory}/${eventName}/records`),
        );

        const finalSnapshot = await getDocs(finalQuery);

        // Add final records
        for (const recordDoc of finalSnapshot.docs) {
            const data = recordDoc.data();
            data.round = "final"; // Ensure round is set
            records.push(data as TournamentRecord | TournamentTeamRecord);
        }

        // Also check legacy paths for backward compatibility
        if (eventCategory === "team_relay") {
            const legacyFinalQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/final/team-relay/${eventName}/records`),
            );
            const legacyFinalSnapshot = await getDocs(legacyFinalQuery);
            for (const recordDoc of legacyFinalSnapshot.docs) {
                const data = recordDoc.data();
                data.round = "final";
                records.push(data as TournamentTeamRecord);
            }
        }
        if (eventCategory === "parent_&_child") {
            const legacyFinalQuery = query(
                collection(firestore, `tournaments/${tournamentId}/events/final/parent-child/${eventName}/records`),
            );
            const legacyFinalSnapshot = await getDocs(legacyFinalQuery);
            for (const recordDoc of legacyFinalSnapshot.docs) {
                const data = recordDoc.data();
                data.round = "final";
                records.push(data as TournamentTeamRecord);
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

// 获取事件排名记录 - 修正版本
type Category = "individual" | "double" | "parent_&_child" | "team_relay" | "special_need";
type EventType = "3-3-3" | "3-6-3" | "Cycle";

const CATEGORIES: Category[] = ["individual", "double", "parent_&_child", "team_relay", "special_need"];
const EVENT_TYPES: EventType[] = ["3-3-3", "3-6-3", "Cycle"];

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
        // NEW SIGNATURE: (category, eventType)
        if (b && isCategory(a) && isEventType(b)) {
            const category = a as Category;
            const eventType = b as EventType;

            const qCol = collection(firestore, `globalResult/${category}/${eventType}`);
            const snap = await getDocs(qCol);

            const rows: (GlobalResult | GlobalTeamResult)[] = [];

            for (const d of snap.docs) {
                const data = d.data();
                if (category === "individual") {
                    rows.push({
                        id: d.id, // Add the Firestore document ID
                        event: data.event || `${eventType}-${category}`,
                        gender: data.gender || "Overall",
                        participantId: data.participantId || "",
                        participantName: data.participantName || "Unknown",
                        country: data.country || "Unknown",
                        time: data.time || 0,
                        status: data.status || "submitted",
                        videoUrl: data.videoUrl || null,
                        verified_by: data.verified_by || null,
                        verified_at: data.verified_at || null,
                        created_at: data.created_at || new Date().toISOString(),
                        updated_at: data.updated_at || new Date().toISOString(),
                        age: data.age || 0,
                    } as GlobalResult & {id: string});
                } else {
                    rows.push({
                        id: d.id, // Add the Firestore document ID
                        event: data.event || `${eventType}-${category}`,
                        country: data.country || "Unknown",
                        teamName: data.teamName || "Unknown Team",
                        leaderId: data.leaderId || "",
                        members: data.members || [],
                        time: data.time || 0,
                        status: data.status || "submitted",
                        videoUrl: data.videoUrl || null,
                        verified_by: data.verified_by || null,
                        verified_at: data.verified_at || null,
                        created_at: data.created_at || new Date().toISOString(),
                        updated_at: data.updated_at || new Date().toISOString(),
                        age: data.age || 0,
                    } as GlobalTeamResult & {id: string});
                }
            }

            // Sort fastest first, filter invalid times
            return rows
                .filter((r) => (r.time ?? 0) > 0)
                .sort((x, y) => (x.time ?? Number.MAX_VALUE) - (y.time ?? Number.MAX_VALUE));
        }

        // LEGACY SIGNATURE: (event[, round]) → search this event across all categories
        const eventOnly = a;
        const resultsAcross: (GlobalResult | GlobalTeamResult)[] = [];

        for (const cat of CATEGORIES) {
            // Only query if eventOnly is a valid EventType; otherwise skip (avoids bad paths)
            if (!isEventType(eventOnly)) continue;
            const qCol = collection(firestore, `globalResult/${cat}/${eventOnly}`);
            try {
                const snap = await getDocs(qCol);
                for (const d of snap.docs) {
                    const data = d.data();
                    if (cat === "individual") {
                        resultsAcross.push({
                            id: d.id, // Add the Firestore document ID
                            event: data.event || `${eventOnly}-${cat}`,
                            gender: data.gender || "Overall",
                            participantId: data.participantId || "",
                            participantName: data.participantName || "Unknown",
                            country: data.country || "Unknown",
                            time: data.time || 0,
                            status: data.status || "submitted",
                            videoUrl: data.videoUrl || null,
                            verified_by: data.verified_by || null,
                            verified_at: data.verified_at || null,
                            created_at: data.created_at || new Date().toISOString(),
                            updated_at: data.updated_at || new Date().toISOString(),
                            age: data.age || 0,
                        } as GlobalResult & {id: string});
                    } else {
                        resultsAcross.push({
                            id: d.id, // Add the Firestore document ID
                            event: data.event || `${eventOnly}-${cat}`,
                            country: data.country || "Unknown",
                            teamName: data.teamName || "Unknown Team",
                            leaderId: data.leaderId || "",
                            members: data.members || [],
                            time: data.time || 0,
                            status: data.status || "submitted",
                            videoUrl: data.videoUrl || null,
                            verified_by: data.verified_by || null,
                            verified_at: data.verified_at || null,
                            created_at: data.created_at || new Date().toISOString(),
                            updated_at: data.updated_at || new Date().toISOString(),
                            age: data.age || 0,
                        } as GlobalTeamResult & {id: string});
                    }
                }
            } catch (err) {
                console.warn(`Could not fetch ${cat} records for ${eventOnly}:`, err);
            }
        }

        return resultsAcross
            .filter((r) => (r.time ?? 0) > 0)
            .sort((x, y) => (x.time ?? Number.MAX_VALUE) - (y.time ?? Number.MAX_VALUE));
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
    classification: "beginner" | "intermediate" | "advance",
): Promise<(GlobalResult | GlobalTeamResult)[]> => {
    const rankings: (GlobalResult | GlobalTeamResult)[] = [];

    try {
        // Updated logic: globalResult/[Category]/[EventType]
        const categories = ["individual", "parent_&_child", "double", "team_relay", "special_need"];

        for (const category of categories) {
            try {
                const categoryQuery = query(collection(firestore, `globalResult/${category}/${event}`));

                const categorySnapshot = await getDocs(categoryQuery);
                for (const doc of categorySnapshot.docs) {
                    const data = doc.data();

                    // Filter by classification in memory
                    if (data.classification === classification) {
                        if (category === "Individual") {
                            // Individual records
                            rankings.push({
                                event: data.event || `${event}-${category}`,
                                gender: data.gender || "Overall",
                                participantId: data.participantId || "",
                                participantName: data.participantName || "Unknown",
                                country: data.country || "Unknown",
                                time: data.time || 0,
                                created_at: data.created_at || new Date().toISOString(),
                                updated_at: data.updated_at || new Date().toISOString(),
                                age: data.age || 0,
                            } as GlobalResult);
                        } else {
                            // Team records
                            rankings.push({
                                event: data.event || `${event}-${category}`,
                                country: data.country || "Unknown",
                                teamName: data.teamName || "Unknown Team",
                                leaderId: data.leaderId || "",
                                members: data.members || [],
                                time: data.time || 0,
                                created_at: data.created_at || new Date().toISOString(),
                                updated_at: data.updated_at || new Date().toISOString(),
                                age: data.age || 0,
                            } as GlobalTeamResult);
                        }
                    }
                }
            } catch (error) {
                console.warn(`Could not fetch ${category} classification records for ${event}:`, error);
            }
        }

        // 在内存中排序，避免 Firestore 索引问题
        return rankings.sort((a, b) => (a.time || Number.MAX_VALUE) - (b.time || Number.MAX_VALUE));
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
export const deleteRecord = async (category: Category, eventType: EventType, recordId: string): Promise<void> => {
    try {
        const recordRef = doc(firestore, `globalResult/${category}/${eventType}`, recordId);
        await deleteDoc(recordRef);
    } catch (error) {
        console.error(`Failed to delete record ${recordId}:`, error);
        throw error;
    }
};

// Verify/Unverify record service
export const toggleRecordVerification = async (
    category: Category,
    eventType: EventType,
    recordId: string,
    verifiedBy: string,
    currentStatus: "submitted" | "verified",
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, `globalResult/${category}/${eventType}`, recordId);

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

// Legacy function name for backward compatibility
export const verifyRecord = async (
    category: Category,
    eventType: EventType,
    recordId: string,
    verifiedBy: string,
): Promise<void> => {
    return toggleRecordVerification(category, eventType, recordId, verifiedBy, "submitted");
};

// Add/Update video URL service
export const updateRecordVideoUrl = async (
    category: Category,
    eventType: EventType,
    recordId: string,
    videoUrl: string,
): Promise<void> => {
    try {
        const now = new Date().toISOString();
        const recordRef = doc(firestore, `globalResult/${category}/${eventType}`, recordId);

        await updateDoc(recordRef, {
            videoUrl: videoUrl,
            updated_at: now,
        });
    } catch (error) {
        console.error(`Failed to update video URL for record ${recordId}:`, error);
        throw error;
    }
};
