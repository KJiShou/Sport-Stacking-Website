import type {AgeBracket, AggregationContext, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import {getEventCategoryFromType, saveTournamentFinalists} from "@/services/firebase/finalistService";
import type {FinalistGroupPayload} from "@/schema";
import {getTournamentPrelimRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import type {BracketResults, EventResults, PrelimResultData} from "@/schema";
import {exportAllPrelimResultsToPDF, exportFinalistsNameListToPDF} from "@/utils/PDF/pdfExport";
import {getEventLabel, isTeamEvent as isTournamentTeamEvent, sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import {Button, Message, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconCaretRight, IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import type {TournamentRecord, TournamentTeamRecord} from "../../../schema/RecordSchema";

const {Title} = Typography;
const {TabPane} = Tabs;

type AggregatedPrelimResult = PrelimResultData & {
    registration?: Registration;
    team?: Team;
    teamId?: string;
    [key: string]: unknown;
};

const normalizeCodeKey = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, "");

const getRawEventCodes = (event: TournamentEvent): string[] => {
    if (event.codes && event.codes.length > 0) return [...event.codes];
    const legacyEvent = event as {code?: unknown};
    if (typeof legacyEvent.code === "string") return [legacyEvent.code];
    return [];
};

const getEventCodes = (event: TournamentEvent): string[] => sanitizeEventCodes(getRawEventCodes(event));

const getPrimaryEventCode = (event: TournamentEvent): string => {
    const sanitized = getEventCodes(event);
    if (sanitized.length > 0) return sanitized[0];
    const raw = getRawEventCodes(event);
    if (raw.length > 0) return raw[0];
    return event.type;
};

const buildEventTabKey = (event: TournamentEvent): string => `${getPrimaryEventCode(event)}-${event.type}`;

const matchesRecordCode = (record: TournamentRecord, code: string, event: TournamentEvent): boolean => {
    const recordEvent = record.event?.trim().toLowerCase();
    if (!recordEvent) return false;

    const normalizedRecord = recordEvent.replace(/\s+/g, "");
    const normalizedCode = code.toLowerCase().replace(/\s+/g, "");
    const normalizedType = event.type.toLowerCase().replace(/\s+/g, "");

    if (normalizedRecord === `${normalizedCode}-${normalizedType}`) return true;
    if (normalizedRecord === `${normalizedCode}${normalizedType}`) return true;
    if (normalizedRecord === `${normalizedCode}-individual` && normalizedType === "individual") return true;
    if (normalizedRecord === `${normalizedCode}-teamrelay` && normalizedType === "teamrelay") return true;
    if (normalizedRecord === `${normalizedCode}`) return true;

    return normalizedRecord.includes(normalizedCode) && normalizedRecord.includes(normalizedType);
};

const computeTeamMultiCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    codes: string[],
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    const aggregates = new Map<string, AggregatedPrelimResult>();

    for (const code of codes) {
        for (const record of context.allRecords) {
            if (!(record as TournamentTeamRecord).leaderId) continue;
            if (!matchesRecordCode(record, code, event)) continue;

            const teamId = record.participantId as string | undefined;
            if (!teamId) continue;
            const team = context.teamMap[teamId];
            if (!team) continue;
            const largestAge = team.largest_age;
            if (largestAge === undefined || largestAge < bracket.min_age || largestAge > bracket.max_age) continue;

            let aggregate = aggregates.get(teamId);
            if (!aggregate) {
                aggregate = {
                    ...record,
                    participantId: teamId,
                    name: context.teamNameMap[teamId] || team.name || "N/A",
                    id: team.leader_id || teamId || "unknown",
                    bestTime: 0,
                    rank: 0,
                    team,
                    teamId,
                    event: `${getPrimaryEventCode(event)}-${event.type}`,
                };
                aggregates.set(teamId, aggregate);
            }

            (aggregate as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`] = record.bestTime;
        }
    }

    const results: AggregatedPrelimResult[] = [];
    for (const aggregate of aggregates.values()) {
        let total = 0;
        let complete = true;
        for (const code of codes) {
            const value = aggregate[`${normalizeCodeKey(code)}Best`];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                complete = false;
                break;
            }
            total += value;
        }
        if (!complete) continue;
        results.push({...aggregate, bestTime: total});
    }

    results.sort((a, b) => a.bestTime - b.bestTime);
    return results.map((record, index) => ({...record, rank: index + 1}));
};

const computeTeamSingleCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    code: string,
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    return context.allRecords
        .filter((record) => (record as TournamentTeamRecord).leaderId && matchesRecordCode(record, code, event))
        .filter((record) => {
            const teamId = record.participantId as string | undefined;
            if (!teamId) return false;
            const team = context.teamMap[teamId];
            if (!team) return false;
            const largestAge = team.largest_age;
            return largestAge >= bracket.min_age && largestAge <= bracket.max_age;
        })
        .sort((a, b) => a.bestTime - b.bestTime)
        .map((record, index) => {
            const teamId = record.participantId as string;
            const team = context.teamMap[teamId];
            return {
                ...record,
                rank: index + 1,
                name: context.teamNameMap[teamId] || team?.name || "N/A",
                id: team?.leader_id || teamId || "unknown",
                teamId,
                team,
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
            if (!matchesRecordCode(record, code, event)) continue;
            const participantId = record.participantId as string | undefined;
            if (!participantId) continue;
            const age = context.ageMap[participantId];
            if (age < bracket.min_age || age > bracket.max_age) continue;

            let aggregate = aggregates.get(participantId);
            if (!aggregate) {
                aggregate = {
                    ...record,
                    participantId,
                    name: context.nameMap[participantId] || "N/A",
                    id: participantId,
                    bestTime: 0,
                    rank: 0,
                    registration: context.registrationMap[participantId],
                    event: `${getPrimaryEventCode(event)}-${event.type}`,
                };
                aggregates.set(participantId, aggregate);
            }

            (aggregate as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`] = record.bestTime;
        }
    }

    const results: AggregatedPrelimResult[] = [];
    for (const aggregate of aggregates.values()) {
        const participantId = aggregate.participantId as string;
        let total = 0;
        let complete = true;
        for (const code of codes) {
            const value = aggregate[`${normalizeCodeKey(code)}Best`];
            if (typeof value !== "number" || !Number.isFinite(value)) {
                complete = false;
                break;
            }
            total += value;
        }
        if (!complete) continue;
        aggregate.bestTime = total;
        aggregate.registration = context.registrationMap[participantId];
        results.push(aggregate);
    }

    results.sort((a, b) => a.bestTime - b.bestTime);
    return results.map((record, index) => ({...record, rank: index + 1}));
};

const computeIndividualSingleCodeResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    code: string,
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    return context.allRecords
        .filter((record) => matchesRecordCode(record, code, event))
        .filter((record) => {
            const participantId = record.participantId as string | undefined;
            if (!participantId) return false;
            const age = context.ageMap[participantId];
            return age >= bracket.min_age && age <= bracket.max_age;
        })
        .sort((a, b) => a.bestTime - b.bestTime)
        .map((record, index) => {
            const participantId = record.participantId as string;
            return {
                ...record,
                rank: index + 1,
                name: context.nameMap[participantId] || "N/A",
                id: participantId,
                registration: context.registrationMap[participantId],
            } as AggregatedPrelimResult;
        });
};

const computeEventBracketResults = (
    event: TournamentEvent,
    bracket: AgeBracket,
    context: AggregationContext,
): AggregatedPrelimResult[] => {
    const codes = getEventCodes(event);
    const isTeamEvent = isTournamentTeamEvent(event);

    if (isTeamEvent) {
        if (codes.length > 1) {
            return computeTeamMultiCodeResults(event, bracket, codes, context);
        }
        const primary = codes[0] ?? getPrimaryEventCode(event);
        return computeTeamSingleCodeResults(event, bracket, primary, context);
    }

    if (codes.length > 1) {
        return computeIndividualMultiCodeResults(event, bracket, codes, context);
    }
    const primary = codes[0] ?? getPrimaryEventCode(event);
    return computeIndividualSingleCodeResults(event, bracket, primary, context);
};

const buildTeamColumns = (event: TournamentEvent): TableColumnProps<AggregatedPrelimResult>[] => {
    const baseColumns: TableColumnProps<AggregatedPrelimResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 160,
            render: (_value, record) => record.team?.leader_id ?? record.id,
        },
    ];

    const codes = getEventCodes(event);
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${normalizeCodeKey(code)}Best`;
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
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
    ];

    const codes = getEventCodes(event);
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${normalizeCodeKey(code)}Best`;
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
        const normalizedKey = `${normalizeCodeKey(code)}Best`;
        const baseMatch = allRecords.find((candidate) => {
            if (isTeamEvent) {
                const teamId = record.team?.id ?? record.participantId;
                return candidate.participantId === teamId && matchesRecordCode(candidate, code, event);
            }
            return candidate.participantId === record.participantId && matchesRecordCode(candidate, code, event);
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
    const [allRecords, setAllRecords] = useState<TournamentRecord[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const fetchedTournament = await fetchTournamentById(tournamentId);
                if (fetchedTournament?.events) {
                    setTournament(fetchedTournament);

                    const firstEvent = fetchedTournament.events[0];
                    if (firstEvent) {
                        setCurrentEventTab(buildEventTabKey(firstEvent));
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

                setAllRecords(fetchedRecords);
                setRegistrations(fetchedRegistrations);
                setTeams(fetchedTeams);
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
            events?.find((event) => buildEventTabKey(event) === key),
        [],
    );

    const currentEvent = useMemo(
        () => findEventByTabKey(tournament?.events ?? [], currentEventTab),
        [findEventByTabKey, tournament?.events, currentEventTab],
    );

    const currentBracket = useMemo(
        () => currentEvent?.age_brackets?.find((bracket) => bracket.name === currentBracketTab),
        [currentEvent, currentBracketTab],
    );

    const handlePrint = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const resultsData: EventResults[] = (tournament.events ?? [])
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

            for (const event of tournament.events ?? []) {
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
                            brackets.push({
                                bracket,
                                records: bracketFinalists,
                                classification,
                                highlightFinalists: true,
                            });
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
            const finalists: Array<{
                event: TournamentEvent;
                eventCode: string;
                eventCodes: string[];
                bracket: AgeBracket;
                records: AggregatedPrelimResult[];
                classification: "beginner" | "intermediate" | "advance";
            }> = [];

            for (const event of tournament.events ?? []) {
                const codes = getEventCodes(event);
                const eventCodes = codes.length > 0 ? codes : [getPrimaryEventCode(event)];
                const primaryCode = eventCodes[0];

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
                                eventCode: primaryCode,
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

            const finalistPayloads = finalists
                .map<FinalistGroupPayload | null>((finalistEntry) => {
                    const eventCategory = getEventCategoryFromType(finalistEntry.event.type);
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
                        eventCategory,
                        eventName: finalistEntry.eventCode,
                        bracketName: finalistEntry.bracket.name,
                        classification: finalistEntry.classification,
                        participantIds,
                        participantType: isTournamentTeamEvent(finalistEntry.event) ? "team" : "individual",
                    } satisfies FinalistGroupPayload;
                })
                .filter((payload): payload is FinalistGroupPayload => payload !== null);

            if (finalistPayloads.length > 0) {
                try {
                    if (!tournamentId) {
                        Message.error("Tournament ID is missing. Cannot save finalists.");
                        setLoading(false);
                        return;
                    }
                    await saveTournamentFinalists(tournamentId, finalistPayloads);
                } catch (error) {
                    console.error("Failed to save finalists:", error);
                    Message.error("Failed to save finalists. Please try again.");
                    setLoading(false);
                    return;
                }
            }

            navigate(`/tournaments/${tournamentId}/scoring/final`, {
                state: {finalists, tournament, registrations, teams},
            });
        } catch (error) {
            console.error(error);
            Message.error("Failed to start finals.");
        } finally {
            setLoading(false);
        }
    }, [aggregationContext, navigate, registrations, teams, tournament, tournamentId]);

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
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
                        const event = findEventByTabKey(tournament?.events ?? [], key);
                        const firstBracket = event?.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                        }
                    }}
                >
                    {(tournament?.events ?? []).map((event) => {
                        const tabKey = buildEventTabKey(event);
                        const eventLabel = getEventLabel(event) || `${getPrimaryEventCode(event)} (${event.type})`;
                        const isTeamEvent = isTournamentTeamEvent(event);
                        const eventCodes = getEventCodes(event);
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
