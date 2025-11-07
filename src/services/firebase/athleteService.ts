import {type QueryConstraint, collection, getCountFromServer, getDocs, query, where} from "firebase/firestore";

import type {CachedTournamentResult, CachedTournamentSummary, FirestoreUser, Tournament, UserTournamentHistory} from "@/schema";

import {getUserByGlobalId} from "./authService";
import {db as firestore} from "./config";
import {fetchTournamentById} from "./tournamentsService";
import {fetchUserTournamentHistory} from "./userHistoryService";

type IndividualEvent = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

const INDIVIDUAL_EVENTS: IndividualEvent[] = ["3-3-3", "3-6-3", "Cycle", "Overall"];
const ROUND_OPTIONS = new Set(["advance", "intermediate", "beginner", "prelim"]);

function normalizeIndividualEventLabel(event?: string | null): IndividualEvent | null {
    if (!event) {
        return null;
    }
    const normalized = event.toLowerCase();
    if (normalized.includes("3-3-3")) {
        return "3-3-3";
    }
    if (normalized.includes("3-6-3")) {
        return "3-6-3";
    }
    if (normalized.includes("cycle")) {
        return "Cycle";
    }
    if (normalized.includes("overall")) {
        return "Overall";
    }
    return null;
}

interface AthleteRecordSummary {
    id: string;
    event: string;
    time: number;
    status: string;
    tournamentId?: string;
    tournamentName?: string;
    createdAt: Date | null;
    updatedAt: Date | null;
    participantName?: string;
    gender?: string;
    age?: number | null;
    country?: string;
    source?: "record" | "registration";
    round?: string | null;
}

export interface AthleteEventSummary {
    event: IndividualEvent;
    bestTime: number;
    rank: number | null;
    fasterCount: number | null;
    bestRecord: AthleteRecordSummary;
    lastUpdated: Date | null;
    round: "advance" | "intermediate" | "beginner" | "prelim" | null;
}

export interface AthleteTournamentParticipation {
    tournamentId: string;
    tournamentName: string;
    startDate: Date | null;
    endDate: Date | null;
    country: string | null;
    events: AthleteRecordSummary[];
}

export interface AthleteProfile {
    id: string;
    name: string;
    gender: string | null;
    age: number | null;
    country: string | null;
    avatarUrl: string | null;
    eventSummaries: AthleteEventSummary[];
    tournaments: AthleteTournamentParticipation[];
}

interface TournamentInfo {
    name: string;
    startDate: Date | null;
    endDate: Date | null;
    country: string | null;
}

interface EventRecordsResult {
    event: IndividualEvent;
    records: AthleteRecordSummary[];
    bestRecord: AthleteRecordSummary | null;
    rank: number | null;
    fasterCount: number | null;
}

function normalizeRound(round?: string | null): "advance" | "intermediate" | "beginner" | "prelim" | null {
    if (!round) {
        return null;
    }
    const lowered = round.toLowerCase();
    const validRounds = new Set(["advance", "intermediate", "beginner", "prelim"]);
    return validRounds.has(lowered) ? (lowered as "advance" | "intermediate" | "beginner" | "prelim") : null;
}

function isOverallEventLabel(event?: string | null): boolean {
    if (!event) {
        return false;
    }
    return event.toLowerCase().includes("overall");
}

