// @ts-nocheck
import {useAuthContext} from "@/context/AuthContext";
import type {AgeBracket, AggregationContext, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import type {BracketResults, EventResults, PrelimResultData} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {getTournamentFinalRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {
    fetchTeamsByTournament,
    fetchTournamentById,
    fetchTournamentEvents,
    updateTournamentStatus,
} from "@/services/firebase/tournamentsService";
import {exportAllPrelimResultsToPDF} from "@/utils/PDF/pdfExport";
import {getEventLabel, isTeamEvent as isTournamentTeamEvent} from "@/utils/tournament/eventUtils";
import {Button, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;

type AggregatedFinalResult = PrelimResultData & {
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
    aggregate: AggregatedFinalResult,
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

const sortWithBestTimes = (a: AggregatedFinalResult, b: AggregatedFinalResult): number => {
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

const getTeamId = (record: Partial<TournamentTeamRecord | AggregatedFinalResult>): string | undefined =>
    record.team_id ?? record.teamId ?? (record as {participantId?: string}).participantId;

const getParticipantId = (record: Partial<TournamentRecord | AggregatedFinalResult>): string | undefined =>
    record.participant_id ?? (record as {participantId?: string}).participantId ?? record.id ?? record.id;

const getTeamAge = (record: Partial<TournamentTeamRecord | AggregatedFinalResult>): number | undefined =>
    (record as {team_age?: number}).team_age ?? (record as {largest_age?: number}).largest_age;

const computeTeamMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
    classification?: string,
): AggregatedFinalResult[] => {
    const aggregates = new Map<string, AggregatedFinalResult>();

    for (const rawRecord of context.allRecords) {
        if (!isTeamRecord(rawRecord)) continue;
        const record = rawRecord;
        const recordCode = record.code;
        if (!codes.includes(recordCode)) continue;
        if (record.event !== event.type) continue;

        // Check event_id to distinguish between events with same type
        if (event.id && record.event_id !== event.id) continue;

        // Filter by classification
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

    const results: AggregatedFinalResult[] = [];
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
): AggregatedFinalResult[] => {
    return context.allRecords
        .filter(isTeamRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) return false;
            // Filter by classification
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
            } as AggregatedFinalResult;
        });
};

const computeIndividualMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
    classification?: string,
): AggregatedFinalResult[] => {
    const aggregates = new Map<string, AggregatedFinalResult>();
    for (const code of codes) {
        for (const record of context.allRecords) {
            if (!isIndividualRecord(record)) continue;
            if (!(code === record.code && record.event === event.type)) continue;

            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) continue;

            // Filter by classification
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

    const results: AggregatedFinalResult[] = [];
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
): AggregatedFinalResult[] => {
    return context.allRecords
        .filter(isIndividualRecord)
        .filter((record) => {
            if (record.code !== code) return false;
            if (record.event !== event.type) return false;
            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) return false;
            // Filter by classification
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
            } as AggregatedFinalResult;
        });
};

const computeEventBracketResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    context: AggregationContext,
    classification?: string,
): AggregatedFinalResult[] => {
    const codes = event.codes;
    const isTeam = isTournamentTeamEvent(event);

    if (isTeam) {
        if (codes.length > 1) {
            return computeTeamMultiCodeResults(event, bracket, codes, context, classification);
        }
        const primary = codes[0];
        return computeTeamSingleCodeResults(event, bracket, primary, context, classification);
    }

    if (codes.length > 1) {
        return computeIndividualMultiCodeResults(event, bracket, codes, context, classification);
    }
    const primary = codes[0];
    return computeIndividualSingleCodeResults(event, bracket, primary, context, classification);
};

