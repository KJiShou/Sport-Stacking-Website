import {collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where} from "firebase/firestore";
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
    const eventParts = event.split("-");
    const eventType = eventParts.pop()?.toLowerCase() || ""; // Gets the last part (Individual/Double/etc)
    const eventName = eventParts.join("-"); // Rejoins the rest of the parts for the event name

    // Determine the event category path
    let eventCategory: string;
    switch (eventType) {
        case "double":
            eventCategory = "double";
            break;
        case "team relay":
        case "teamrelay":
            eventCategory = "team-relay";
            break;
        case "parent & child":
        case "parent&child":
        case "parentchild":
            eventCategory = "parent-child";
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
        classification: data.classification,
        videoUrl: videoUrl || null,
        submitted_at,
        verified_by: verified_by || null,
        verified_at: verified_at || null,
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

    // Save to global results
    const lowerEvent = event.toLowerCase();
    let collectionName: string;

    if (lowerEvent.includes("3-3-3")) {
        collectionName = "3-3-3-Individual";
    } else if (lowerEvent.includes("3-6-3")) {
        collectionName = "3-6-3-Individual";
    } else if (lowerEvent.includes("cycle")) {
        collectionName = "Cycle-Individual";
    } else {
        const eventCode = event.split("-")[0];
        collectionName = `${eventCode}-Individual`;
    }

    const globalResultId = `${tournamentId}_${event}_${participantId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/Individual/${collectionName}`, globalResultId);
    const globalResultData: GlobalResult = {
        event: collectionName,
        gender: data.gender,
        participantId,
        participantName,
        country,
        time: bestTime, // Schema uses 'time' not 'bestTime'
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
    const eventParts = event.split("-");
    const eventType = eventParts.pop()?.toLowerCase() || ""; // Gets the last part (Double/Team Relay/etc)
    const eventName = eventParts.join("-"); // Rejoins the rest of the parts for the event name

    // Determine the event category path
    let eventCategory: string;
    switch (eventType) {
        case "double":
            eventCategory = "double";
            break;
        case "team relay":
        case "teamrelay":
            eventCategory = "team-relay";
            break;
        case "parent & child":
        case "parent&child":
        case "parentchild":
            eventCategory = "parent-child";
            break;
        default:
            eventCategory = "team"; // Default for any other team events
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
        classification: data.classification,
        videoUrl: videoUrl || null,
        submitted_at,
        verified_by: verified_by || null,
        verified_at: verified_at || null,
        created_at: now,
        updated_at: now,
    };
    await setDoc(recordRef, recordData, {merge: true});

    // Save to global results
    const lowerEvent = event.toLowerCase();
    let collectionName: string;

    if (lowerEvent.includes("double")) {
        collectionName = "Double-Team";
    } else if (lowerEvent.includes("parent & child")) {
        collectionName = "Parent & Child-Team";
    } else if (lowerEvent.includes("3-3-3")) {
        collectionName = "3-3-3-Team";
    } else if (lowerEvent.includes("3-6-3")) {
        collectionName = "3-6-3-Team";
    } else if (lowerEvent.includes("cycle")) {
        collectionName = "Cycle-Team";
    } else {
        const eventCode = event.split("-")[0];
        collectionName = `${eventCode}-Team`;
    }

    const globalResultId = `${tournamentId}_${event}_${participantId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/Team/${collectionName}`, globalResultId);
    const globalResultData: GlobalTeamResult = {
        event: collectionName,
        country: data.country || "",
        time: bestTime, // Schema uses 'time' not 'bestTime'
        teamName,
        leaderId,
        members: members.map(m => m.global_id || ""), // Schema expects array of strings
        created_at: now,
        updated_at: now,
        age: 0, // Required by schema
    };
    await setDoc(globalResultRef, globalResultData);
};

