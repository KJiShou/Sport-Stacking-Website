// @ts-nocheck
import type {AgeBracket, AggregationContext, Registration, Team, TournamentEvent} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {isTeamEvent as isTournamentTeamEvent} from "@/utils/tournament/eventUtils";

export type AggregatedResultRow = {
    id: string;
    name?: string;
    rank: number;
    bestTime: number;
    secondBestTime?: number;
    thirdBestTime?: number;
    participantId?: string;
    participant_id?: string;
    event?: string;
    event_id?: string;
    try1?: number;
    try2?: number;
    try3?: number;
    team_id?: string;
    team_name?: string;
    leader_id?: string;
    code?: string;
    classification?: "advance" | "intermediate" | "beginner" | "prelim";
    best_time?: number;
    registration?: Registration;
    team?: Team;
    teamId?: string;
    globalId?: string;
    [key: string]: unknown;
};

const normalizeCodeKey = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, "");

const getOrderedAttemptTimes = (record: Partial<TournamentRecord | TournamentTeamRecord>): number[] => {
    const attempts = [record.try1, record.try2, record.try3]
        .map((value) => (typeof value === "number" ? value : Number.parseFloat((value as unknown as string) ?? "")))
        .filter((value) => Number.isFinite(value)) as number[];
    attempts.sort((a, b) => a - b);
    return attempts;
};

const compareByAttempts = (
    a: Partial<TournamentRecord | TournamentTeamRecord>,
    b: Partial<TournamentRecord | TournamentTeamRecord>,
): number => {
    const aAttempts = getOrderedAttemptTimes(a);
    const bAttempts = getOrderedAttemptTimes(b);
    for (let i = 0; i < 3; i += 1) {
        const aVal = aAttempts[i] ?? Number.POSITIVE_INFINITY;
        const bVal = bAttempts[i] ?? Number.POSITIVE_INFINITY;
        const diff = aVal - bVal;
        if (diff !== 0) return diff;
    }
    return 0;
};

const resolveBestTime = (record: Partial<TournamentRecord | TournamentTeamRecord>): number => {
    const direct = record.best_time ?? (record as unknown as {bestTime?: number}).bestTime;
    if (typeof direct === "number" && Number.isFinite(direct)) {
        return direct;
    }
    const attempts = getOrderedAttemptTimes(record);
    return attempts[0] ?? Number.POSITIVE_INFINITY;
};

const getAttemptRanks = (record: Partial<TournamentRecord | TournamentTeamRecord>) => {
    const attempts = getOrderedAttemptTimes(record);
    return {
        best: attempts[0] ?? Number.POSITIVE_INFINITY,
        second: attempts[1] ?? Number.POSITIVE_INFINITY,
        third: attempts[2] ?? Number.POSITIVE_INFINITY,
    };
};

const storeAttemptsForCode = (
    aggregate: AggregatedResultRow,
    code: string,
    record: Partial<TournamentRecord | TournamentTeamRecord>,
) => {
    (aggregate as Record<string, unknown>)[`${code} Try 1`] = record.try1;
    (aggregate as Record<string, unknown>)[`${code} Try 2`] = record.try2;
    (aggregate as Record<string, unknown>)[`${code} Try 3`] = record.try3;
    const {second, third} = getAttemptRanks(record);
    (aggregate as Record<string, unknown>)[`${code} Second`] = second;
    (aggregate as Record<string, unknown>)[`${code} Third`] = third;
};

const sortWithBestTimes = (a: AggregatedResultRow, b: AggregatedResultRow): number => {
    const toNumericOrInf = (value: unknown): number =>
        typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    const primary = toNumericOrInf(a.bestTime) - toNumericOrInf(b.bestTime);
    if (primary !== 0) return primary;
    const secondary = toNumericOrInf(a.secondBestTime) - toNumericOrInf(b.secondBestTime);
    if (secondary !== 0) return secondary;
    return toNumericOrInf(a.thirdBestTime) - toNumericOrInf(b.thirdBestTime);
};

const isTeamRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    (record as TournamentTeamRecord).team_id !== undefined;

const isIndividualRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentRecord =>
    (record as TournamentRecord).participant_id !== undefined;

const getTeamId = (record: Partial<TournamentTeamRecord | AggregatedResultRow>): string | undefined =>
    record.team_id ?? (record as {teamId?: string}).teamId ?? (record as {participantId?: string}).participantId;

const getTeamAge = (record: Partial<TournamentTeamRecord | AggregatedResultRow>): number | undefined =>
    (record as {team_age?: number}).team_age ?? (record as {largest_age?: number}).largest_age;

const computeTeamMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
    classification?: string,
): AggregatedResultRow[] => {
    const aggregates = new Map<string, AggregatedResultRow>();

    for (const rawRecord of context.allRecords) {
        if (!isTeamRecord(rawRecord)) continue;
        const record = rawRecord;
        const recordCode = record.code;
        if (!codes.includes(recordCode)) continue;
        if (record.event !== event.type) continue;
        if (event.id && record.event_id !== event.id) continue;
        if (classification && record.classification !== classification) continue;

        const teamId = getTeamId(record);
        if (!teamId) continue;

        const team = context.teamMap[teamId];
        const teamAge = team?.team_age ?? getTeamAge(record);
        if (teamAge === undefined || teamAge < bracket.min_age || teamAge > bracket.max_age) continue;

        let aggregate = aggregates.get(teamId);
        if (!aggregate) {
            aggregate = {
                ...record,
                participantId: teamId,
                teamId,
                team,
                name:
                    context.teamNameMap[teamId] ||
                    team?.name ||
                    record.team_name ||
                    (rawRecord as unknown as {teamName?: string}).teamName ||
                    "N/A",
                id: team?.leader_id || record.leader_id || (rawRecord as unknown as {leaderId?: string}).leaderId || teamId,
                bestTime: 0,
                rank: 0,
                event: `${event.codes.join(", ")}-${event.type}`,
                event_id: record.event_id ?? event.id,
            };
            aggregates.set(teamId, aggregate);
        }

        const {best: bestTimeValue, second, third} = getAttemptRanks(record);
        const normalizedKey = normalizeCodeKey(recordCode);
        (aggregate as Record<string, unknown>)[`${recordCode} Best`] = bestTimeValue;
        (aggregate as Record<string, unknown>)[`${normalizedKey}Best`] = bestTimeValue;
        (aggregate as Record<string, unknown>)[`${recordCode} Second`] = second;
        (aggregate as Record<string, unknown>)[`${recordCode} Third`] = third;
        storeAttemptsForCode(aggregate, recordCode, record);
    }

    const results: AggregatedResultRow[] = [];
    for (const aggregate of aggregates.values()) {
        let total = 0;
        let secondTotal = 0;
        let thirdTotal = 0;
        let complete = true;

        for (const code of codes) {
            const value = aggregate[`${code} Best`];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                complete = false;
                break;
            }
            total += value;
            const secondVal = aggregate[`${code} Second`] as number | undefined;
            const thirdVal = aggregate[`${code} Third`] as number | undefined;
            secondTotal += typeof secondVal === "number" && Number.isFinite(secondVal) ? secondVal : Number.POSITIVE_INFINITY;
            thirdTotal += typeof thirdVal === "number" && Number.isFinite(thirdVal) ? thirdVal : Number.POSITIVE_INFINITY;
        }

        if (!complete) continue;

        aggregate.bestTime = total;
        aggregate.secondBestTime = secondTotal;
        aggregate.thirdBestTime = thirdTotal;
        results.push({...aggregate});
    }

    results.sort(sortWithBestTimes);
    return results.map((record, index) => ({...record, rank: index + 1}));
};

const computeTeamSingleCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    code: string,
    context: AggregationContext,
    classification?: string,
): AggregatedResultRow[] =>
    context.allRecords
        .filter(isTeamRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            if (event.id && record.event_id !== event.id) return false;
            if (classification && record.classification !== classification) return false;
            return true;
        })
        .filter((record) => {
            const teamId = getTeamId(record);
            if (!teamId) return false;
            const team = context.teamMap[teamId];
            const teamAge = team?.team_age ?? getTeamAge(record);
            return teamAge !== undefined && teamAge >= bracket.min_age && teamAge <= bracket.max_age;
        })
        .sort((a, b) => compareByAttempts(a, b))
        .map((record, index) => {
            const teamId =
                record.team_id ??
                record.participant_id ??
                (record as unknown as {participantId?: string}).participantId ??
                (record as unknown as {teamId?: string}).teamId ??
                "";
            const team = context.teamMap[teamId];
            const bestTime = resolveBestTime(record);
            return {
                ...record,
                rank: index + 1,
                name:
                    context.teamNameMap[teamId] ||
                    team?.name ||
                    record.team_name ||
                    (record as unknown as {teamName?: string}).teamName ||
                    "N/A",
                id: team?.leader_id || record.leader_id || (record as unknown as {leaderId?: string}).leaderId || teamId,
                teamId,
                team,
                bestTime,
            } as AggregatedResultRow;
        });

const computeIndividualMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
    classification?: string,
): AggregatedResultRow[] => {
    const aggregates = new Map<string, AggregatedResultRow>();

    for (const code of codes) {
        for (const record of context.allRecords) {
            if (!isIndividualRecord(record)) continue;
            if (!(code === record.code && record.event === event.type)) continue;
            if (event.id && record.event_id !== event.id) continue;
            if (classification && record.classification !== classification) continue;

            const participantId = record.participant_id as string | undefined;
            if (!participantId) continue;
            const age = context.ageMap[participantId];
            if (age < bracket.min_age || age > bracket.max_age) continue;

            let aggregate = aggregates.get(participantId);
            if (!aggregate) {
                const registration = context.registrationMap[participantId];
                const globalId = registration?.user_global_id ?? participantId;
                aggregate = {
                    ...record,
                    participantId,
                    name: context.nameMap[participantId] || "N/A",
                    id: participantId,
                    bestTime: 0,
                    rank: 0,
                    registration,
                    globalId,
                    event: `${event.codes.join(", ")}-${event.type}`,
                };
                aggregates.set(participantId, aggregate);
            }

            const {best, second, third} = getAttemptRanks(record);
            (aggregate as Record<string, unknown>)[`${code} Best`] = best;
            (aggregate as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`] = best;
            (aggregate as Record<string, unknown>)[`${code} Second`] = second;
            (aggregate as Record<string, unknown>)[`${code} Third`] = third;
            storeAttemptsForCode(aggregate, code, record);
        }
    }

    const results: AggregatedResultRow[] = [];
    for (const aggregate of aggregates.values()) {
        const participantId = (aggregate.participantId ?? aggregate.participant_id) as string;
        let total = 0;
        let secondTotal = 0;
        let thirdTotal = 0;
        let complete = true;

        for (const code of codes) {
            const value = aggregate[`${code} Best`];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                complete = false;
                break;
            }
            total += value;
            const secondVal = aggregate[`${code} Second`] as number | undefined;
            const thirdVal = aggregate[`${code} Third`] as number | undefined;
            secondTotal += typeof secondVal === "number" && Number.isFinite(secondVal) ? secondVal : Number.POSITIVE_INFINITY;
            thirdTotal += typeof thirdVal === "number" && Number.isFinite(thirdVal) ? thirdVal : Number.POSITIVE_INFINITY;
        }

        if (!complete) continue;

        aggregate.bestTime = total;
        aggregate.secondBestTime = secondTotal;
        aggregate.thirdBestTime = thirdTotal;
        aggregate.registration = context.registrationMap[participantId];
        results.push(aggregate);
    }

    results.sort(sortWithBestTimes);
    return results.map((record, index) => ({...record, rank: index + 1}));
};

const computeIndividualSingleCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    code: string,
    context: AggregationContext,
    classification?: string,
): AggregatedResultRow[] =>
    context.allRecords
        .filter(isIndividualRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            if (event.id && record.event_id !== event.id) return false;
            if (classification && record.classification !== classification) return false;
            return true;
        })
        .filter((record) => {
            const participantId = record.participant_id as string | undefined;
            if (!participantId) return false;
            const age = context.ageMap[participantId];
            return age >= bracket.min_age && age <= bracket.max_age;
        })
        .sort((a, b) => compareByAttempts(a, b))
        .map((record, index) => {
            const participantId = record.participant_id as string;
            const registration = context.registrationMap[participantId];
            const globalId = registration?.user_global_id ?? participantId;
            const bestTime = resolveBestTime(record);
            return {
                ...record,
                rank: index + 1,
                name: context.nameMap[participantId] || "N/A",
                id: participantId,
                registration,
                globalId,
                bestTime,
            } as AggregatedResultRow;
        });

export const computeEventBracketResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    context: AggregationContext,
    classification?: string,
): AggregatedResultRow[] => {
    const codes = event.codes;
    const isTeam = isTournamentTeamEvent(event);

    if (isTeam) {
        if (codes.length > 1) {
            return computeTeamMultiCodeResults(event, bracket, codes, context, classification);
        }
        return computeTeamSingleCodeResults(event, bracket, codes[0], context, classification);
    }

    if (codes.length > 1) {
        return computeIndividualMultiCodeResults(event, bracket, codes, context, classification);
    }
    return computeIndividualSingleCodeResults(event, bracket, codes[0], context, classification);
};