export async function fetchAthleteProfile(participantId: string): Promise<AthleteProfile | null> {
    const [eventResults, user, history] = await Promise.all([
        Promise.all(INDIVIDUAL_EVENTS.map((event) => loadEventRecords(event, participantId))),
        getUserProfileSafe(participantId),
        fetchUserTournamentHistory(participantId).catch((error) => {
            console.warn(`Failed to fetch cached tournament history for ${participantId}`, error);
            return null;
        }),
    ]);

    const eventSummariesRaw = eventResults.filter(
        (result): result is EventRecordsResult => result !== null && result.records.length > 0,
    );

    if (eventSummariesRaw.length === 0 && !user) {
        return null;
    }

    const allRecords = eventSummariesRaw.flatMap((summary) => summary.records);
    const historyRecords = history ? flattenHistory(history) : [];

    const fallbacks = deriveFallbackIdentity([...allRecords, ...historyRecords]);

    const registrationParticipation = buildRegistrationParticipation(user);
    const registrationRecords = Array.from(registrationParticipation.values()).flat();

    const tournamentsById = await collectTournamentInfo([...allRecords, ...registrationRecords, ...historyRecords]);

    const eventSummaryMap = new Map<IndividualEvent, AthleteEventSummary>();

    const upsertEventSummary = (
        event: IndividualEvent,
        record: AthleteRecordSummary,
        context: {rank: number | null; fasterCount: number | null} = {rank: null, fasterCount: null},
    ) => {
        if (!record.time || record.time <= 0) {
            return;
        }
        const normalizedRound = normalizeRound(record.round);
        const existing = eventSummaryMap.get(event);
        if (existing && existing.bestTime <= record.time) {
            return;
        }

        const resolvedTournamentName = record.tournamentId
            ? (tournamentsById.get(record.tournamentId)?.name ?? record.tournamentId)
            : record.tournamentName;

        eventSummaryMap.set(event, {
            event,
            bestTime: record.time,
            rank: context.rank ?? existing?.rank ?? null,
            fasterCount: context.fasterCount ?? existing?.fasterCount ?? null,
            lastUpdated: record.updatedAt ?? record.createdAt ?? existing?.lastUpdated ?? null,
            bestRecord: {
                ...record,
                tournamentName: resolvedTournamentName,
            },
            round: event === "Overall" ? normalizedRound : (existing?.round ?? normalizedRound ?? null),
        });
    };

    for (const summary of eventSummariesRaw) {
        if (!summary.bestRecord) {
            continue;
        }
        upsertEventSummary(summary.event, summary.bestRecord, {rank: summary.rank, fasterCount: summary.fasterCount});
    }

    for (const historyRecord of historyRecords) {
        const normalizedEvent = normalizeIndividualEventLabel(historyRecord.event);
        if (!normalizedEvent) {
            continue;
        }
        upsertEventSummary(normalizedEvent, historyRecord);
    }

    const eventSummaries = Array.from(eventSummaryMap.values()).sort((a, b) => a.bestTime - b.bestTime);

    const groupedRecords = groupRecordsByTournament([...allRecords, ...historyRecords]);
    for (const [tournamentId, records] of registrationParticipation.entries()) {
        const bucket = groupedRecords.get(tournamentId) ?? [];
        bucket.push(...records);
        groupedRecords.set(tournamentId, bucket);
    }

    const tournaments: AthleteTournamentParticipation[] = Array.from(groupedRecords.entries())
        .map(([tournamentId, records]) => {
            const info = tournamentsById.get(tournamentId);
            const filtered = records.reduce<AthleteRecordSummary[]>((acc, record) => {
                const normalizedRound = normalizeRound(record.round);
                if (!isOverallEventLabel(record.event) || !normalizedRound || record.time <= 0) {
                    return acc;
                }
                acc.push({
                    ...record,
                    round: normalizedRound,
                    tournamentName: info?.name ?? record.tournamentName ?? `Tournament ${tournamentId}`,
                    event: "Overall",
                });
                return acc;
            }, []);

            if (filtered.length === 0) {
                return null;
            }

            const sortedRecords = filtered.sort((a, b) => {
                const left = (a.updatedAt ?? a.createdAt)?.getTime() ?? 0;
                const right = (b.updatedAt ?? b.createdAt)?.getTime() ?? 0;
                return right - left;
            });

            return {
                tournamentId,
                tournamentName: info?.name ?? `Tournament ${tournamentId}`,
                startDate: info?.startDate ?? null,
                endDate: info?.endDate ?? null,
                country: info?.country ?? null,
                events: sortedRecords,
            };
        })
        .filter((tournament): tournament is AthleteTournamentParticipation => tournament !== null);

    return {
        id: participantId,
        name: user?.name ?? fallbacks.name ?? `Athlete ${participantId}`,
        gender: user?.gender ?? fallbacks.gender ?? null,
        age: deriveAge(user) ?? fallbacks.age ?? null,
        country: deriveCountry(user) ?? fallbacks.country ?? null,
        avatarUrl: deriveAvatarUrl(user),
        eventSummaries,
        tournaments,
    };
}

