import {collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where} from "firebase/firestore";
import type {TeamMember} from "../../schema";
import type {GlobalResult, TournamentRecord} from "../../schema/RecordSchema";
import type {Registration} from "../../schema/RegistrationSchema";
import {db as firestore} from "./config";

interface SaveRecordData {
    tournamentId: string;
    event: string;
    participantId: string;
    participantName: string;
    participantAge: number;
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
}

export const saveRecord = async (data: SaveRecordData): Promise<void> => {
    const {
        tournamentId,
        event,
        participantId,
        participantName,
        participantAge,
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

    // Save to tournament-specific records
    const recordRef = doc(firestore, `tournaments/${tournamentId}/events/${event}/${round}/${participantId}`);
    const recordData: TournamentRecord = {
        participantId,
        participantAge,
        round,
        classification: data.classification,
        event,
        try1,
        try2,
        try3,
        bestTime,
        status,
        videoUrl: videoUrl || null,
        submitted_at,
        verified_by: verified_by || null,
        verified_at: verified_at || null,
    };
    await setDoc(recordRef, recordData, {merge: true});

    // Save to global results
    const globalResultId = `${tournamentId}_${event}_${participantId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/Individual/${event}`, globalResultId);
    const globalResultData: GlobalResult = {
        tournamentId,
        event,
        participantId,
        participantName,
        round,
        classification: data.classification,
        bestTime,
        try1,
        try2,
        try3,
    };
    await setDoc(globalResultRef, globalResultData);
};

interface SaveTeamRecordData {
    tournamentId: string;
    event: string;
    teamId: string;
    teamName: string;
    leaderId: string;
    members: TeamMember[];
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
}

export const saveTeamRecord = async (data: SaveTeamRecordData): Promise<void> => {
    const {
        tournamentId,
        event,
        teamId,
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

    // Save to tournament-specific records
    const recordRef = doc(firestore, `tournaments/${tournamentId}/events/${event}/${round}/${teamId}`);
    const recordData: TournamentRecord = {
        teamId,
        leaderId,
        round,
        classification: data.classification,
        event,
        try1,
        try2,
        try3,
        bestTime,
        status,
        videoUrl: videoUrl || null,
        submitted_at,
        verified_by: verified_by || null,
        verified_at: verified_at || null,
    };
    await setDoc(recordRef, recordData, {merge: true});

    // Save to global results
    const globalResultId = `${tournamentId}_${event}_${teamId}_${round}`;
    const globalResultRef = doc(firestore, `globalResult/Team/${event}`, globalResultId);
    const globalResultData: GlobalResult = {
        tournamentId,
        event,
        teamId,
        teamName,
        leaderId,
        members,
        round,
        classification: data.classification,
        bestTime,
        try1,
        try2,
        try3,
    };
    await setDoc(globalResultRef, globalResultData);
};

export const getTournamentRecords = async (tournamentId: string): Promise<TournamentRecord[]> => {
    const records: TournamentRecord[] = [];
    const tournamentRef = doc(firestore, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (tournamentSnap.exists()) {
        const tournamentData = tournamentSnap.data();
        if (tournamentData.events && Array.isArray(tournamentData.events)) {
            for (const event of tournamentData.events) {
                const eventKey = `${event.code}-${event.type}`;
                const prelimRecordsQuery = query(collection(firestore, `tournaments/${tournamentId}/events/${eventKey}/prelim`));
                const finalRecordsQuery = query(collection(firestore, `tournaments/${tournamentId}/events/${eventKey}/final`));
                const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
                for (const recordDoc of prelimRecordsSnapshot.docs) {
                    records.push(recordDoc.data() as TournamentRecord);
                }
                const finalRecordsSnapshot = await getDocs(finalRecordsQuery);
                for (const recordDoc of finalRecordsSnapshot.docs) {
                    records.push(recordDoc.data() as TournamentRecord);
                }
            }
        }
    }

    return records;
};

interface GetFastestRecordData {
    event: string;
    round: "prelim" | "final";
    type: "Individual" | "Team Relay";
}

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

export const getRecords = async (tournamentId: string, eventKey: string): Promise<TournamentRecord[]> => {
    const records: TournamentRecord[] = [];

    const prelimRecordsQuery = query(collection(firestore, `tournaments/${tournamentId}/events/${eventKey}/prelim`));
    const finalRecordsQuery = query(collection(firestore, `tournaments/${tournamentId}/events/${eventKey}/final`));

    const prelimRecordsSnapshot = await getDocs(prelimRecordsQuery);
    for (const recordDoc of prelimRecordsSnapshot.docs) {
        records.push(recordDoc.data() as TournamentRecord);
    }

    const finalRecordsSnapshot = await getDocs(finalRecordsQuery);
    for (const recordDoc of finalRecordsSnapshot.docs) {
        records.push(recordDoc.data() as TournamentRecord);
    }

    return records;
};
