// @ts-nocheck
import type {
    AgeBracket,
    AggregationContext,
    Finalist,
    FinalistGroupPayload,
    Registration,
    Team,
    Tournament,
    TournamentEvent,
} from "@/schema";
import type {BracketResults, EventResults, PrelimResultData} from "@/schema";
import {fetchTournamentFinalists, saveTournamentFinalists} from "@/services/firebase/finalistService";
import {getTournamentPrelimRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {exportAllPrelimResultsToPDF, exportFinalistsNameListToPDF} from "@/utils/PDF/pdfExport";
import {formatTeamLeaderId} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {
    getEventLabel,
    getEventTypeOrderIndex,
    isScoreTrackedEvent,
    isTeamEvent as isTournamentTeamEvent,
    sanitizeEventCodes,
} from "@/utils/tournament/eventUtils";
import {Button, Message, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconCaretRight, IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import type {TournamentRecord, TournamentTeamRecord} from "../../../schema/RecordSchema";

const {Title} = Typography;
const {TabPane} = Tabs;

type AggregatedPrelimResult = Partial<PrelimResultData> & {
    registration?: Registration;
    team?: Team;
    teamId?: string;
    team_id?: string;
    participantId?: string;
    globalId?: string;
    bestTime: number;
    secondBestTime?: number;
    thirdBestTime?: number;
    rank: number;
    name?: string;
    id: string;
    event?: string;
    event_id?: string;
    try1?: number;
    try2?: number;
    try3?: number;
    classification?: "beginner" | "intermediate" | "advance" | "prelim" | null;
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

const getAttemptRanks = (record: Partial<TournamentRecord | TournamentTeamRecord>) => {
    const attempts = getOrderedAttemptTimes(record);
    return {
        best: attempts[0] ?? Number.POSITIVE_INFINITY,
        second: attempts[1] ?? Number.POSITIVE_INFINITY,
        third: attempts[2] ?? Number.POSITIVE_INFINITY,
    };
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

const storeAttemptsForCode = (
    aggregate: AggregatedPrelimResult,
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

const sortWithBestTimes = (a: AggregatedPrelimResult, b: AggregatedPrelimResult): number => {
    const primary = (a.bestTime ?? Number.POSITIVE_INFINITY) - (b.bestTime ?? Number.POSITIVE_INFINITY);
    if (primary !== 0) return primary;
    const secondary = (a.secondBestTime ?? Number.POSITIVE_INFINITY) - (b.secondBestTime ?? Number.POSITIVE_INFINITY);
    if (secondary !== 0) return secondary;
    return (a.thirdBestTime ?? Number.POSITIVE_INFINITY) - (b.thirdBestTime ?? Number.POSITIVE_INFINITY);
};

const isTeamRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    (record as TournamentTeamRecord).team_id !== undefined;

const isIndividualRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentRecord =>
    (record as TournamentRecord).participant_id !== undefined;

const getTeamId = (record: Partial<TournamentTeamRecord | AggregatedPrelimResult>): string | undefined =>
    record.team_id ?? record.teamId ?? (record as {participantId?: string}).participantId;

const getParticipantId = (record: Partial<TournamentRecord | AggregatedPrelimResult>): string | undefined =>
    record.participant_id ?? (record as {participantId?: string}).participantId ?? record.id ?? record.id;

const getTeamAge = (record: Partial<TournamentTeamRecord | AggregatedPrelimResult>): number | undefined =>
    (record as {team_age?: number}).team_age ?? (record as {largest_age?: number}).largest_age;

const computeTeamMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    const aggregates = new Map<string, AggregatedPrelimResult>();

    for (const rawRecord of context.allRecords) {
        if (!isTeamRecord(rawRecord)) continue;
        const record = rawRecord;
        const recordCode = record.code;
        if (!codes.includes(recordCode)) continue;
        if (record.event !== event.type) continue;

        // Check event_id to distinguish between events with same type
        if (event.id && record.event_id !== event.id) continue;

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

    const results: AggregatedPrelimResult[] = [];
    for (const aggregate of aggregates.values()) {
        let total = 0;
        let secondTotal = 0;
        let thirdTotal = 0;
        let complete = true;
        const bestTimes: number[] = [];
        for (const code of codes) {
            const value = aggregate[`${code} Best`];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                complete = false;
                break;
            }
            total += value;
            bestTimes.push(value);
            const secondVal = aggregate[`${code} Second`] as number | undefined;
            const thirdVal = aggregate[`${code} Third`] as number | undefined;
            secondTotal += typeof secondVal === "number" && Number.isFinite(secondVal) ? secondVal : Number.POSITIVE_INFINITY;
            thirdTotal += typeof thirdVal === "number" && Number.isFinite(thirdVal) ? thirdVal : Number.POSITIVE_INFINITY;
        }
        if (!complete) continue;
        bestTimes.sort((a, b) => a - b);
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
): AggregatedPrelimResult[] => {
    return context.allRecords
        .filter(isTeamRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) return false;
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
            const teamId = getTeamId(record) ?? "";
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
            } as AggregatedPrelimResult;
        });
};

const computeIndividualMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    const aggregates = new Map<string, AggregatedPrelimResult>();
    const getSortedBestTimes = (record: AggregatedPrelimResult): number[] =>
        codes
            .map((code) => record[`${code} Best`] as number | undefined)
            .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
            .sort((a, b) => a - b);
    for (const code of codes) {
        for (const record of context.allRecords) {
            if (!isIndividualRecord(record)) continue;
            if (!(code === record.code && record.event === event.type)) continue;

            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) continue;

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

    const results: AggregatedPrelimResult[] = [];
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
): AggregatedPrelimResult[] => {
    return context.allRecords
        .filter(isIndividualRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) return false;
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
            } as AggregatedPrelimResult;
        });
};

const computeEventBracketResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    const codes = event.codes;
    const isTeamEvent = isTournamentTeamEvent(event);

    if (isTeamEvent) {
        if (codes.length > 1) {
            return computeTeamMultiCodeResults(event, bracket, codes, context);
        }
        const primary = codes[0];
        return computeTeamSingleCodeResults(event, bracket, primary, context);
    }

    if (codes.length > 1) {
        return computeIndividualMultiCodeResults(event, bracket, codes, context);
    }
    const primary = codes[0];
    return computeIndividualSingleCodeResults(event, bracket, primary, context);
};

const buildTeamColumns = (event: TournamentEvent): TableColumnProps<AggregatedPrelimResult>[] => {
    const baseColumns: TableColumnProps<AggregatedPrelimResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 160,
            render: (_value, record) => formatTeamLeaderId(record.team?.leader_id ?? record.id, event.type),
        },
    ];

    const codes = event.codes;
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${code} Best`;
            baseColumns.push({
                title: code,
                dataIndex: key,
                width: 120,
                render: (value: unknown) => (typeof value === "number" ? value.toFixed(3) : "N/A"),
            });
        }
        baseColumns.push({title: "Total Time", dataIndex: "bestTime", width: 140, render: (t) => t.toFixed(3)});
    } else {
        baseColumns.push(
            {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
        );
    }

    return baseColumns;
};

const buildIndividualColumns = (event: TournamentEvent): TableColumnProps<AggregatedPrelimResult>[] => {
    const columns: TableColumnProps<AggregatedPrelimResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {
            title: "Global ID",
            dataIndex: "globalId",
            width: 180,
            render: (_value, record) => record.globalId ?? record.registration?.user_global_id ?? "N/A",
        },
        {title: "Name", dataIndex: "name", width: 200},
    ];

    const codes = event.codes;
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${code} Best`;
            columns.push({
                title: code,
                dataIndex: key,
                width: 120,
                render: (value: unknown) => (typeof value === "number" ? value.toFixed(3) : "N/A"),
            });
        }
        columns.push({title: "Total Time", dataIndex: "bestTime", width: 140, render: (t) => t.toFixed(3)});
    } else {
        columns.push(
            {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
        );
    }

    return columns;
};

const buildColumnsForEvent = (event: TournamentEvent): TableColumnProps<AggregatedPrelimResult>[] =>
    isTournamentTeamEvent(event) ? buildTeamColumns(event) : buildIndividualColumns(event);

