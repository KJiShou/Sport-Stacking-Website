import {useAuthContext} from "@/context/AuthContext";
import type {
    AgeBracket,
    AggregationContext,
    BracketResults,
    EventResults,
    Finalist,
    FinalistGroupPayload,
    PrelimResultData,
    Registration,
    Team,
    Tournament,
    TournamentEvent,
} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {fetchUsersByGlobalIds} from "@/services/firebase/authService";
import {fetchTournamentFinalists, saveTournamentFinalists} from "@/services/firebase/finalistService";
import {getTournamentPrelimRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {exportAllPrelimResultsToPDF, exportCombinedTimeSheetsPDF, exportFinalistsNameListToPDF} from "@/utils/PDF/pdfExport";
import {formatTeamLeaderId, stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {
    getEventKey,
    getEventLabel,
    getEventTypeOrderIndex,
    isScoreTrackedEvent,
    isTeamEvent as isTournamentTeamEvent,
    matchesAnyEventKey,
    sanitizeEventCodes,
    teamMatchesEventKey,
} from "@/utils/tournament/eventUtils";
import {buildFinalistClassificationMap, isEligibleForFinalistSelection} from "@/utils/tournament/finalistStyling";
import {Button, Dropdown, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconCaretRight, IconCopy, IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;
type PrintScope = "all" | "event" | "age";

type AggregatedPrelimResult = Partial<PrelimResultData> & {
    registration?: Registration;
    team?: Team;
    teamId?: string;
    team_id?: string;
    participantId?: string;
    participant_id?: string;
    globalId?: string;
    bestTime: number;
    secondBestTime?: number;
    thirdBestTime?: number;
    rank: number;
    name: string;
    id: string;
    event?: string;
    event_id?: string;
    try1?: number;
    try2?: number;
    try3?: number;
    classification?: "beginner" | "intermediate" | "advance" | "prelim" | null;
    team_name?: string;
    leader_id?: string | null;
    [key: string]: unknown;
};

const normalizeCodeKey = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, "");
const getNumericRecordValue = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;

const getOrderedAttemptTimes = (record: Partial<TournamentRecord | TournamentTeamRecord>): number[] => {
    const attempts = [record.try1, record.try2, record.try3]
        .map((value) => (typeof value === "number" ? value : Number.parseFloat(String(value ?? ""))))
        .filter((value): value is number => Number.isFinite(value));
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
    record.team_id ??
    (record as {teamId?: string}).teamId ??
    (record as {participantId?: string}).participantId;

const getParticipantId = (record: Partial<TournamentRecord | AggregatedPrelimResult>): string | undefined =>
    record.participant_id ?? (record as {participantId?: string}).participantId ?? record.id;

const getTeamAge = (record: Partial<TournamentTeamRecord | AggregatedPrelimResult>): number | undefined =>
    (record as {team_age?: number}).team_age ?? (record as {largest_age?: number}).largest_age;

const normalizeGender = (value: unknown): "Male" | "Female" | "Mixed" => {
    if (value === "Male" || value === "Female") {
        return value;
    }
    return "Mixed";
};

const isGenderEligible = (participantGender: unknown, eventGender: TournamentEvent["gender"]): boolean => {
    const normalizedEventGender = normalizeGender(eventGender);
    if (normalizedEventGender === "Mixed") {
        return true;
    }
    return normalizeGender(participantGender) === normalizedEventGender;
};

const registrationMatchesEvent = (registration: Registration, event: TournamentEvent): boolean => {
    if (!isGenderEligible(registration.gender, event.gender)) {
        return false;
    }

    return (
        registration.events_registered.includes(getEventKey(event)) || matchesAnyEventKey(registration.events_registered, event)
    );
};

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
                participant_id: teamId,
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
                classification: record.classification ?? undefined,
                team_name: record.team_name,
                leader_id: record.leader_id,
            } satisfies AggregatedPrelimResult;
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
    for (const code of codes) {
        for (const record of context.allRecords) {
            if (!isIndividualRecord(record)) continue;
            if (!(code === record.code && record.event === event.type)) continue;

            // Check event_id to distinguish between events with same type
            if (event.id && record.event_id !== event.id) continue;

            const participantId = getParticipantId(record);
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
                    participant_id: participantId,
                    name: context.nameMap[participantId] || "N/A",
                    id: participantId,
                    bestTime: 0,
                    rank: 0,
                    registration,
                    globalId,
                    event: `${event.codes.join(", ")}-${event.type}`,
                    classification: record.classification ?? undefined,
                } satisfies AggregatedPrelimResult;
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
        const participantId = getParticipantId(aggregate);
        if (!participantId) continue;
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
            const participantId = getParticipantId(record);
            if (!participantId) return false;
            const age = context.ageMap[participantId];
            return age >= bracket.min_age && age <= bracket.max_age;
        })
        .sort((a, b) => compareByAttempts(a, b))
        .map((record, index) => {
            const participantId = getParticipantId(record) ?? "";
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
    allRecords: Array<TournamentRecord | TournamentTeamRecord>,
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
                ? (isTeamRecord(candidate) ? candidate.team_id : getParticipantId(candidate))
                : getParticipantId(candidate);

            if (!candidateParticipantId || candidateParticipantId !== targetParticipantId) {
                return false;
            }

            if (candidate.code !== code) {
                return false;
            }

            const candidateEventId = candidate.event_id;
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
            best: getNumericRecordValue(record[normalizedKey])?.toFixed(3) ?? "N/A",
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
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [allRecords, setAllRecords] = useState<Array<TournamentRecord | TournamentTeamRecord>>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [supplementalNameMap, setSupplementalNameMap] = useState<Record<string, string>>({});
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const sortedEvents = useMemo(
        () =>
            [...events].sort((a, b) => {
                const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                if (orderDiff !== 0) return orderDiff;
                return a.type.localeCompare(b.type);
            }),
        [events],
    );
    const canShareLinks = Boolean(user?.roles?.edit_tournament || user?.roles?.verify_record);

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
                        if (typeof firstEvent.id === "string") {
                            setCurrentEventTab(firstEvent.id);
                        }
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

                const approvedNameMap = fetchedRegistrations.reduce(
                    (acc, registration) => {
                        if (registration.user_global_id) {
                            acc[registration.user_global_id] = registration.user_name || registration.user_global_id;
                        }
                        return acc;
                    },
                    {} as Record<string, string>,
                );
                const missingGlobalIds = Array.from(
                    new Set(
                        verifiedTeams.flatMap((team) => [
                            stripTeamLeaderPrefix(team.leader_id),
                            ...(team.members ?? []).map((member) => member.global_id),
                        ]),
                    ),
                ).filter((globalId) => globalId && !approvedNameMap[globalId]);

                if (missingGlobalIds.length > 0) {
                    const usersByGlobalId = await fetchUsersByGlobalIds(missingGlobalIds);
                    const fetchedNameMap: Record<string, string> = {};
                    for (const [globalId, user] of Object.entries(usersByGlobalId)) {
                        fetchedNameMap[globalId] = user.name || globalId;
                    }
                    setSupplementalNameMap(fetchedNameMap);
                } else {
                    setSupplementalNameMap({});
                }
            } catch (error) {
                console.error(error);
                Message.error("Failed to fetch preliminary results.");
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
                    acc[reg.user_global_id] = reg.user_name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [registrations],
    );

    const combinedNameMap = useMemo(() => ({...nameMap, ...supplementalNameMap}), [nameMap, supplementalNameMap]);

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
            nameMap: combinedNameMap,
            ageMap,
            teamNameMap,
        }),
        [allRecords, registrations, registrationMap, teams, teamMap, combinedNameMap, ageMap, teamNameMap],
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

    const buildPrelimResultsData = useCallback(
        (scope: PrintScope): EventResults[] => {
            const scopedEvents = scope === "all" ? (events ?? []) : currentEvent ? [currentEvent] : [];

            return scopedEvents
                .map((event) => {
                    const scopedBrackets =
                        scope === "age" && event.id === currentEvent?.id && currentBracket
                            ? [currentBracket]
                            : (event.age_brackets ?? []);

                    const brackets = scopedBrackets
                        .map((bracket) => {
                            const records = computeEventBracketResults(event, bracket, aggregationContext);
                            const highlightedRecordClassifications = buildFinalistClassificationMap(
                                records,
                                sanitizeEventCodes(event.codes),
                                bracket.final_criteria ?? [],
                            );

                            return {
                                bracket,
                                records,
                                highlightedRecordClassifications,
                            };
                        })
                        .filter((entry) => entry.records.length > 0);

                    return {event, brackets};
                })
                .filter((entry) => entry.brackets.length > 0);
        },
        [aggregationContext, currentBracket, currentEvent, events],
    );

    const handlePrint = useCallback(
        async (scope: PrintScope = "age") => {
            if (!tournament) return;

            setLoading(true);
            try {
                const resultsData = buildPrelimResultsData(scope);

                if (resultsData.length === 0) {
                    const scopeLabel =
                        scope === "all"
                            ? "No preliminary results found."
                            : scope === "event"
                              ? "No preliminary results found for the current event."
                              : "No preliminary results found for the current age bracket.";
                    Message.info(scopeLabel);
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
        },
        [buildPrelimResultsData, tournament],
    );

    const buildFinalistsPrintData = useCallback(
        (scope: PrintScope): EventResults[] => {
            const scopedEvents = scope === "all" ? (events ?? []) : currentEvent ? [currentEvent] : [];

            const finalistsData: EventResults[] = [];

            for (const event of scopedEvents) {
                const scopedBrackets =
                    scope === "age" && event.id === currentEvent?.id && currentBracket
                        ? [currentBracket]
                        : (event.age_brackets ?? []);

                const brackets: BracketResults[] = [];
                for (const bracket of scopedBrackets) {
                    const records = computeEventBracketResults(event, bracket, aggregationContext).filter((record) =>
                        isEligibleForFinalistSelection(sanitizeEventCodes(event.codes), record.bestTime),
                    );
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

            return finalistsData;
        },
        [aggregationContext, currentBracket, currentEvent, events],
    );

    const handlePrintFinalists = useCallback(
        async (scope: PrintScope = "age") => {
            if (!tournament) return;

            setLoading(true);
            try {
                const finalistsData = buildFinalistsPrintData(scope);

                if (finalistsData.length === 0) {
                    const scopeLabel =
                        scope === "all"
                            ? "No finalists found to print."
                            : scope === "event"
                              ? "No finalists found for the current event."
                              : "No finalists found for the current age bracket.";
                    Message.info(scopeLabel);
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
        },
        [buildFinalistsPrintData, tournament],
    );

    const buildFinalistsTimeSheetEntries = useCallback(
        (scope: PrintScope) => {
            const scopedEvents = scope === "all" ? (events ?? []) : currentEvent ? [currentEvent] : [];

            return scopedEvents.flatMap((event) => {
                const scopedBrackets =
                    scope === "age" && event.id === currentEvent?.id && currentBracket
                        ? [currentBracket]
                        : (event.age_brackets ?? []);

                return scopedBrackets.flatMap((bracket) => {
                    const records = computeEventBracketResults(event, bracket, aggregationContext).filter((record) =>
                        isEligibleForFinalistSelection(sanitizeEventCodes(event.codes), record.bestTime),
                    );

                    if (records.length === 0) {
                        return [];
                    }

                    const finalCriteria = bracket.final_criteria ?? [];
                    let processedCount = 0;
                    const entries: Array<{
                        participant: Registration | Team;
                        division: string;
                        sheetType: string;
                        eventCodes: string[];
                        roundLabel: string;
                    }> = [];

                    for (const criterion of finalCriteria) {
                        const classificationLabel = criterion.classification
                            ? `${bracket.name} - ${criterion.classification}`
                            : bracket.name;
                        const bracketFinalists = records.slice(processedCount, processedCount + criterion.number);
                        for (const finalistRecord of bracketFinalists) {
                            const participant = isTournamentTeamEvent(event) ? finalistRecord.team : finalistRecord.registration;
                            if (!participant) {
                                continue;
                            }

                            entries.push({
                                participant,
                                division: classificationLabel,
                                sheetType: event.type,
                                eventCodes: sanitizeEventCodes(event.codes),
                                roundLabel: "Final",
                            });
                        }
                        processedCount += criterion.number;
                    }

                    return entries;
                });
            });
        },
        [aggregationContext, currentBracket, currentEvent, events],
    );

    const handlePrintTimeSheet = useCallback(
        async (scope: PrintScope = "age") => {
            if (!tournament) return;

            setLoading(true);
            try {
                const entries = buildFinalistsTimeSheetEntries(scope);

                if (entries.length === 0) {
                    const scopeLabel =
                        scope === "all"
                            ? "No finalists found to print time sheets."
                            : scope === "event"
                              ? "No finalists found for the current event."
                              : "No finalists found for the current age bracket.";
                    Message.info(scopeLabel);
                    return;
                }

                await exportCombinedTimeSheetsPDF({
                    tournament,
                    entries,
                    ageMap,
                    nameMap: combinedNameMap,
                    logoUrl: tournament.logo ?? "",
                });
                Message.success("Final time sheets opened in new tab!");
            } catch (error) {
                console.error(error);
                Message.error("Failed to generate time sheets");
            } finally {
                setLoading(false);
            }
        },
        [ageMap, buildFinalistsTimeSheetEntries, combinedNameMap, tournament],
    );

    const handleStartFinal = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const approvedRegistrations = registrations.filter((registration) => registration.registration_status === "approved");
            const approvedRegistrationIds = new Set(
                approvedRegistrations
                    .flatMap((registration) => [registration.user_id, registration.user_global_id])
                    .filter(Boolean),
            );
            const validationErrors: string[] = [];

            for (const event of events) {
                const eventKey = getEventKey(event);
                const eventCodes = sanitizeEventCodes(event.codes);

                for (const bracket of event.age_brackets ?? []) {
                    if (isTournamentTeamEvent(event)) {
                        const participantsForBracket = teams.filter((team) => {
                            const teamAge = team.team_age;
                            if (typeof teamAge !== "number" || teamAge < bracket.min_age || teamAge > bracket.max_age) {
                                return false;
                            }

                            const leaderId = stripTeamLeaderPrefix(team.leader_id);
                            if (!approvedRegistrationIds.has(leaderId)) {
                                return false;
                            }

                            return (
                                teamMatchesEventKey(team, eventKey, events) ||
                                teamMatchesEventKey(team, event.id ?? "", events) ||
                                teamMatchesEventKey(team, event.type, events)
                            );
                        });

                        for (const team of participantsForBracket) {
                            if (eventCodes.length > 0) {
                                for (const code of eventCodes) {
                                    const hasRecord = allRecords.some(
                                        (record) =>
                                            isTeamRecord(record) &&
                                            getTeamId(record) === team.id &&
                                            record.code === code &&
                                            (event.id ? record.event_id === event.id : record.event === event.type),
                                    );

                                    if (!hasRecord) {
                                        validationErrors.push(
                                            `${team.name} missing ${code} record for ${getEventLabel(event)} (${bracket.name})`,
                                        );
                                    }
                                }
                            } else {
                                const hasRecord = allRecords.some(
                                    (record) =>
                                        isTeamRecord(record) &&
                                        getTeamId(record) === team.id &&
                                        (event.id ? record.event_id === event.id : record.event === event.type),
                                );

                                if (!hasRecord) {
                                    validationErrors.push(
                                        `${team.name} missing record for ${getEventLabel(event)} (${bracket.name})`,
                                    );
                                }
                            }
                        }
                        continue;
                    }

                    const participantsForBracket = approvedRegistrations.filter((registration) => {
                        if (!registrationMatchesEvent(registration, event)) {
                            return false;
                        }

                        return registration.age >= bracket.min_age && registration.age <= bracket.max_age;
                    });

                    for (const participant of participantsForBracket) {
                        if (eventCodes.length > 0) {
                            for (const code of eventCodes) {
                                const hasRecord = allRecords.some(
                                    (record) =>
                                        isIndividualRecord(record) &&
                                        record.participant_id === participant.user_id &&
                                        record.code === code &&
                                        (event.id ? record.event_id === event.id : record.event === event.type),
                                );

                                if (!hasRecord) {
                                    validationErrors.push(
                                        `${participant.user_name} (${participant.user_global_id}) missing ${code} record for ${getEventLabel(event)} (${bracket.name})`,
                                    );
                                }
                            }
                        } else {
                            const hasRecord = allRecords.some(
                                (record) =>
                                    isIndividualRecord(record) &&
                                    record.participant_id === participant.user_id &&
                                    (event.id ? record.event_id === event.id : record.event === event.type),
                            );

                            if (!hasRecord) {
                                validationErrors.push(
                                    `${participant.user_name} (${participant.user_global_id}) missing record for ${getEventLabel(event)} (${bracket.name})`,
                                );
                            }
                        }
                    }
                }
            }

            if (validationErrors.length > 0) {
                const previewErrors = validationErrors.slice(0, 20);
                const remainingCount = validationErrors.length - previewErrors.length;

                Modal.warning({
                    title: "Cannot Start Final",
                    style: {width: 720},
                    content: (
                        <div style={{maxHeight: 420, overflowY: "auto"}}>
                            <p style={{marginBottom: 12}}>
                                Finals can only start after every required prelim record has been entered.
                            </p>
                            <ul style={{paddingLeft: 20, margin: 0}}>
                                {previewErrors.map((error) => (
                                    <li key={error} style={{marginBottom: 8}}>
                                        {error}
                                    </li>
                                ))}
                            </ul>
                            {remainingCount > 0 ? (
                                <p style={{marginTop: 12}}>And {remainingCount} more missing records.</p>
                            ) : null}
                        </div>
                    ),
                });
                setLoading(false);
                return;
            }

            const finalists: Finalist[] = [];

            for (const event of events) {
                const eventCodes = sanitizeEventCodes(event.codes);
                const eventCode = eventCodes[0] ?? event.type;

                for (const bracket of event.age_brackets ?? []) {
                    const records = computeEventBracketResults(event, bracket, aggregationContext);
                    if (records.length === 0) continue;
                    const eligibleRecords = records.filter((record) =>
                        isEligibleForFinalistSelection(sanitizeEventCodes(event.codes), record.bestTime),
                    );
                    if (eligibleRecords.length === 0) continue;

                    const finalCriteria = bracket.final_criteria ?? [];
                    let processedCount = 0;
                    for (const criterion of finalCriteria) {
                        const {classification, number} = criterion;
                        const bracketFinalists = eligibleRecords.slice(processedCount, processedCount + number);
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

    const handleCopyShareLink = useCallback(async () => {
        if (!tournamentId) return;
        const shareUrl = `${globalThis.location.origin}/score-sheet/${tournamentId}/prelim`;
        try {
            await navigator.clipboard.writeText(shareUrl);
            Message.success("Share link copied.");
        } catch (error) {
            console.error(error);
            Message.error("Failed to copy share link.");
        }
    }, [tournamentId]);

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
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="primary"
                            status="success"
                            icon={<IconCaretRight />}
                            onClick={handleStartFinal}
                            loading={loading}
                        >
                            Start Final
                        </Button>
                        <Dropdown
                            trigger="click"
                            droplist={
                                <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg min-w-[190px]">
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrint("all")}
                                    >
                                        Print All
                                    </Button>
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrint("event")}
                                    >
                                        Print Current Event
                                    </Button>
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrint("age")}
                                    >
                                        Print Current Age
                                    </Button>
                                </div>
                            }
                        >
                            <Button type="primary" icon={<IconPrinter />} loading={loading}>
                                Print Results
                            </Button>
                        </Dropdown>
                        {canShareLinks && (
                            <Button type="outline" icon={<IconCopy />} onClick={handleCopyShareLink}>
                                Copy Share Link
                            </Button>
                        )}
                        <Dropdown
                            trigger="click"
                            droplist={
                                <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg min-w-[190px]">
                                    <Button
                                        type="text"
                                        status="warning"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintFinalists("all")}
                                    >
                                        Print All
                                    </Button>
                                    <Button
                                        type="text"
                                        status="warning"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintFinalists("event")}
                                    >
                                        Print Current Event
                                    </Button>
                                    <Button
                                        type="text"
                                        status="warning"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintFinalists("age")}
                                    >
                                        Print Current Age
                                    </Button>
                                </div>
                            }
                        >
                            <Button type="primary" status="warning" icon={<IconPrinter />} loading={loading}>
                                Print Finalists
                            </Button>
                        </Dropdown>
                        <Dropdown
                            trigger="click"
                            droplist={
                                <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg min-w-[190px]">
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintTimeSheet("all")}
                                    >
                                        Print All
                                    </Button>
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintTimeSheet("event")}
                                    >
                                        Print Current Event
                                    </Button>
                                    <Button
                                        type="text"
                                        className="text-left"
                                        loading={loading}
                                        onClick={() => handlePrintTimeSheet("age")}
                                    >
                                        Print Current Age
                                    </Button>
                                </div>
                            }
                        >
                            <Button type="primary" icon={<IconPrinter />} loading={loading}>
                                Print Time Sheet
                            </Button>
                        </Dropdown>
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
                                                    ? (record: AggregatedPrelimResult) =>
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
