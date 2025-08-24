import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Team, Tournament} from "@/schema";
import type {TournamentRecord} from "@/schema/RecordSchema";
import {getTournamentFinalRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, updateTournamentStatus} from "@/services/firebase/tournamentsService";
import {type EventResults, type PrelimResultData, exportAllPrelimResultsToPDF} from "@/utils/PDF/pdfExport";
import {Button, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;

type FinalResult = PrelimResultData;

export default function FinalResultsPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [allRecords, setAllRecords] = useState<TournamentRecord[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("beginner");
    const [availableClassifications, setAvailableClassifications] = useState<string[]>([]);

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const t = await fetchTournamentById(tournamentId);
                if (t?.events) {
                    const individualEvents = ["3-3-3", "3-6-3", "Cycle"];
                    const hasAllIndividualEvents = t.events
                        ? individualEvents.every((eventCode) => t.events?.some((e) => e.code === eventCode))
                        : false;

                    if (hasAllIndividualEvents) {
                        const threeEvent = t.events.find((e) => e.code === "3-3-3");
                        if (threeEvent) {
                            t.events.unshift({
                                ...threeEvent,
                                code: "Overall",
                                type: "Individual",
                            });
                        }
                    }
                    setTournament(t);

                    const firstEvent = t.events?.[0];
                    if (firstEvent) {
                        setCurrentEventTab(`${firstEvent.code}-${firstEvent.type}`);
                        if (firstEvent.age_brackets?.[0]) {
                            setCurrentBracketTab(firstEvent.age_brackets[0].name);
                        }
                    }
                } else {
                    setTournament(t);
                }

                const records = await getTournamentFinalRecords(tournamentId);
                setAllRecords(records);

                const regs = await fetchRegistrations(tournamentId);
                setRegistrations(regs);

                const teamData = await fetchTeamsByTournament(tournamentId);
                setTeams(teamData);
            } catch (error) {
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
                (acc, r) => {
                    acc[r.user_id] = r.user_name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [registrations],
    );

    const ageMap = useMemo(
        () =>
            registrations.reduce(
                (acc, r) => {
                    acc[r.user_id] = r.age;
                    return acc;
                },
                {} as Record<string, number>,
            ),
        [registrations],
    );

    const teamNameMap = useMemo(
        () =>
            teams.reduce(
                (acc, t) => {
                    acc[t.id] = t.name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [teams],
    );

    const overallResults = useMemo<FinalResult[]>(() => {
        if (!allRecords.length || !registrations.length) return [];

        const rows = registrations
            .map((reg) => {
                const threeRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("3-3-3"),
                );
                const threeSixThreeRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("3-6-3"),
                );
                const cycleRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("cycle"),
                );

                if (!threeRecord || !threeSixThreeRecord || !cycleRecord) return null;

                const threeTime = Number.parseFloat(String(threeRecord.bestTime));
                const threeSixThreeTime = Number.parseFloat(String(threeSixThreeRecord.bestTime));
                const cycleTime = Number.parseFloat(String(cycleRecord.bestTime));

                if (
                    Number.isNaN(threeTime) ||
                    Number.isNaN(threeSixThreeTime) ||
                    Number.isNaN(cycleTime) ||
                    threeTime <= 0 ||
                    threeSixThreeTime <= 0 ||
                    cycleTime <= 0
                ) {
                    return null;
                }

                const sum = threeTime + threeSixThreeTime + cycleTime;

                return {
                    ...threeRecord,
                    id: reg.user_id,
                    name: reg.user_name,
                    three: threeTime,
                    threeSixThree: threeSixThreeTime,
                    cycle: cycleTime,
                    bestTime: sum,
                    rank: 0,
                    event: "Overall",
                };
            })
            .filter((r) => r !== null) as FinalResult[];

        const classifiedResults: Record<string, FinalResult[]> = {};
        for (const row of rows) {
            const classification = row.classification ?? "beginner";
            if (!classifiedResults[classification]) {
                classifiedResults[classification] = [];
            }
            classifiedResults[classification].push(row);
        }

        const rankedResults: FinalResult[] = [];
        for (const classification in classifiedResults) {
            const group = classifiedResults[classification];
            group.sort((a, b) => a.bestTime - b.bestTime);
            group.forEach((r, i) => {
                r.rank = i + 1;
            });
            rankedResults.push(...group);
        }

        return rankedResults;
    }, [allRecords, registrations]);

    const handlePrint = async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const resultsData: EventResults[] = (tournament.events ?? []).map((event) => {
                const brackets = (event.age_brackets ?? []).flatMap((bracket) => {
                    const classifications = ["beginner", "intermediate", "advance"];
                    return classifications
                        .map((classification) => {
                            const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                            const eventKey = `${event.code}-${event.type}`;

                            let records: FinalResult[];

                            if (event.code === "Overall") {
                                records = overallResults.filter((r) => {
                                    if (!r.participantId) return false;
                                    const age = ageMap[r.participantId];
                                    return (
                                        age >= bracket.min_age && age <= bracket.max_age && r.classification === classification
                                    );
                                });
                            } else if (isTeamEvent) {
                                records = allRecords
                                    .filter((r) => r.event === eventKey && r.participantId && r.classification === classification)
                                    .filter((r) => {
                                        const team = teams.find((t) => t.id === r.participantId);
                                        return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                                    })
                                    .sort((a, b) => a.bestTime - b.bestTime)
                                    .map((record, index) => ({
                                        ...record,
                                        rank: index + 1,
                                        name: teamNameMap[record.participantId as string] || "N/A",
                                        id: record.participantId as string,
                                    }));
                            } else {
                                records = allRecords
                                    .filter((r) => {
                                        const age = ageMap[r.participantId as string];
                                        return (
                                            r.event === eventKey &&
                                            age >= bracket.min_age &&
                                            age <= bracket.max_age &&
                                            r.classification === classification
                                        );
                                    })
                                    .sort((a, b) => a.bestTime - b.bestTime)
                                    .map((record, index) => ({
                                        ...record,
                                        rank: index + 1,
                                        name: nameMap[record.participantId as string] || "N/A",
                                        id: record.participantId as string,
                                    }));
                            }
                            if (records.length === 0) {
                                return null;
                            }
                            return {
                                bracket,
                                records,
                                classification: classification as "beginner" | "intermediate" | "advance",
                            };
                        })
                        .filter((b) => b !== null);
                });
                return {event, brackets};
            }) as EventResults[];

            await exportAllPrelimResultsToPDF({
                tournament,
                resultsData,
                round: "Final",
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            Message.error("Failed to generate PDF");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const columns: TableColumnProps<FinalResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "3-3-3", dataIndex: "three", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "3-6-3", dataIndex: "threeSixThree", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Cycle", dataIndex: "cycle", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
    ];

    const individualColumns: TableColumnProps<FinalResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
    ];

    const getCurrentResults = () => {
        if (!tournament || !currentEventTab || !currentBracketTab) return [];

        const event = tournament.events?.find((e) => `${e.code}-${e.type}` === currentEventTab);
        if (!event) return [];

        const bracket = event.age_brackets?.find((b) => b.name === currentBracketTab);
        if (!bracket) return [];

        if (event.code === "Overall") {
            return overallResults.filter((r) => {
                if (!r.participantId) return false;
                const age = ageMap[r.participantId];
                return age >= bracket.min_age && age <= bracket.max_age && r.classification === currentClassificationTab;
            });
        }

        const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());

        if (isTeamEvent) {
            return allRecords
                .filter((r) => r.event === currentEventTab && r.participantId && r.classification === currentClassificationTab)
                .filter((r) => {
                    const team = teams.find((t) => t.id === r.participantId);
                    return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                })
                .sort((a, b) => a.bestTime - b.bestTime)
                .map((record, index) => ({
                    ...record,
                    rank: index + 1,
                    name: teamNameMap[record.participantId as string] || "N/A",
                    id: record.participantId as string,
                }));
        }

        // Handle pure individual events (non-Overall, non-team)
        return allRecords
            .filter((r) => {
                const age = ageMap[r.participantId as string];
                return r.event === currentEventTab && age >= bracket.min_age && age <= bracket.max_age;
            })
            .sort((a, b) => a.bestTime - b.bestTime)
            .map((record, index) => ({
                ...record,
                rank: index + 1,
                name: nameMap[record.participantId as string] || "N/A",
                id: record.participantId as string,
            }));
    };

    const currentResults = getCurrentResults();
    const currentEvent = tournament?.events?.find((e) => `${e.code}-${e.type}` === currentEventTab);
    const isOverallEvent = currentEvent?.code === "Overall";
    const isPureIndividualEvent = currentEvent?.type === "Individual" && currentEvent.code !== "Overall";
    const isTeamEvent = currentEvent && ["double", "team relay", "parent & child"].includes(currentEvent.type.toLowerCase());

    useEffect(() => {
        if (!currentEvent || !currentBracketTab) return;

        const bracket = currentEvent.age_brackets?.find((b) => b.name === currentBracketTab);
        if (!bracket) return;

        const classificationsWithData = ["beginner", "intermediate", "advance"].filter((classification) => {
            if (isOverallEvent) {
                return overallResults.some(
                    (r) =>
                        r.classification === classification &&
                        r.participantId &&
                        ageMap[r.participantId] >= bracket.min_age &&
                        ageMap[r.participantId] <= bracket.max_age,
                );
            }
            const isTeamEvent = ["double", "team relay", "parent & child"].includes(currentEvent.type.toLowerCase());
            if (isTeamEvent) {
                return allRecords.some(
                    (r) =>
                        r.event === currentEventTab &&
                        r.participantId &&
                        r.classification === classification &&
                        teams.some(
                            (t) =>
                                t.id === r.participantId && t.largest_age >= bracket.min_age && t.largest_age <= bracket.max_age,
                        ),
                );
            }
            // For pure individual events, this logic won't be used to render tabs, but we keep it consistent.
            return allRecords.some(
                (r) =>
                    r.event === currentEventTab &&
                    r.classification === classification &&
                    r.participantId &&
                    ageMap[r.participantId] >= bracket.min_age &&
                    ageMap[r.participantId] <= bracket.max_age,
            );
        });

        setAvailableClassifications(classificationsWithData);
        if (classificationsWithData.length > 0 && !classificationsWithData.includes(currentClassificationTab)) {
            setCurrentClassificationTab(classificationsWithData[0]);
        }
    }, [
        currentEventTab,
        currentBracketTab,
        allRecords,
        overallResults,
        teams,
        ageMap,
        currentEvent,
        isOverallEvent,
        currentClassificationTab,
    ]);

    const handleEndCompetition = async () => {
        if (!tournamentId || !user) return;

        Modal.confirm({
            title: "Confirm End of Competition",
            content: "Are you sure you want to mark this tournament as ended? This action cannot be undone.",
            onOk: async () => {
                setLoading(true);
                try {
                    await updateTournamentStatus(user, tournamentId, "End");
                    Message.success("Tournament status updated to End.");
                    const t = await fetchTournamentById(tournamentId);
                    if (t) {
                        if (t.events) {
                            const individualEvents = ["3-3-3", "3-6-3", "Cycle"];
                            const hasAllIndividualEvents = individualEvents.every((eventCode) =>
                                t.events?.some((e) => e.code === eventCode),
                            );

                            if (hasAllIndividualEvents) {
                                const threeEvent = t.events.find((e) => e.code === "3-3-3");
                                if (threeEvent && !t.events.some((e) => e.code === "Overall")) {
                                    t.events.unshift({
                                        ...threeEvent,
                                        code: "Overall",
                                        type: "Individual",
                                    });
                                }
                            }
                        }
                        setTournament(t);
                    }
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
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
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
                <Tabs type="line" className="w-full" activeTab={currentEventTab} onChange={setCurrentEventTab}>
                    {tournament?.events?.map((event) => {
                        const eventKey = `${event.code}-${event.type}`;
                        return (
                            <TabPane key={eventKey} title={`${event.code} (${event.type})`}>
                                {event.age_brackets && event.age_brackets.length > 0 ? (
                                    <Tabs
                                        type="capsule"
                                        className="w-full"
                                        activeTab={currentBracketTab}
                                        onChange={setCurrentBracketTab}
                                    >
                                        {event.age_brackets.map((bracket) => (
                                            <TabPane key={bracket.name} title={bracket.name}>
                                                {isPureIndividualEvent ? (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={individualColumns}
                                                        data={currentResults}
                                                        pagination={false}
                                                        loading={loading}
                                                    />
                                                ) : availableClassifications.length > 0 ? (
                                                    <Tabs
                                                        type="rounded"
                                                        activeTab={currentClassificationTab}
                                                        onChange={setCurrentClassificationTab}
                                                    >
                                                        {availableClassifications.map((classification) => (
                                                            <TabPane key={classification} title={classification}>
                                                                <Table
                                                                    style={{width: "100%"}}
                                                                    columns={isOverallEvent ? columns : individualColumns}
                                                                    data={currentResults}
                                                                    pagination={false}
                                                                    loading={loading}
                                                                />
                                                            </TabPane>
                                                        ))}
                                                    </Tabs>
                                                ) : isOverallEvent ? (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={columns}
                                                        data={[]}
                                                        pagination={false}
                                                        loading={loading}
                                                    />
                                                ) : isTeamEvent ? (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={individualColumns}
                                                        data={[]}
                                                        pagination={false}
                                                        loading={loading}
                                                    />
                                                ) : null}
                                            </TabPane>
                                        ))}
                                    </Tabs>
                                ) : (
                                    <Table
                                        style={{width: "100%"}}
                                        columns={isOverallEvent ? columns : individualColumns}
                                        data={currentResults}
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
