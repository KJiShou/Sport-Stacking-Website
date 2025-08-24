import type {AgeBracket, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "../../../schema/RecordSchema";
import {getTournamentPrelimRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {
    type BracketResults,
    type EventResults,
    type PrelimResultData,
    exportAllPrelimResultsToPDF,
    exportFinalistsNameListToPDF,
} from "@/utils/PDF/pdfExport";
import {Button, Message, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconCaretRight, IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;

type PrelimResult = PrelimResultData;

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

                const records = await getTournamentPrelimRecords(tournamentId);
                setAllRecords(records);

                const regs = await fetchRegistrations(tournamentId);
                setRegistrations(regs);

                const teamData = await fetchTeamsByTournament(tournamentId);
                setTeams(teamData);
            } catch (error) {
                Message.error("Failed to fetch preliminary results.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tournamentId]);

    const nameMap = registrations.reduce(
        (acc, r) => {
            acc[r.user_id] = r.user_name;
            return acc;
        },
        {} as Record<string, string>,
    );

    const ageMap = registrations.reduce(
        (acc, r) => {
            acc[r.user_id] = r.age;
            return acc;
        },
        {} as Record<string, number>,
    );

    const teamNameMap = teams.reduce(
        (acc, t) => {
            acc[t.id] = t.name;
            return acc;
        },
        {} as Record<string, string>,
    );

    const overallResults = useMemo<PrelimResult[]>(() => {
        if (!allRecords.length || !registrations.length) return [];

        const rows = registrations
            .map((reg) => {
                // More flexible matching - check if event name contains the event code
                const threeRecord = allRecords.find(
                    (r) =>
                        r.participantId === reg.user_id &&
                        (r.event?.toLowerCase().includes("3-3-3") || r.event?.toLowerCase().includes("3x3x3")),
                );
                const threeSixThreeRecord = allRecords.find(
                    (r) =>
                        r.participantId === reg.user_id &&
                        (r.event?.toLowerCase().includes("3-6-3") || r.event?.toLowerCase().includes("3x6x3")),
                );
                const cycleRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("cycle"),
                );

                // Debug logging for each participant

                // Check if all three records exist and have valid times
                if (!threeRecord || !threeSixThreeRecord || !cycleRecord) {
                    return null;
                }

                // More robust time validation
                const threeTime =
                    typeof threeRecord.bestTime === "number"
                        ? threeRecord.bestTime
                        : typeof threeRecord.bestTime === "string"
                          ? Number.parseFloat(threeRecord.bestTime)
                          : null;
                const threeSixThreeTime =
                    typeof threeSixThreeRecord.bestTime === "number"
                        ? threeSixThreeRecord.bestTime
                        : typeof threeSixThreeRecord.bestTime === "string"
                          ? Number.parseFloat(threeSixThreeRecord.bestTime)
                          : null;
                const cycleTime =
                    typeof cycleRecord.bestTime === "number"
                        ? cycleRecord.bestTime
                        : typeof cycleRecord.bestTime === "string"
                          ? Number.parseFloat(cycleRecord.bestTime)
                          : null;

                if (
                    threeTime === null ||
                    threeSixThreeTime === null ||
                    cycleTime === null ||
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

                const result: PrelimResult = {
                    ...threeRecord, // Use one of the records as base
                    id: reg.user_id,
                    name: reg.user_name,
                    three: threeTime,
                    threeSixThree: threeSixThreeTime,
                    cycle: cycleTime,
                    bestTime: sum,
                    rank: 0,
                    event: "Overall",
                };
                return result;
            })
            .filter((r): r is PrelimResult => r !== null);

        // Sort by total time (bestTime)
        rows.sort((a, b) => a.bestTime - b.bestTime);

        // Assign ranks
        rows.forEach((r, i) => {
            r.rank = i + 1;
        });

        return rows;
    }, [allRecords, registrations]);

    const handlePrint = async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const resultsData: EventResults[] = (tournament.events ?? []).map((event) => {
                const brackets: BracketResults[] = (event.age_brackets ?? []).map((bracket) => {
                    const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                    const eventKey = `${event.code}-${event.type}`;

                    let records: PrelimResult[];

                    if (event.code === "Overall") {
                        records = overallResults
                            .filter((r) => {
                                if (!r.participantId) return false;
                                const age = ageMap[r.participantId];
                                return age >= bracket.min_age && age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime);
                        records.forEach((r, i) => (r.rank = i + 1));
                    } else if (isTeamEvent) {
                        records = allRecords
                            .filter((r) => r.event === eventKey && (r as TournamentTeamRecord).leaderId)
                            .filter((r) => {
                                const teamId = r.participantId; // participantId is used as teamId for team records
                                const team = teams.find((t) => t.id === teamId);
                                return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => {
                                const teamId = record.participantId; // participantId is used as teamId
                                const team = teams.find((t) => t.id === teamId);
                                return {
                                    ...record,
                                    rank: index + 1,
                                    name: teamNameMap[teamId as string] || "N/A",
                                    id: team?.leader_id || teamId || "unknown",
                                    teamId: teamId, // Add explicit teamId for consistency
                                };
                            });
                    } else {
                        records = allRecords
                            .filter((r) => {
                                const age = ageMap[r.participantId as string];
                                return r.event === eventKey && age >= bracket.min_age && age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => ({
                                ...record,
                                rank: index + 1,
                                name: nameMap[record.participantId as string] || "N/A",
                                id: record.participantId as string,
                            }));
                    }

                    return {bracket, records};
                });
                return {event, brackets};
            });

            await exportAllPrelimResultsToPDF({
                tournament,
                resultsData,
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            Message.error("Failed to generate PDF");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const handlePrintFinalists = async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const finalistsData: EventResults[] = [];

            for (const event of tournament.events ?? []) {
                if (event.code === "Overall") continue;

                const eventBrackets: BracketResults[] = [];

                for (const bracket of event.age_brackets ?? []) {
                    const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                    const eventKey = `${event.code}-${event.type}`;

                    let records: PrelimResult[];

                    if (isTeamEvent) {
                        records = allRecords
                            .filter((r) => r.event === eventKey && (r as TournamentTeamRecord).leaderId)
                            .filter((r) => {
                                const teamId = r.participantId; // participantId is used as teamId for team records
                                const team = teams.find((t) => t.id === teamId);
                                return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => {
                                const teamId = record.participantId; // participantId is used as teamId
                                const team = teams.find((t) => t.id === teamId);
                                return {
                                    ...record,
                                    rank: index + 1,
                                    name: teamNameMap[teamId as string] || "N/A",
                                    id: team?.id || teamId || "unknown",
                                    teamId: teamId, // Add explicit teamId for consistency
                                };
                            });
                    } else {
                        records = allRecords
                            .filter((r) => {
                                const age = ageMap[r.participantId as string];
                                return r.event === eventKey && age >= bracket.min_age && age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => ({
                                ...record,
                                rank: index + 1,
                                name: nameMap[record.participantId as string] || "N/A",
                                id: record.participantId as string,
                            }));
                    }

                    const finalCriteria = bracket.final_criteria || [];
                    let processedCount = 0;
                    for (const criterion of finalCriteria) {
                        const {classification, number} = criterion;
                        const bracketFinalists = records.slice(processedCount, processedCount + number);

                        if (bracketFinalists.length > 0) {
                            eventBrackets.push({
                                bracket,
                                records: bracketFinalists,
                                classification,
                            });
                        }
                        processedCount += number;
                    }
                }
                if (eventBrackets.length > 0) {
                    finalistsData.push({event, brackets: eventBrackets});
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
            Message.error("Failed to generate finalists PDF");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const columns: TableColumnProps<PrelimResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "3-3-3", dataIndex: "three", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "3-6-3", dataIndex: "threeSixThree", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Cycle", dataIndex: "cycle", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
    ];

    const individualColumns: TableColumnProps<PrelimResult>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
    ];

    // Helper function to get results for current event and bracket
    const getCurrentResults = () => {
        if (!tournament || !currentEventTab || !currentBracketTab) return [];

        const event = tournament.events?.find((e) => `${e.code}-${e.type}` === currentEventTab);
        if (!event) return [];

        const bracket = event.age_brackets?.find((b) => b.name === currentBracketTab);
        if (!bracket) return [];

        // Handle Overall event specially
        if (event.code === "Overall") {
            return overallResults.filter((r) => {
                if (!r.participantId) return false;
                const age = ageMap[r.participantId];
                return age >= bracket.min_age && age <= bracket.max_age;
            });
        }

        // Handle individual and team events
        const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());

        if (isTeamEvent) {
            return allRecords
                .filter((r) => r.event === currentEventTab && (r as TournamentTeamRecord).leaderId)
                .filter((r) => {
                    const teamId = r.participantId; // participantId is used as teamId for team records
                    const team = teams.find((t) => t.id === teamId);
                    return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                })
                .sort((a, b) => a.bestTime - b.bestTime)
                .map((record, index) => {
                    const teamId = record.participantId; // participantId is used as teamId
                    const team = teams.find((t) => t.id === teamId);
                    return {
                        ...record,
                        rank: index + 1,
                        name: teamNameMap[teamId as string] || "N/A",
                        id: team?.leader_id || teamId || "unknown",
                        teamId: teamId, // Add explicit teamId for consistency
                    };
                });
        }
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

    const handleStartFinal = async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const finalists: {
                event: TournamentEvent;
                bracket: AgeBracket;
                records: PrelimResult[];
                classification: "beginner" | "intermediate" | "advance";
            }[] = [];

            for (const event of tournament.events ?? []) {
                // Skip "Overall" event for finals calculation
                if (event.code === "Overall") continue;

                for (const bracket of event.age_brackets ?? []) {
                    const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                    const eventKey = `${event.code}-${event.type}`;

                    let records: PrelimResult[];

                    if (isTeamEvent) {
                        records = allRecords
                            .filter((r) => r.event === eventKey && (r as TournamentTeamRecord).leaderId)
                            .filter((r) => {
                                const teamId = r.participantId; // participantId is used as teamId for team records
                                const team = teams.find((t) => t.id === teamId);
                                return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => {
                                const teamId = record.participantId; // participantId is used as teamId
                                const team = teams.find((t) => t.id === teamId);
                                return {
                                    ...record,
                                    rank: index + 1,
                                    name: teamNameMap[teamId as string] || "N/A",
                                    id: team?.id || teamId || "unknown",
                                    teamId: teamId, // Add explicit teamId for consistency
                                    // Make sure team object is passed for final scoring
                                    team: teams.find((t) => t.id === teamId),
                                };
                            });
                    } else {
                        records = allRecords
                            .filter((r) => {
                                const age = ageMap[r.participantId as string];
                                return r.event === eventKey && age >= bracket.min_age && age <= bracket.max_age;
                            })
                            .sort((a, b) => a.bestTime - b.bestTime)
                            .map((record, index) => ({
                                ...record,
                                rank: index + 1,
                                name: nameMap[record.participantId as string] || "N/A",
                                id: record.participantId as string,
                                // Make sure registration object is passed for final scoring
                                registration: registrations.find((reg) => reg.user_id === record.participantId),
                            }));
                    }

                    const finalCriteria = bracket.final_criteria || [];
                    let processedCount = 0;
                    for (const criterion of finalCriteria) {
                        const {classification, number} = criterion;
                        const bracketFinalists = records.slice(processedCount, processedCount + number);

                        if (bracketFinalists.length > 0) {
                            finalists.push({
                                event,
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

            navigate(`/tournaments/${tournamentId}/scoring/final`, {
                state: {finalists, tournament, registrations, teams},
            });
        } catch (error) {
            Message.error("Failed to start finals.");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button
                type="outline"
                onClick={() => navigate(`/tournaments/${tournamentId}/start/record`)}
                className={`w-fit pt-2 pb-2`}
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