export const getTournamentPrelimRecords = async (
    tournamentId: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (tournamentSnap.exists()) {
        const tournamentData = tournamentSnap.data();
        if (tournamentData.events && Array.isArray(tournamentData.events)) {
            for (const event of tournamentData.events) {
                const eventKey = `${event.code}-${event.type}`;
                const eventParts = eventKey.split("-");
                const eventType = eventParts.pop()?.toLowerCase() || "";
                const eventName = eventParts.join("-");

                let eventCategory: string;
                switch (eventType) {
                    case "double":
                        eventCategory = "double";
                        break;
                    case "team relay":
                    case "team-relay":
                    case "teamrelay":
                        eventCategory = "team-relay";
                        break;
                    case "parent & child":
                    case "parent&child":
                    case "parentchild":
                        eventCategory = "parent-child";
                        break;
                    default:
                        eventCategory = "individual";
                }

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

    return records;
};

export const getTournamentFinalRecords = async (
    tournamentId: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
    const records: (TournamentRecord | TournamentTeamRecord)[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (tournamentSnap.exists()) {
        const tournamentData = tournamentSnap.data();
        if (tournamentData.events && Array.isArray(tournamentData.events)) {
            for (const event of tournamentData.events) {
                const eventKey = `${event.code}-${event.type}`;
                const eventParts = eventKey.split("-");
                const eventType = eventParts.pop()?.toLowerCase() || "";
                const eventName = eventParts.join("-");

                let eventCategory: string;
                switch (eventType) {
                    case "double":
                        eventCategory = "double";
                        break;
                    case "team relay":
                    case "team-relay":
                    case "teamrelay":
                        eventCategory = "team-relay";
                        break;
                    case "parent & child":
                    case "parent&child":
                    case "parentchild":
                        eventCategory = "parent-child";
                        break;
                    default:
                        eventCategory = "individual";
                }

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

    return records;
};

// Keep the original function for backward compatibility
export const getTournamentRecords = async (
    tournamentId: string,
): Promise<(TournamentRecord | TournamentTeamRecord)[]> => {
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
    const {event, round, type} = data;
    const q = query(
        collection(firestore, `globalResult/${type}/${event}`),
        where("event", "==", event),
        where("round", "==", round),
        orderBy("bestTime", "asc"),
        limit(1),
    );

    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
        return null;
    }

    return querySnapshot.docs[0].data() as GlobalResult;
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

    // Determine event category
    const normalizedType = eventType.toLowerCase().replace(/\s+/g, "");

    let eventCategory: string;
    switch (normalizedType) {
        case "double":
            eventCategory = "double";
            break;
        case "teamrelay":
            eventCategory = "team-relay";
            break;
        case "parent&child":
        case "parentchild":
            eventCategory = "parent-child";
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
            eventCategory = isTeamEvent ? "team" : "individual";
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

    // Determine event category
    const normalizedType = eventType.toLowerCase().replace(/\s+/g, "");

    let eventCategory: string;
    switch (normalizedType) {
        case "double":
            eventCategory = "double";
            break;
        case "teamrelay":
            eventCategory = "team-relay";
            break;
        case "parent&child":
        case "parentchild":
            eventCategory = "parent-child";
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
            eventCategory = isTeamEvent ? "team" : "individual";
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

// 新增：获取事件排名记录
export const getEventRankings = async (event: string, round: "prelim" | "final" = "final"): Promise<GlobalResult[]> => {
    const rankings: GlobalResult[] = [];

    try {
        // 获取个人项目排名 - 简化查询避免索引问题
        const individualQuery = query(
            collection(firestore, `globalResult/Individual/${event}-Individual`),
            where("round", "==", round),
        );

        const individualSnapshot = await getDocs(individualQuery);
        for (const doc of individualSnapshot.docs) {
            rankings.push(doc.data() as GlobalResult);
        }

        // 获取团队项目排名 - 简化查询避免索引问题
        const teamQuery = query(collection(firestore, `globalResult/Team/${event}-Team`), where("round", "==", round));

        const teamSnapshot = await getDocs(teamQuery);
        for (const doc of teamSnapshot.docs) {
            rankings.push(doc.data() as GlobalResult);
        }

        // 在内存中排序，避免 Firestore 索引问题
        return rankings.sort((a, b) => a.time - b.time);
    } catch (error) {
        console.error(`获取 ${event} 排名失败:`, error);
        return [];
    }
};

// 新增：获取按年龄分组的最佳记录
export const getBestRecordsByAgeGroup = async (): Promise<Record<string, GlobalResult[]>> => {
    const allRecords: Record<string, GlobalResult[]> = {};

    try {
        const events = ["3-3-3", "3-6-3", "Cycle", "Double", "Parent & Child"];

        for (const event of events) {
            const records = await getEventRankings(event, "final");

            // 由于 GlobalResult 没有年龄信息，我们直接按最佳时间排序
            // 每个事件只保留前10名最佳记录
            allRecords[event] = records.slice(0, 10);
        }

        return allRecords;
    } catch (error) {
        console.error("获取按年龄分组的最佳记录失败:", error);
        return {};
    }
};

// 新增：获取分类排名记录
export const getClassificationRankings = async (
    event: string,
    classification: "beginner" | "intermediate" | "advance",
    round: "prelim" | "final" = "final",
): Promise<GlobalResult[]> => {
    const rankings: GlobalResult[] = [];

    try {
        // 获取个人项目分类排名 - 简化查询避免索引问题
        const individualQuery = query(
            collection(firestore, `globalResult/Individual/${event}-Individual`),
            where("round", "==", round),
            where("classification", "==", classification),
        );

        const individualSnapshot = await getDocs(individualQuery);
        for (const doc of individualSnapshot.docs) {
            rankings.push(doc.data() as GlobalResult);
        }

        // 获取团队项目分类排名 - 简化查询避免索引问题
        const teamQuery = query(
            collection(firestore, `globalResult/Team/${event}-Team`),
            where("round", "==", round),
            where("classification", "==", classification),
        );

        const teamSnapshot = await getDocs(teamQuery);
        for (const doc of teamSnapshot.docs) {
            rankings.push(doc.data() as GlobalResult);
        }

        // 在内存中排序，避免 Firestore 索引问题
        return rankings.sort((a, b) => a.time - b.time);
    } catch (error) {
        console.error(`获取 ${event} ${classification} 分类排名失败:`, error);
        return [];
    }
};

// 新增：获取所有事件的世界记录
export const getWorldRecords = async (): Promise<Record<string, GlobalResult[]>> => {
    const worldRecords: Record<string, GlobalResult[]> = {};

    // 定义所有事件类型 - 匹配实际数据库结构
    const events = ["3-3-3", "3-6-3", "Cycle", "Double", "Parent & Child"];

    for (const event of events) {
        const rankings = await getEventRankings(event, "final");
        if (rankings.length > 0) {
            // 只取前10名作为世界记录
            worldRecords[event] = rankings.slice(0, 10);
        }
    }

    return worldRecords;
};
