// @ts-nocheck
import {useAuthContext} from "@/context/AuthContext";
import type {
    AgeBracket,
    AggregationContext,
    BracketResults,
    EventResults,
    PrelimResultData,
    Registration,
    Team,
    Tournament,
    TournamentEvent,
} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {
    getTournamentFinalOverallRecords,
    getTournamentFinalRecords,
    getTournamentPrelimOverallRecords,
    getTournamentPrelimRecords,
} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {
    exportAllPrelimResultsToPDF,
    exportCertificatesPDF,
    exportCombinedTimeSheetsPDF,
    exportFinalistsNameListToPDF,
} from "@/utils/PDF/pdfExport";
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
import {buildFinalistClassificationMap} from "@/utils/tournament/finalistStyling";
import {computeEventBracketResults} from "@/utils/tournament/resultAggregation";
import {Button, Card, Dropdown, Message, Select, Space, Tabs, Typography} from "@arco-design/web-react";
import {IconPrinter} from "@arco-design/web-react/icon";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useParams} from "react-router-dom";

const {Title, Text} = Typography;
const {TabPane} = Tabs;
type PrintScope = "all" | "event" | "age";
type ResultRound = "prelim" | "final";

type AggregatedResult = Partial<PrelimResultData> & {
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

const resolveBestTime = (record: Partial<TournamentRecord | TournamentTeamRecord>): number => {
    const direct = record.best_time ?? (record as unknown as {bestTime?: number}).bestTime;
    if (typeof direct === "number" && Number.isFinite(direct)) {
        return direct;
    }
    const attempts = getOrderedAttemptTimes(record);
    return attempts[0] ?? Number.POSITIVE_INFINITY;
};

const sortWithBestTimes = (a: AggregatedResult, b: AggregatedResult): number => {
    const primary = (a.bestTime ?? Number.POSITIVE_INFINITY) - (b.bestTime ?? Number.POSITIVE_INFINITY);
    if (primary !== 0) return primary;
    const secondary = (a.secondBestTime ?? Number.POSITIVE_INFINITY) - (b.secondBestTime ?? Number.POSITIVE_INFINITY);
    if (secondary !== 0) return secondary;
    return (a.thirdBestTime ?? Number.POSITIVE_INFINITY) - (b.thirdBestTime ?? Number.POSITIVE_INFINITY);
};

const isTeamRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    (record as TournamentTeamRecord).team_id !== undefined;

const getTeamId = (record: Partial<TournamentTeamRecord | AggregatedResult>): string | undefined =>
    record.team_id ?? record.teamId ?? (record as {participantId?: string}).participantId;

const getParticipantId = (record: Partial<TournamentRecord | AggregatedResult>): string | undefined =>
    record.participant_id ?? (record as {participantId?: string}).participantId ?? record.id ?? record.id;

const getTeamAge = (record: Partial<TournamentTeamRecord | AggregatedResult>): number | undefined =>
    (record as {team_age?: number}).team_age ?? (record as {largest_age?: number}).largest_age;

const formatTime = (time?: number): string => {
    if (typeof time !== "number" || Number.isNaN(time) || time <= 0) {
        return "N/A";
    }
    return time.toFixed(3);
};

const getPlacementLabel = (rank?: number): string => {
    if (!rank) return "Participant";
    switch (rank) {
        case 1:
            return "Champion";
        case 2:
            return "1st Runner Up";
        case 3:
            return "2nd Runner Up";
        default:
            return `Rank ${rank}`;
    }
};

export default function PrintResultsPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [prelimRecords, setPrelimRecords] = useState<Array<TournamentRecord | TournamentTeamRecord>>([]);
    const [finalRecords, setFinalRecords] = useState<Array<TournamentRecord | TournamentTeamRecord>>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentRound, setCurrentRound] = useState<ResultRound>("prelim");
    const [currentEventId, setCurrentEventId] = useState<string>("");
    const [currentBracketName, setCurrentBracketName] = useState<string>("");
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

    const currentEvent = useMemo(
        () => sortedEvents.find((event) => event.id === currentEventId) ?? sortedEvents[0],
        [sortedEvents, currentEventId],
    );

    const currentBracket = useMemo(
        () =>
            currentEvent?.age_brackets?.find((bracket) => bracket.name === currentBracketName) ?? currentEvent?.age_brackets?.[0],
        [currentEvent, currentBracketName],
    );

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const fetchedTournament = await fetchTournamentById(tournamentId);
                const fetchedEvents = await fetchTournamentEvents(tournamentId);
                if (fetchedEvents) {
                    const scoringEvents = fetchedEvents.filter((event) => isScoreTrackedEvent(event));
                    setTournament(fetchedTournament);
                    setEvents(scoringEvents);
                    if (scoringEvents.length > 0) {
                        setCurrentEventId(scoringEvents[0].id);
                        if (scoringEvents[0].age_brackets && scoringEvents[0].age_brackets.length > 0) {
                            setCurrentBracketName(scoringEvents[0].age_brackets[0].name);
                        }
                    }
                } else {
                    setTournament(fetchedTournament);
                }

                const [prelim, final, fetchedRegistrations, fetchedTeams] = await Promise.all([
                    getTournamentPrelimRecords(tournamentId),
                    getTournamentFinalRecords(tournamentId),
                    fetchRegistrations(tournamentId),
                    fetchTeamsByTournament(tournamentId),
                ]);
                const verifiedTeams = fetchedTeams.filter((team) => isTeamFullyVerified(team));
                const verifiedTeamIds = new Set(verifiedTeams.map((team) => team.id));

                const filteredPrelimRecords = (prelim as Array<TournamentRecord | TournamentTeamRecord>).filter((record) => {
                    if (!isTeamRecord(record)) {
                        return true;
                    }
                    const teamId = getTeamId(record);
                    return teamId ? verifiedTeamIds.has(teamId) : false;
                });

                const filteredFinalRecords = (final as Array<TournamentRecord | TournamentTeamRecord>).filter((record) => {
                    if (!isTeamRecord(record)) {
                        return true;
                    }
                    const teamId = getTeamId(record);
                    return teamId ? verifiedTeamIds.has(teamId) : false;
                });

                setPrelimRecords(filteredPrelimRecords);
                setFinalRecords(filteredFinalRecords);
                setRegistrations(fetchedRegistrations);
                setTeams(verifiedTeams);
            } catch (error) {
                console.error(error);
                Message.error("Failed to fetch data.");
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

    const prelimContext = useMemo<AggregationContext>(
        () => ({
            allRecords: prelimRecords,
            registrations,
            registrationMap,
            teams,
            teamMap,
            nameMap,
            ageMap,
            teamNameMap,
        }),
        [prelimRecords, registrations, registrationMap, teams, teamMap, nameMap, ageMap, teamNameMap],
    );

    const finalContext = useMemo<AggregationContext>(
        () => ({
            allRecords: finalRecords,
            registrations,
            registrationMap,
            teams,
            teamMap,
            nameMap,
            ageMap,
            teamNameMap,
        }),
        [finalRecords, registrations, registrationMap, teams, teamMap, nameMap, ageMap, teamNameMap],
    );

    const buildPrelimResultsData = useCallback(
        (scope: PrintScope): EventResults[] => {
            const context = prelimContext;
            const scopedEvents = scope === "all" ? sortedEvents : currentEvent ? [currentEvent] : [];

            return scopedEvents
                .map((event) => {
                    const scopedBrackets = scope === "age" && currentBracket ? [currentBracket] : (event.age_brackets ?? []);

                    const brackets: BracketResults[] = scopedBrackets
                        .map((bracket) => {
                            const records = computeEventBracketResults(event, bracket, context);
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
        [prelimContext, sortedEvents, currentEvent, currentBracket],
    );

    const buildFinalResultsData = useCallback(
        (scope: PrintScope): EventResults[] => {
            const scopedEvents = scope === "all" ? sortedEvents : currentEvent ? [currentEvent] : [];

            return scopedEvents
                .map((event) => {
                    const scopedBrackets =
                        scope === "age" && event.id === currentEvent?.id && currentBracket
                            ? [currentBracket]
                            : (event.age_brackets ?? []);

                    const brackets: BracketResults[] = scopedBrackets
                        .flatMap((bracket) => {
                            const criteria =
                                scope === "age" && event.id === currentEvent?.id && bracket.name === currentBracket?.name
                                    ? (bracket.final_criteria ?? []).filter(
                                          (fc) => fc.classification === currentClassificationTab,
                                      )
                                    : (bracket.final_criteria ?? []);

                            return criteria.map((fc) => {
                                const records = computeEventBracketResults(event, bracket, finalContext, fc.classification);
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
        },
        [finalContext, sortedEvents, currentEvent, currentBracket, currentClassificationTab],
    );

    const handlePrintPrelimResults = useCallback(
        async (scope: PrintScope = "age") => {
            if (!tournament) return;

            setLoading(true);
            try {
                const resultsData = buildPrelimResultsData(scope);

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
        },
        [tournament, buildPrelimResultsData],
    );

    const handlePrintFinalResults = useCallback(
        async (scope: PrintScope = "age") => {
            if (!tournament) return;

            setLoading(true);
            try {
                const resultsData = buildFinalResultsData(scope);

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
        },
        [tournament, buildFinalResultsData],
    );

    const handlePrintCertificates = useCallback(async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const certificateEntries = [];
            for (const event of events ?? []) {
                const eventLabel = getEventLabel(event);
                const isTeamEvt = isTournamentTeamEvent(event);
                for (const bracket of event.age_brackets ?? []) {
                    for (const fc of bracket.final_criteria ?? []) {
                        const bracketResults = computeEventBracketResults(event, bracket, finalContext, fc.classification);
                        for (const record of bracketResults) {
                            const classificationLabel = fc.classification.charAt(0).toUpperCase() + fc.classification.slice(1);
                            const divisionLabel = `${bracket.name} - ${classificationLabel}`;
                            const times = (event.codes ?? []).map((code) => {
                                const key = `${code} Best`;
                                const timeValue =
                                    typeof record[key] === "number"
                                        ? formatTime(record[key] as number)
                                        : event.codes.length === 1
                                          ? formatTime(record.bestTime)
                                          : "N/A";
                                return {
                                    label: code,
                                    value: timeValue,
                                };
                            });

                            certificateEntries.push({
                                participantName: record.name ?? "N/A",
                                eventLabel,
                                divisionLabel,
                                categoryLabel: isTeamEvt ? "Team" : event.type.charAt(0).toUpperCase() + event.type.slice(1),
                                times,
                                totalTime: typeof record.bestTime === "number" ? formatTime(record.bestTime) : undefined,
                                placementLabel: getPlacementLabel(record.rank),
                                rank: record.rank ?? undefined,
                            });
                        }
                    }
                }
            }

            if (certificateEntries.length === 0) {
                Message.info("No certificates to generate.");
                return;
            }

            await exportCertificatesPDF({
                tournament,
                entries: certificateEntries,
                logoUrl: tournament.logo ?? "",
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    }, [tournament, events, finalContext]);

    const eventOptions = sortedEvents.map((event) => ({
        label: getEventLabel(event),
        value: event.id,
    }));

    const bracketOptions =
        currentEvent?.age_brackets?.map((bracket) => ({
            label: `${bracket.name} (${bracket.min_age}-${bracket.max_age})`,
            value: bracket.name,
        })) ?? [];

    const eventDropdownProps = {
        onChange: (value: string) => {
            setCurrentEventId(value);
            const event = sortedEvents.find((e) => e.id === value);
            if (event?.age_brackets && event.age_brackets.length > 0) {
                setCurrentBracketName(event.age_brackets[0].name);
            }
        },
    };

    return (
        <div className="flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-stretch p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <Title heading={3} className="mb-4">
                    Print Results
                </Title>

                {tournament && (
                    <Card className="mb-4">
                        <Text type="secondary" className="text-lg">
                            Tournament: {tournament.name}
                        </Text>
                    </Card>
                )}

                <Tabs activeTab={currentRound} onChange={(tab) => setCurrentRound(tab as ResultRound)} className="mb-4">
                    <TabPane key="prelim" title="Preliminary Results">
                        <Card className="mb-4">
                            <div className="flex flex-wrap gap-4 mb-4">
                                <div className="flex items-center gap-2">
                                    <Text>Event:</Text>
                                    <Select
                                        placeholder="Select event"
                                        style={{width: 300}}
                                        options={eventOptions}
                                        {...eventDropdownProps}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Text>Age Bracket:</Text>
                                    <Select
                                        placeholder="Select bracket"
                                        style={{width: 200}}
                                        options={bracketOptions}
                                        value={currentBracketName}
                                        onChange={setCurrentBracketName}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Dropdown
                                    trigger="click"
                                    droplist={
                                        <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg min-w-[190px]">
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintPrelimResults("all")}
                                            >
                                                Print All
                                            </Button>
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintPrelimResults("event")}
                                            >
                                                Print Current Event
                                            </Button>
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintPrelimResults("age")}
                                            >
                                                Print Current Age
                                            </Button>
                                        </div>
                                    }
                                >
                                    <Button type="primary" icon={<IconPrinter />} loading={loading}>
                                        Print Preliminary Results
                                    </Button>
                                </Dropdown>
                            </div>
                        </Card>
                    </TabPane>

                    <TabPane key="final" title="Final Results">
                        <Card className="mb-4">
                            <div className="flex flex-wrap gap-4 mb-4">
                                <div className="flex items-center gap-2">
                                    <Text>Event:</Text>
                                    <Select
                                        placeholder="Select event"
                                        style={{width: 300}}
                                        options={eventOptions}
                                        {...eventDropdownProps}
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <Text>Age Bracket:</Text>
                                    <Select
                                        placeholder="Select bracket"
                                        style={{width: 200}}
                                        options={bracketOptions}
                                        value={currentBracketName}
                                        onChange={setCurrentBracketName}
                                    />
                                </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Dropdown
                                    trigger="click"
                                    droplist={
                                        <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg min-w-[190px]">
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintFinalResults("all")}
                                            >
                                                Print All
                                            </Button>
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintFinalResults("event")}
                                            >
                                                Print Current Event
                                            </Button>
                                            <Button
                                                type="text"
                                                className="text-left"
                                                loading={loading}
                                                onClick={() => handlePrintFinalResults("age")}
                                            >
                                                Print Current Age
                                            </Button>
                                        </div>
                                    }
                                >
                                    <Button type="primary" icon={<IconPrinter />} loading={loading}>
                                        Print Final Results
                                    </Button>
                                </Dropdown>
                                <Button
                                    type="primary"
                                    status="success"
                                    icon={<IconPrinter />}
                                    onClick={handlePrintCertificates}
                                    loading={loading}
                                >
                                    Print Certificates
                                </Button>
                            </div>
                        </Card>
                    </TabPane>
                </Tabs>
            </div>
        </div>
    );
}