const buildTeamColumns = (event: TournamentEvent): TableColumnProps<AggregatedFinalResult>[] => {
    const baseColumns: TableColumnProps<AggregatedFinalResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 160,
            render: (_value, record) => record.team?.leader_id ?? record.id,
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

const buildIndividualColumns = (event: TournamentEvent): TableColumnProps<AggregatedFinalResult>[] => {
    const columns: TableColumnProps<AggregatedFinalResult>[] = [
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

const buildColumnsForEvent = (event: TournamentEvent): TableColumnProps<AggregatedFinalResult>[] =>
    isTournamentTeamEvent(event) ? buildTeamColumns(event) : buildIndividualColumns(event);

const buildExpandedRows = (
    record: AggregatedFinalResult,
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

export default function FinalResultsPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[] | null>([]);
    const [allRecords, setAllRecords] = useState<TournamentRecord[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("");

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const fetchedTournament = await fetchTournamentById(tournamentId);
                const fetchedEvents = await fetchTournamentEvents(tournamentId);
                if (fetchedEvents) {
                    setTournament(fetchedTournament);
                    setEvents(fetchedEvents);
                    const firstEvent = fetchedEvents[0];
                    if (firstEvent) {
                        setCurrentEventTab(firstEvent.id);
                        const firstBracket = firstEvent.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                            const firstClassification = firstBracket.final_criteria?.[0];
                            if (firstClassification) {
                                setCurrentClassificationTab(firstClassification.classification);
                            }
                        }
                    }
                } else {
                    setTournament(fetchedTournament);
                }

                const [fetchedRecords, fetchedRegistrations, fetchedTeams] = await Promise.all([
                    getTournamentFinalRecords(tournamentId),
                    fetchRegistrations(tournamentId),
                    fetchTeamsByTournament(tournamentId),
                ]);
                setAllRecords(fetchedRecords as TournamentRecord[]);
                setRegistrations(fetchedRegistrations);
                setTeams(fetchedTeams);
            } catch (error) {
                console.error(error);
                Message.error("Failed to fetch final results.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tournamentId]);

    const nameMap = useMemo(
        () =>
            registrations.reduce(
                (acc, reg) => {
                    acc[reg.user_id] = reg.user_name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [registrations],
    );

    const ageMap = useMemo(
        () =>
            registrations.reduce(
                (acc, reg) => {
                    acc[reg.user_id] = reg.age;
                    return acc;
                },
                {} as Record<string, number>,
            ),
        [registrations],
    );

    const registrationMap = useMemo(
        () =>
            registrations.reduce(
                (acc, reg) => {
                    acc[reg.user_id] = reg;
                    return acc;
                },
                {} as Record<string, Registration>,
            ),
        [registrations],
    );

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
                        .flatMap((bracket) => {
                            // For each bracket, create separate entries for each classification
                            return (bracket.final_criteria ?? []).map((fc) => {
                                const records = computeEventBracketResults(event, bracket, aggregationContext, fc.classification);
                                return {
                                    bracket: {
                                        ...bracket,
                                        name: `${bracket.name} - ${fc.classification.charAt(0).toUpperCase() + fc.classification.slice(1)}`,
                                    },
                                    records,
                                    classification: fc.classification,
                                };
                            });
                        })
                        .filter((entry) => entry.records.length > 0);
                    return {event, brackets};
                })
                .filter((entry) => entry.brackets.length > 0);

            if (resultsData.length === 0) {
                Message.info("No final results found.");
                return;
            }

            await exportAllPrelimResultsToPDF({
                tournament,
                resultsData,
                round: "Final",
                highlightFinalists: false,
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    }, [aggregationContext, events, tournament]);

    const handleEndCompetition = async () => {
        if (!tournamentId || !user) return;

        Modal.confirm({
            title: "Confirm End of Competition",
            content: "Are you sure you want to mark this tournament as ended? This action cannot be undone.",
            okText: "Yes",
            cancelText: "Cancel",
            onOk: async () => {
                setLoading(true);
                try {
                    await updateTournamentStatus(user, tournamentId, "End");
                    Message.success("Tournament status updated to End.");
                    const t = await fetchTournamentById(tournamentId);
                    if (t) {
                        setTournament(t);
                    }
                    navigate(`/tournaments`);
                } catch (error: unknown) {
                    if (error instanceof Error) {
                        Message.error(error.message || "Failed to update tournament status.");
                    } else {
                        Message.error("An unknown error occurred while updating tournament status.");
                    }
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    return (
        <div className="flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button
                type="outline"
                onClick={() => navigate(`/tournaments/${tournamentId}/scoring/final`)}
                className="w-fit pt-2 pb-2"
            >
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>Final Results</Title>
                    <div className="flex items-center gap-2">
                        <Button type="primary" icon={<IconPrinter />} onClick={handlePrint} loading={loading}>
                            Print All Brackets
                        </Button>
                        {user?.roles?.edit_tournament && tournament?.status !== "End" && (
                            <Button type="primary" status="success" onClick={handleEndCompetition} loading={loading}>
                                End Competition
                            </Button>
                        )}
                    </div>
                </div>
                <Tabs
                    type="line"
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const event = findEventByTabKey(events ?? [], key);
                        const firstBracket = event?.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                            const firstClassification = firstBracket.final_criteria?.[0];
                            if (firstClassification) {
                                setCurrentClassificationTab(firstClassification.classification);
                            }
                        }
                    }}
                >
                    {events?.map((event) => {
                        const tabKey = event.id;
                        const eventLabel = `${event.type} (${event.codes.join(", ")})`;
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
                                        onChange={(key) => {
                                            setCurrentBracketTab(key);
                                            const bracket = event.age_brackets?.find((b) => b.name === key);
                                            const firstClassification = bracket?.final_criteria?.[0];
                                            if (firstClassification) {
                                                setCurrentClassificationTab(firstClassification.classification);
                                            }
                                        }}
                                    >
                                        {event.age_brackets.map((bracket) => {
                                            return (
                                                <TabPane key={bracket.name} title={bracket.name}>
                                                    {/* Classification tabs */}
                                                    {bracket.final_criteria && bracket.final_criteria.length > 0 ? (
                                                        <Tabs
                                                            type="rounded"
                                                            className="w-full"
                                                            activeTab={currentClassificationTab}
                                                            onChange={setCurrentClassificationTab}
                                                        >
                                                            {bracket.final_criteria.map((fc) => {
                                                                const bracketResults = computeEventBracketResults(
                                                                    event,
                                                                    bracket,
                                                                    aggregationContext,
                                                                    fc.classification,
                                                                );
                                                                const expandedRowRender =
                                                                    eventCodes.length > 1
                                                                        ? (record: TournamentRecord) =>
                                                                              buildExpandedRows(
                                                                                  record,
                                                                                  event,
                                                                                  eventCodes,
                                                                                  isTeamEvent,
                                                                                  allRecords,
                                                                              )
                                                                        : undefined;
                                                                return (
                                                                    <TabPane
                                                                        key={fc.classification}
                                                                        title={
                                                                            fc.classification.charAt(0).toUpperCase() +
                                                                            fc.classification.slice(1)
                                                                        }
                                                                    >
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

export function formatTime(time?: number): string {
    if (typeof time !== "number" || Number.isNaN(time) || time <= 0) {
        return "N/A";
    }
    return time.toFixed(3);
}