const buildExpandedRows = (
    record: AggregatedPrelimResult,
    event: TournamentEvent,
    codes: string[],
    isTeamEvent: boolean,
    allRecords: TournamentRecord[],
) => {
    if (codes.length <= 1) {
        return undefined;
    }

    const rows = codes.map((code) => {
        const normalizedKey = `${code} Best`;
        const targetParticipantId = isTeamEvent
            ? (record.teamId ?? record.team_id ?? record.participantId ?? record.participant_id ?? record.team?.id)
            : (record.participantId ?? record.participant_id);
        const targetEventId = record.event_id ?? event.id;

        const baseMatch = allRecords.find((candidate) => {
            const candidateParticipantId = isTeamEvent
                ? ((candidate as TournamentTeamRecord).team_id ?? candidate.participant_id ?? candidate.participantId)
                : (candidate.participant_id ?? candidate.participantId);

            if (!candidateParticipantId || candidateParticipantId !== targetParticipantId) {
                return false;
            }

            if (candidate.code !== code) {
                return false;
            }

            const candidateEventId = (candidate as TournamentTeamRecord).event_id ?? candidate.event_id;
            if (targetEventId && candidateEventId && candidateEventId !== targetEventId) {
                return false;
            }

            return candidate.event === event.type || candidate.event === record.event;
        });

        return {
            code,
            try1: baseMatch?.try1 ? baseMatch.try1.toFixed(3) : "N/A",
            try2: baseMatch?.try2 ? baseMatch.try2.toFixed(3) : "N/A",
            try3: baseMatch?.try3 ? baseMatch.try3.toFixed(3) : "N/A",
            best: typeof record[normalizedKey] === "number" ? (record[normalizedKey] as number).toFixed(3) : "N/A",
        };
    });
    const columns: TableColumnProps<{code: string; try1: string; try2: string; try3: string; best: string}>[] = [
        {title: "Event Code", dataIndex: "code", width: 120},
        {title: "Try 1", dataIndex: "try1", width: 100},
        {title: "Try 2", dataIndex: "try2", width: 100},
        {title: "Try 3", dataIndex: "try3", width: 100},
        {title: "Best Time", dataIndex: "best", width: 120},
    ];

    return (
        <div style={{padding: "16px", backgroundColor: "#f9f9f9"}}>
            <Table columns={columns} data={rows} pagination={false} size="small" showHeader={true} />
        </div>
    );
};