async function loadEventRecords(event: IndividualEvent, participantId: string): Promise<EventRecordsResult | null> {
    try {
        const baseRef = collection(firestore, `globalResult/individual/${event}`);
        const constraints: QueryConstraint[] = [where("participantId", "==", participantId)];
        const snapshot = await getDocs(query(baseRef, ...constraints));

        if (snapshot.empty) {
            return {
                event,
                records: [],
                bestRecord: null,
                rank: null,
                fasterCount: null,
            };
        }

        const records: AthleteRecordSummary[] = snapshot.docs
            .map((doc) => normalizeRecord(event, doc.id, doc.data() as Record<string, unknown>))
            .filter((record): record is AthleteRecordSummary => record.time > 0);

        if (records.length === 0) {
            return {
                event,
                records: [],
                bestRecord: null,
                rank: null,
                fasterCount: null,
            };
        }

        records.sort((a, b) => a.time - b.time);
        const bestRecord = records[0];

        let fasterCount: number | null = null;
        let rank: number | null = null;

        try {
            const fasterSnapshot = await getCountFromServer(query(baseRef, where("time", "<", bestRecord.time)));
            fasterCount = fasterSnapshot.data().count;
            rank = fasterCount + 1;
        } catch (error) {
            console.warn(`Failed to compute live ranking for ${event} and athlete ${participantId}`, error);
        }

        return {
            event,
            records,
            bestRecord,
            rank,
            fasterCount,
        };
    } catch (error) {
        console.error(`Failed to load records for ${event} and athlete ${participantId}`, error);
        return null;
    }
}

function normalizeRecord(event: IndividualEvent, id: string, data: Record<string, unknown>): AthleteRecordSummary {
    const createdAt = toDate(data.created_at);
    const updatedAt = toDate(data.updated_at);
    const age = typeof data.age === "number" && Number.isFinite(data.age) ? data.age : null;
    const candidates = [data.bestTime, data.time, data.try1, data.try2, data.try3]
        .map((value) => {
            if (typeof value === "number") {
                return value;
            }
            if (typeof value === "string" && value.trim().length > 0) {
                const numeric = Number.parseFloat(value);
                return Number.isFinite(numeric) ? numeric : Number.NaN;
            }
            return Number.NaN;
        })
        .filter((value) => Number.isFinite(value) && value > 0);
    const bestTime = candidates.length > 0 ? Math.min(...candidates) : 0;
    return {
        id,
        event,
        time: bestTime,
        status: typeof data.status === "string" ? data.status : "submitted",
        tournamentId: typeof data.tournamentId === "string" ? data.tournamentId : undefined,
        createdAt,
        updatedAt,
        participantName: typeof data.participantName === "string" ? data.participantName : undefined,
        gender: typeof data.gender === "string" ? data.gender : undefined,
        age,
        country: typeof data.country === "string" ? data.country : undefined,
        source: "record",
        round: typeof data.round === "string" ? data.round : undefined,
    };
}

function toDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "object") {
        const maybeTimestamp = value as {toDate?: () => Date; seconds?: number; nanoseconds?: number};
        if (typeof maybeTimestamp.toDate === "function") {
            const parsed = maybeTimestamp.toDate();
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof maybeTimestamp.seconds === "number") {
            const millis = maybeTimestamp.seconds * 1000 + (maybeTimestamp.nanoseconds ?? 0) / 1_000_000;
            const parsed = new Date(millis);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    return null;
}

function deriveFallbackIdentity(records: AthleteRecordSummary[]) {
    let name: string | undefined;
    let gender: string | undefined;
    let country: string | undefined;
    let age: number | null = null;

    for (const record of records) {
        if (!name && record.participantName) {
            name = record.participantName;
        }
        if (!gender && record.gender) {
            gender = record.gender;
        }
        if (!country && record.country) {
            country = record.country;
        }
        if (age === null && typeof record.age === "number") {
            age = record.age;
        }
    }

    return {name, gender, country, age};
}

async function collectTournamentInfo(records: AthleteRecordSummary[]): Promise<Map<string, TournamentInfo>> {
    const map = new Map<string, TournamentInfo>();
    const uniqueIds = Array.from(
        new Set(
            records
                .map((record) => record.tournamentId)
                .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
    );

    await Promise.all(
        uniqueIds.map(async (tournamentId) => {
            try {
                const tournament = await fetchTournamentById(tournamentId);
                if (!tournament) {
                    return;
                }
                map.set(tournamentId, {
                    name: tournament.name ?? `Tournament ${tournamentId}`,
                    startDate: toDate(tournament.start_date),
                    endDate: toDate(tournament.end_date),
                    country: deriveTournamentCountry(tournament),
                });
            } catch (error) {
                console.warn(`Failed to fetch tournament ${tournamentId}`, error);
            }
        }),
    );

    return map;
}

function groupRecordsByTournament(records: AthleteRecordSummary[]): Map<string, AthleteRecordSummary[]> {
    const map = new Map<string, AthleteRecordSummary[]>();

    for (const record of records) {
        if (!record.tournamentId) {
            continue;
        }
        const bucket = map.get(record.tournamentId) ?? [];
        bucket.push(record);
        map.set(record.tournamentId, bucket);
    }

    return map;
}

function buildRegistrationParticipation(user?: FirestoreUser): Map<string, AthleteRecordSummary[]> {
    const map = new Map<string, AthleteRecordSummary[]>();
    const records = user?.registration_records ?? [];
    for (const registration of records) {
        const tournamentId = registration.tournament_id;
        if (!tournamentId) {
            continue;
        }

        const events =
            Array.isArray(registration.events) && registration.events.length > 0 ? registration.events : ["Registered"];
        const statusLabel = typeof registration.status === "string" ? registration.status : "registered";
        const createdAt = toDate(registration.registration_date);
        const updatedAt = toDate(registration.updated_at) ?? createdAt;
        const idSeed = createdAt?.getTime() ?? Date.now();

        const bucket = map.get(tournamentId) ?? [];

        events.forEach((eventName, index) => {
            const label = typeof eventName === "string" && eventName.trim().length > 0 ? eventName : "Registered Event";
            bucket.push({
                id: `${tournamentId}_registration_${idSeed}_${index}`,
                event: label,
                time: 0,
                status: statusLabel,
                tournamentId,
                createdAt,
                updatedAt,
                participantName: user?.name ?? undefined,
                gender: user?.gender ?? undefined,
                age: deriveAge(user),
                country: deriveCountry(user) ?? undefined,
                source: "registration",
                round: undefined,
            });
        });

        map.set(tournamentId, bucket);
    }

    return map;
}

function flattenHistory(history: UserTournamentHistory): AthleteRecordSummary[] {
    const output: AthleteRecordSummary[] = [];
    for (const summary of history.tournaments ?? []) {
        const converted = convertHistorySummary(summary);
        output.push(...converted);
    }
    return output;
}

function convertHistorySummary(summary: CachedTournamentSummary): AthleteRecordSummary[] {
    const tournamentId = summary.tournamentId;
    const tournamentName = summary.tournamentName ?? undefined;
    const results = summary.results ?? [];
    return results
        .map((result) => convertHistoryResult(tournamentId, tournamentName, result))
        .filter((record): record is AthleteRecordSummary => record !== null);
}

function convertHistoryResult(
    tournamentId: string,
    tournamentName: string | undefined,
    result: CachedTournamentResult,
): AthleteRecordSummary | null {
    const bestTime = typeof result.bestTime === "number" ? result.bestTime : null;
    const time = bestTime && bestTime > 0 ? bestTime : 0;
    const createdAt = toDate(result.createdAt) ?? toDate(result.submittedAt);
    const updatedAt = toDate(result.updatedAt) ?? toDate(result.verifiedAt) ?? createdAt;
    const eventLabel = result.eventKey ?? result.event ?? "Unknown Event";

    return {
        id: result.recordPath,
        event: eventLabel,
        time,
        status: result.status ?? "submitted",
        tournamentId,
        tournamentName,
        createdAt,
        updatedAt,
        participantName: undefined,
        gender: undefined,
        age: null,
        country: undefined,
        source: "record",
        round: result.round ?? undefined,
    };
}

async function getUserProfileSafe(participantId: string): Promise<FirestoreUser | undefined> {
    try {
        return await getUserByGlobalId(participantId);
    } catch (error) {
        console.warn(`Failed to load user profile for ${participantId}`, error);
        return undefined;
    }
}

function deriveAge(user?: FirestoreUser): number | null {
    if (!user) {
        return null;
    }
    const birthdate = toDate(user.birthdate);
    if (!birthdate) {
        return null;
    }

    const now = new Date();
    let age = now.getFullYear() - birthdate.getFullYear();
    const hasHadBirthdayThisYear =
        now.getMonth() > birthdate.getMonth() ||
        (now.getMonth() === birthdate.getMonth() && now.getDate() >= birthdate.getDate());

    if (!hasHadBirthdayThisYear) {
        age -= 1;
    }

    return age;
}

function deriveCountry(user?: FirestoreUser): string | null {
    if (!user || !user.country) {
        return null;
    }
    if (Array.isArray(user.country) && user.country.length > 0) {
        return user.country[0];
    }
    if (typeof user.country === "string") {
        return user.country;
    }
    return null;
}

function deriveAvatarUrl(user?: FirestoreUser): string | null {
    if (!user) {
        return null;
    }
    return typeof user.image_url === "string" ? user.image_url : null;
}

function deriveTournamentCountry(tournament: Tournament): string | null {
    if (!tournament.country) {
        return null;
    }
    if (Array.isArray(tournament.country) && tournament.country.length > 0) {
        return tournament.country[0];
    }
    if (typeof tournament.country === "string") {
        return tournament.country;
    }
    return null;
}

export type {IndividualEvent};