export default function PrelimResultsPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [allRecords, setAllRecords] = useState<Array<TournamentRecord | TournamentTeamRecord>>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("");
    const sortedEvents = useMemo(
        () =>
            [...events].sort((a, b) => {
                const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                if (orderDiff !== 0) return orderDiff;
                return a.type.localeCompare(b.type);
            }),
        [events],
    );

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const fetchedTournament = await fetchTournamentById(tournamentId);
                const events = await fetchTournamentEvents(tournamentId);
                if (events) {
                    const scoringEvents = events.filter((event) => isScoreTrackedEvent(event));
                    setTournament(fetchedTournament);
                    setEvents(scoringEvents);
                    const sortedEventList = [...scoringEvents].sort((a, b) => {
                        const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                        if (orderDiff !== 0) return orderDiff;
                        return a.type.localeCompare(b.type);
                    });
                    const firstEvent = sortedEventList[0];
                    if (firstEvent) {
                        setCurrentEventTab(firstEvent.id);
                        const firstBracket = firstEvent.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                        }
                    }
                } else {
                    setTournament(fetchedTournament);
                }

                const [fetchedRecords, fetchedRegistrations, fetchedTeams] = await Promise.all([
                    getTournamentPrelimRecords(tournamentId),
                    fetchRegistrations(tournamentId),
                    fetchTeamsByTournament(tournamentId),
                ]);
                const verifiedTeams = fetchedTeams.filter((team) => isTeamFullyVerified(team));
                const verifiedTeamIds = new Set(verifiedTeams.map((team) => team.id));
                const filteredRecords = fetchedRecords.filter((record) => {
                    if (!isTeamRecord(record)) {
                        return true;
                    }
                    const teamId = getTeamId(record);
                    return teamId ? verifiedTeamIds.has(teamId) : false;
                });
                setAllRecords(filteredRecords);
                setRegistrations(fetchedRegistrations);
                setTeams(verifiedTeams);
            } catch (error) {
                console.error(error);
                Message.error("Failed to fetch preliminary results.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tournamentId]);

    const nameMap = useMemo(() => {
        const acc: Record<string, string> = {};
        for (const reg of registrations) {
            const keys = [reg.user_id, reg.profile_id ?? undefined, reg.user_global_id ?? undefined].filter(
                (value): value is string => Boolean(value),
            );
            for (const key of keys) {
                acc[key] = reg.user_name;
            }
        }
        return acc;
    }, [registrations]);

    const ageMap = useMemo(() => {
        const acc: Record<string, number> = {};
        for (const reg of registrations) {
            const keys = [reg.user_id, reg.profile_id ?? undefined, reg.user_global_id ?? undefined].filter(
                (value): value is string => Boolean(value),
            );
            for (const key of keys) {
                acc[key] = reg.age;
            }
        }
        return acc;
    }, [registrations]);

    const registrationMap = useMemo(() => {
        const acc: Record<string, Registration> = {};
        for (const reg of registrations) {
            const keys = [reg.user_id, reg.profile_id ?? undefined, reg.user_global_id ?? undefined].filter(
                (value): value is string => Boolean(value),
            );
            for (const key of keys) {
                acc[key] = reg;
            }
        }
        return acc;
    }, [registrations]);

    const teamNameMap = useMemo(
        () =>
            teams.reduce(
                (acc, team) => {
                    acc[team.id] = team.name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [teams],
    );

    const teamMap = useMemo(
        () =>
            teams.reduce(
                (acc, team) => {
                    acc[team.id] = team;
                    return acc;
                },
                {} as Record<string, Team>,
            ),
        [teams],
    );

    const aggregationContext = useMemo<AggregationContext>(
        () => ({
            allRecords,
            registrations,
            registrationMap,
            teams,
            teamMap,
            nameMap,
            ageMap,
            teamNameMap,
        }),
        [allRecords, registrations, registrationMap, teams, teamMap, nameMap, ageMap, teamNameMap],
    );

    const findEventByTabKey = useCallback(
        (events: TournamentEvent[] | undefined, key: string): TournamentEvent | undefined =>
            events?.find((event) => event.id === key),
        [],
    );

    const currentEvent = useMemo(
        () => findEventByTabKey(events ?? [], currentEventTab),
        [findEventByTabKey, events, currentEventTab],
    );

    const currentBracket = useMemo(
        () => currentEvent?.age_brackets?.find((bracket) => bracket.name === currentBracketTab),
        [currentEvent, currentBracketTab],
    );

    const handlePrint = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const resultsData: EventResults[] = (events ?? [])
                .map((event) => {
                    const brackets = (event.age_brackets ?? [])
                        .map((bracket) => {
                            const records = computeEventBracketResults(event, bracket, aggregationContext);
                            return {bracket, records};
                        })
                        .filter((entry) => entry.records.length > 0);
                    return {event, brackets};
                })
                .filter((entry) => entry.brackets.length > 0);

            if (resultsData.length === 0) {
                Message.info("No preliminary results found.");
                return;
            }

            await exportAllPrelimResultsToPDF({
                tournament,
                resultsData,
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    }, [aggregationContext, tournament]);

    const handlePrintFinalists = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const finalistsData: EventResults[] = [];

            for (const event of events) {
                const brackets: BracketResults[] = [];
                for (const bracket of event.age_brackets ?? []) {
                    const records = computeEventBracketResults(event, bracket, aggregationContext);
                    if (records.length === 0) continue;

                    const finalCriteria = bracket.final_criteria ?? [];
                    let processedCount = 0;
                    for (const criterion of finalCriteria) {
                        const {classification, number} = criterion;
                        const bracketFinalists = records.slice(processedCount, processedCount + number);
                        if (bracketFinalists.length > 0) {
                            if (event.codes.length > 1) {
                                for (const code of event.codes) {
                                    const codeRecords = bracketFinalists
                                        .map((r) => {
                                            const normalizedKey = `${code} Try`;
                                            return {
                                                ...r,
                                                code,
                                                try1: r[`${code} Try 1`] as number | undefined,
                                                try2: r[`${code} Try 2`] as number | undefined,
                                                try3: r[`${code} Try 3`] as number | undefined,
                                                bestTime: r[`${code} Best`] as number | undefined,
                                                normalizedKey,
                                            };
                                        })
                                        .filter((r) => r.try1 || r.try2 || r.try3);

                                    if (codeRecords.length > 0) {
                                        brackets.push({
                                            bracket,
                                            records: codeRecords,
                                            classification: `${classification ?? ""} (${code})`,
                                            highlightFinalists: true,
                                        });
                                    }
                                }
                            } else {
                                brackets.push({
                                    bracket,
                                    records: bracketFinalists,
                                    classification,
                                    highlightFinalists: true,
                                });
                            }
                        }
                        processedCount += number;
                    }
                }

                if (brackets.length > 0) {
                    finalistsData.push({event, brackets});
                }
            }

            if (finalistsData.length === 0) {
                Message.info("No finalists found to print.");
                return;
            }

            await exportFinalistsNameListToPDF({
                tournament,
                finalistsData,
            });
            Message.success("Finalists PDF preview opened in new tab!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to generate finalists PDF");
        } finally {
            setLoading(false);
        }
    }, [aggregationContext, tournament]);

    const handleStartFinal = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const finalists: Finalist[] = [];

            for (const event of events) {
                const eventCodes = sanitizeEventCodes(event.codes);
                const eventCode = eventCodes[0] ?? event.type;

                for (const bracket of event.age_brackets ?? []) {
                    const records = computeEventBracketResults(event, bracket, aggregationContext);
                    if (records.length === 0) continue;

                    const finalCriteria = bracket.final_criteria ?? [];
                    let processedCount = 0;
                    for (const criterion of finalCriteria) {
                        const {classification, number} = criterion;
                        const bracketFinalists = records.slice(processedCount, processedCount + number);
                        if (bracketFinalists.length > 0) {
                            finalists.push({
                                event,
                                eventCode,
                                eventCodes,
                                bracket,
                                records: bracketFinalists,
                                classification,
                            });
                        }
                        processedCount += number;
                    }
                }
            }

            if (finalists.length === 0) {
                Message.info("No finalists found based on the criteria.");
                setLoading(false);
                return;
            }

            if (!tournamentId) {
                Message.error("Tournament ID is missing. Cannot save finalists.");
                setLoading(false);
                return;
            }

            // Build raw payloads for the selected finalists
            const finalistPayloads = finalists
                .map<FinalistGroupPayload | null>((finalistEntry) => {
                    const participantIds = finalistEntry.records
                        .map((record) => {
                            if (isTournamentTeamEvent(finalistEntry.event)) {
                                return (
                                    record.team?.id ??
                                    record.teamId ??
                                    (typeof record.participantId === "string" ? record.participantId : undefined)
                                );
                            }
                            return (
                                record.registration?.user_id ??
                                (typeof record.participantId === "string" ? record.participantId : undefined)
                            );
                        })
                        .filter((id): id is string => Boolean(id));

                    if (participantIds.length === 0) {
                        return null;
                    }

                    return {
                        tournament_id: tournamentId,
                        event_id: finalistEntry.event.id,
                        event_type: finalistEntry.event.type,
                        event_code: finalistEntry.eventCodes,
                        bracket_name: finalistEntry.bracket.name,
                        classification: finalistEntry.classification,
                        participant_ids: participantIds,
                        participant_type: isTournamentTeamEvent(finalistEntry.event) ? "Team" : "Individual",
                    } satisfies FinalistGroupPayload;
                })
                .filter((payload): payload is FinalistGroupPayload => payload !== null);

            // Fetch existing finalists for this tournament and upsert by (event_id, bracket_name, classification)
            if (finalistPayloads.length > 0) {
                try {
                    const existing = await fetchTournamentFinalists(tournamentId);
                    const normalizedKey = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

                    // Build a fast lookup by composite key
                    const existingByKey = new Map<string, (typeof existing)[number]>();
                    for (const e of existing) {
                        const key = [
                            normalizedKey(e.event_id),
                            normalizedKey(e.bracket_name),
                            normalizedKey(e.classification),
                        ].join("::");
                        // Keep the first occurrence
                        if (!existingByKey.has(key)) {
                            existingByKey.set(key, e);
                        }
                    }

                    // Attach IDs to payloads that match, so setDoc merges (update) instead of creating new
                    const upserts = finalistPayloads.map((p) => {
                        const key = [
                            normalizedKey(p.event_id),
                            normalizedKey(p.bracket_name),
                            normalizedKey(p.classification),
                        ].join("::");
                        const match = existingByKey.get(key);
                        return match ? {...p, id: match.id} : p;
                    });

                    await saveTournamentFinalists(upserts);
                } catch (error) {
                    console.error("Failed to save finalists:", error);
                    Message.error("Failed to save finalists. Please try again.");
                    setLoading(false);
                    return;
                }
            }

            navigate(`/tournaments/${tournamentId}/scoring/final`);
        } catch (error) {
            console.error(error);
            Message.error("Failed to start finals.");
        } finally {
            setLoading(false);
        }
    }, [aggregationContext, navigate, registrations, teams, tournament, tournamentId]);
    return (
        <div className="flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button
                type="outline"
                onClick={() => navigate(`/tournaments/${tournamentId}/start/record`)}
                className="w-fit pt-2 pb-2"
            >
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>Preliminary Results</Title>
                    <div className="flex items-center gap-2">
                        <Button
                            type="primary"
                            status="success"
                            icon={<IconCaretRight />}
                            onClick={handleStartFinal}
                            loading={loading}
                        >
                            Start Final
                        </Button>
                        <Button type="primary" icon={<IconPrinter />} onClick={handlePrint} loading={loading}>
                            Print All Brackets
                        </Button>
                        <Button
                            type="primary"
                            status="warning"
                            icon={<IconPrinter />}
                            onClick={handlePrintFinalists}
                            loading={loading}
                        >
                            Print Finalists
                        </Button>
                    </div>
                </div>
                <Tabs
                    type="line"
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const event = findEventByTabKey(events, key);
                        const firstBracket = event?.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                        }
                    }}
                >
                    {sortedEvents.map((event) => {
                        const tabKey = event.id;
                        const eventLabel = getEventLabel(event);
                        const isTeamEvent = isTournamentTeamEvent(event);
                        const eventCodes = event.codes;
                        const columns = buildColumnsForEvent(event);

                        return (
                            <TabPane key={tabKey} title={eventLabel}>
                                {event.age_brackets && event.age_brackets.length > 0 ? (
                                    <Tabs
                                        type="capsule"
                                        className="w-full"
                                        activeTab={currentBracketTab}
                                        onChange={setCurrentBracketTab}
                                    >
                                        {event.age_brackets.map((bracket) => {
                                            const bracketResults = computeEventBracketResults(event, bracket, aggregationContext);
                                            const expandedRowRender =
                                                eventCodes.length > 1
                                                    ? (record: TournamentRecord) =>
                                                          buildExpandedRows(record, event, eventCodes, isTeamEvent, allRecords)
                                                    : undefined;
                                            return (
                                                <TabPane key={bracket.name} title={bracket.name}>
                                                    <Table
                                                        style={{width: "100%"}}
                                                        rowKey={(record) => record.id}
                                                        columns={columns}
                                                        data={bracketResults}
                                                        pagination={false}
                                                        loading={loading}
                                                        expandedRowRender={expandedRowRender}
                                                    />
                                                </TabPane>
                                            );
                                        })}
                                    </Tabs>
                                ) : (
                                    <Table
                                        style={{width: "100%"}}
                                        rowKey={(record) => record.id}
                                        columns={columns}
                                        data={[]}
                                        pagination={false}
                                        loading={loading}
                                    />
                                )}
                            </TabPane>
                        );
                    })}
                </Tabs>
            </div>
        </div>
    );
}
