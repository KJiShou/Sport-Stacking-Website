import type {AgeBracket, Registration, Team, TeamMember, Tournament, TournamentEvent} from "@/schema";
import type {TournamentTeamRecord} from "@/schema/RecordSchema";
import {
    getTournamentFinalRecords,
    getTournamentPrelimRecords,
    saveRecord,
    saveTeamRecord,
} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import type {PrelimResultData} from "@/utils/PDF/pdfExport";
import {Button, InputNumber, Message, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconUndo} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useMemo, useState} from "react";
import {useLocation, useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;

interface Score {
    try1: string;
    try2: string;
    try3: string;
}

interface ParticipantScore extends Registration {
    scores: Record<string, Score>;
}

interface TeamScore extends Team {
    scores: Record<string, Score>;
}

interface Finalist {
    event: TournamentEvent;
    bracket: AgeBracket;
    records: (PrelimResultData & {team?: Team; registration?: Registration})[];
    classification: "beginner" | "intermediate" | "advance";
}

const BracketContent: React.FC<{
    isTeamEvent: boolean;
    bracketFinalist: Finalist;
    teamScores: TeamScore[];
    participantScores: ParticipantScore[];
    getTeamColumns: (eventKey: string) => TableColumnProps<TeamScore>[];
    getIndividualColumns: (eventKey: string) => TableColumnProps<ParticipantScore>[];
    eventKey: string;
    loading: boolean;
    currentClassification: string;
}> = ({
    isTeamEvent,
    bracketFinalist,
    teamScores,
    participantScores,
    getTeamColumns,
    getIndividualColumns,
    eventKey,
    loading,
    currentClassification,
}) => {
    const filteredTeamScores = useMemo(
        () =>
            teamScores.filter(
                (t) =>
                    bracketFinalist.classification === currentClassification &&
                    bracketFinalist.records.some((rec) => rec.team?.id === t.id),
            ),
        [teamScores, bracketFinalist, currentClassification],
    );

    const filteredParticipantScores = useMemo(
        () =>
            participantScores.filter(
                (p) =>
                    bracketFinalist.classification === currentClassification &&
                    bracketFinalist.records.some((rec) => rec.registration?.user_id === p.user_id),
            ),
        [participantScores, bracketFinalist, currentClassification],
    );

    return isTeamEvent ? (
        <Table
            style={{width: "100%"}}
            columns={getTeamColumns(eventKey)}
            data={filteredTeamScores}
            pagination={false}
            loading={loading}
            rowKey="id"
        />
    ) : (
        <Table
            style={{width: "100%"}}
            columns={getIndividualColumns(eventKey)}
            data={filteredParticipantScores}
            pagination={false}
            loading={loading}
            rowKey="user_id"
        />
    );
};

export default function FinalScoringPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const location = useLocation();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [finalists, setFinalists] = useState<Finalist[]>([]);
    const [participantScores, setParticipantScores] = useState<ParticipantScore[]>([]);
    const [teamScores, setTeamScores] = useState<TeamScore[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("");
    const [eventKeyMap, setEventKeyMap] = useState<Map<string, {code: string; type: string}>>(new Map());

    useEffect(() => {
        const fetchAndProcessData = async () => {
            if (!tournamentId) return;

            setLoading(true);
            try {
                let finalistData: Finalist[];
                let tournamentData: Tournament;
                let registrations: Registration[];
                let teams: Team[];

                if (location.state) {
                    // Use state if available
                    ({finalists: finalistData, tournament: tournamentData, registrations, teams} = location.state);
                } else {
                    // Fallback: fetch all required data
                    const [fetchedTournament, fetchedRegistrations, fetchedTeams, prelimRecords] = await Promise.all([
                        fetchTournamentById(tournamentId),
                        fetchRegistrations(tournamentId),
                        fetchTeamsByTournament(tournamentId),
                        getTournamentPrelimRecords(tournamentId),
                    ]);

                    if (!fetchedTournament) {
                        Message.error("Tournament not found");
                        return;
                    }

                    tournamentData = fetchedTournament;
                    registrations = fetchedRegistrations;
                    teams = fetchedTeams;

                    // Create name and age maps
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

                    // Recreate finalists from prelim data using the same logic as PrelimResultsPage
                    finalistData = [];

                    for (const event of tournamentData.events ?? []) {
                        // Skip "Overall" event for finals calculation
                        if (event.code === "Overall") continue;

                        for (const bracket of event.age_brackets ?? []) {
                            const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                            const eventKey = `${event.code}-${event.type}`;

                            let records: (PrelimResultData & {team?: Team; registration?: Registration})[];

                            if (isTeamEvent) {
                                records = prelimRecords
                                    .filter((r) => r.event === eventKey && (r as TournamentTeamRecord).leaderId)
                                    .filter((r) => {
                                        const teamId = r.participantId;
                                        const team = teams.find((t) => t.id === teamId);
                                        return team && team.largest_age >= bracket.min_age && team.largest_age <= bracket.max_age;
                                    })
                                    .sort((a, b) => a.bestTime - b.bestTime)
                                    .map((record, index) => {
                                        const teamId = record.participantId;
                                        const team = teams.find((t) => t.id === teamId);
                                        return {
                                            ...record,
                                            rank: index + 1,
                                            name: teamNameMap[teamId as string] || "N/A",
                                            id: team?.id || teamId || "unknown",
                                            teamId: teamId,
                                            team: teams.find((t) => t.id === teamId),
                                        };
                                    });
                            } else {
                                records = prelimRecords
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
                                        registration: registrations.find((reg) => reg.user_id === record.participantId),
                                    }));
                            }

                            const finalCriteria = bracket.final_criteria || [];
                            let processedCount = 0;
                            for (const criterion of finalCriteria) {
                                const {classification, number} = criterion;
                                const bracketFinalists = records.slice(processedCount, processedCount + number);

                                if (bracketFinalists.length > 0) {
                                    finalistData.push({
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
                }

                setTournament(tournamentData);
                setFinalists(finalistData);

                const finalRecords = await getTournamentFinalRecords(tournamentId);

                const participantScoresMap: Record<string, ParticipantScore> = {};
                const teamScoresMap: Record<string, TeamScore> = {};
                const newEventKeyMap = new Map<string, {code: string; type: string}>();

                finalistData.forEach((finalist: Finalist) => {
                    const eventKey = `${finalist.event.code.toLowerCase()}-${finalist.event.type.toLowerCase()}`;
                    if (!newEventKeyMap.has(eventKey)) {
                        newEventKeyMap.set(eventKey, {code: finalist.event.code, type: finalist.event.type});
                    }
                    const isTeamEvent = ["double", "team relay", "parent & child"].includes(finalist.event.type.toLowerCase());

                    finalist.records.forEach((record) => {
                        if (isTeamEvent && record.team) {
                            const teamId = record.team.id;
                            if (!teamScoresMap[teamId]) {
                                teamScoresMap[teamId] = {...record.team, scores: {}};
                            }
                            const finalRecord = finalRecords.find(
                                (r) => r.participantId === teamId && r.event.toLowerCase() === eventKey,
                            ) as TournamentTeamRecord | undefined;
                            teamScoresMap[teamId].scores[eventKey] = {
                                try1: finalRecord?.try1?.toString() || "",
                                try2: finalRecord?.try2?.toString() || "",
                                try3: finalRecord?.try3?.toString() || "",
                            };
                        } else if (!isTeamEvent && record.registration) {
                            const userId = record.registration.user_id;
                            if (!participantScoresMap[userId]) {
                                participantScoresMap[userId] = {...record.registration, scores: {}};
                            }
                            const finalRecord = finalRecords.find(
                                (r) => r.participantId === userId && r.event.toLowerCase() === eventKey,
                            );
                            participantScoresMap[userId].scores[eventKey] = {
                                try1: finalRecord?.try1?.toString() || "",
                                try2: finalRecord?.try2?.toString() || "",
                                try3: finalRecord?.try3?.toString() || "",
                            };
                        }
                    });
                });

                setParticipantScores(Object.values(participantScoresMap));
                setTeamScores(Object.values(teamScoresMap));
                setEventKeyMap(newEventKeyMap);

                if (finalistData[0]) {
                    const firstFinalist = finalistData[0];
                    const firstEventKey = `${firstFinalist.event.code.toLowerCase()}-${firstFinalist.event.type.toLowerCase()}`;
                    setCurrentEventTab(firstEventKey);
                    setCurrentBracketTab(firstFinalist.bracket.name);
                    if (firstFinalist.classification) {
                        setCurrentClassificationTab(firstFinalist.classification);
                    }
                }
            } catch (error) {
                console.error("Error fetching final scoring data:", error);
                Message.error("Failed to load final scoring data");
            } finally {
                setLoading(false);
            }
        };

        fetchAndProcessData();
    }, [location.state, tournamentId]);

    const handleScoreChange = (userId: string, eventKey: string, tryNum: keyof Score, value: string) => {
        setParticipantScores((prev) =>
            prev.map((p) => {
                if (p.user_id === userId) {
                    const updatedScores = {
                        ...p.scores,
                        [eventKey]: {
                            ...p.scores[eventKey],
                            [tryNum]: value,
                        },
                    };
                    return {...p, scores: updatedScores};
                }
                return p;
            }),
        );
    };

    const handleClearScores = (userId: string, eventKey: string) => {
        setParticipantScores((prev) =>
            prev.map((p) => {
                if (p.user_id === userId) {
                    const updatedScores = {
                        ...p.scores,
                        [eventKey]: {try1: "", try2: "", try3: ""},
                    };
                    return {...p, scores: updatedScores};
                }
                return p;
            }),
        );
    };

    const handleTeamScoreChange = (teamId: string, eventKey: string, tryNum: keyof Score, value: string) => {
        setTeamScores((prev) =>
            prev.map((t) => {
                if (t.id === teamId) {
                    const updatedScores = {
                        ...t.scores,
                        [eventKey]: {
                            ...t.scores[eventKey],
                            [tryNum]: value,
                        },
                    };
                    return {...t, scores: updatedScores};
                }
                return t;
            }),
        );
    };

    const handleClearTeamScores = (teamId: string, eventKey: string) => {
        setTeamScores((prev) =>
            prev.map((t) => {
                if (t.id === teamId) {
                    const updatedScores = {
                        ...t.scores,
                        [eventKey]: {try1: "", try2: "", try3: ""},
                    };
                    return {...t, scores: updatedScores};
                }
                return t;
            }),
        );
    };

    const getBestTime = (scores: Score) => {
        const times = [scores.try1, scores.try2, scores.try3]
            .map((s) => Number.parseFloat(s))
            .filter((t) => !Number.isNaN(t) && t > 0);
        return times.length > 0 ? Math.min(...times).toFixed(3) : "N/A";
    };

    const handleSaveAllScores = async () => {
        if (!tournamentId) return;
        setLoading(true);

        const capitalizeWords = (str: string): string => {
            return str
                .split(" ")
                .map((word) => {
                    if (word.toLowerCase() === "&") return word;
                    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                })
                .join(" ");
        };

        type ScoreToSave = {
            type: "individual" | "team";
            eventKey: string;
            bracketName: string;
            bestTime: number;
            scores: Score;
            classification?: "beginner" | "intermediate" | "advance";
            participant?: ParticipantScore;
            team?: TeamScore;
        };

        try {
            const allScoresToSave: ScoreToSave[] = [];

            participantScores.forEach((p) => {
                Object.entries(p.scores).forEach(([eventKey, eventScores]) => {
                    if (eventScores?.try1 || eventScores?.try2 || eventScores?.try3) {
                        const bestTime = getBestTime(eventScores);
                        if (bestTime !== "N/A") {
                            const finalistEntry = finalists.find(
                                (f) =>
                                    f.records.some((r) => r.registration?.user_id === p.user_id) &&
                                    `${f.event.code.toLowerCase()}-${f.event.type.toLowerCase()}` === eventKey,
                            );
                            if (finalistEntry) {
                                allScoresToSave.push({
                                    type: "individual",
                                    eventKey,
                                    bracketName: finalistEntry.bracket.name,
                                    participant: p,
                                    scores: eventScores,
                                    bestTime: Number(bestTime),
                                    classification: finalistEntry.classification,
                                });
                            }
                        }
                    }
                });
            });

            teamScores.forEach((t) => {
                Object.entries(t.scores).forEach(([eventKey, teamScoresData]) => {
                    if (teamScoresData?.try1 || teamScoresData?.try2 || teamScoresData?.try3) {
                        const bestTime = getBestTime(teamScoresData);
                        if (bestTime !== "N/A") {
                            const finalistEntry = finalists.find(
                                (f) =>
                                    f.records.some((r) => r.team?.id === t.id) &&
                                    `${f.event.code.toLowerCase()}-${f.event.type.toLowerCase()}` === eventKey,
                            );
                            if (finalistEntry) {
                                allScoresToSave.push({
                                    type: "team",
                                    eventKey,
                                    bracketName: finalistEntry.bracket.name,
                                    team: t,
                                    scores: teamScoresData,
                                    bestTime: Number(bestTime),
                                    classification: finalistEntry.classification,
                                });
                            }
                        }
                    }
                });
            });

            const promises = allScoresToSave.map((item) => {
                const originalEvent = eventKeyMap.get(item.eventKey);
                const correctlyCasedEvent = originalEvent
                    ? `${originalEvent.code}-${capitalizeWords(originalEvent.type)}`
                    : item.eventKey;

                if (item.type === "individual" && item.participant) {
                    return saveRecord({
                        tournamentId,
                        event: correctlyCasedEvent,
                        participantId: item.participant.user_id,
                        participantName: item.participant.user_name,
                        participantAge: item.participant.age,
                        country: item.participant.country || "MY", // Add missing country
                        gender: item.participant.gender || "Male", // Fallback for existing registrations without gender
                        round: "final",
                        classification: item.classification,
                        try1: Number.parseFloat(item.scores.try1) || 0,
                        try2: Number.parseFloat(item.scores.try2) || 0,
                        try3: Number.parseFloat(item.scores.try3) || 0,
                        status: "submitted",
                        submitted_at: new Date().toISOString(),
                    });
                }
                if (item.type === "team" && item.team) {
                    return saveTeamRecord({
                        tournamentId,
                        event: correctlyCasedEvent,
                        participantId: item.team.id, // Use participantId instead of teamId
                        teamName: item.team.name,
                        country: "MY", // Default country - should be obtained from team/leader data
                        leaderId: item.team.leader_id,
                        members: item.team.members,
                        round: "final",
                        classification: item.classification,
                        try1: Number.parseFloat(item.scores.try1) || 0,
                        try2: Number.parseFloat(item.scores.try2) || 0,
                        try3: Number.parseFloat(item.scores.try3) || 0,
                        status: "submitted",
                        submitted_at: new Date().toISOString(),
                    });
                }
                return null;
            });

            const validPromises = promises.filter(Boolean);

            if (validPromises.length > 0) {
                await Promise.all(validPromises);
                Message.success("All final scores saved successfully!");
            } else {
                Message.info("No scores to save.");
            }
        } catch (error) {
            console.error("Failed to save all scores:", error);
            Message.error("Failed to save all scores. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    if (!tournament || loading) {
        return (
            <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                    <div className="flex justify-center items-center h-64">
                        <div>Loading final scoring data...</div>
                    </div>
                </div>
            </div>
        );
    }

    const getIndividualColumns = (eventKey: string): TableColumnProps<ParticipantScore>[] => [
        {title: "Position", width: 80, render: (_value, _record, index) => index + 1},
        {title: "Global ID", dataIndex: "user_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {
            title: "Try 1",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try1 || "";
                return (
                    <InputNumber
                        placeholder="first try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleScoreChange(
                                record.user_id,
                                eventKey,
                                "try1",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Try 2",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try2 || "";
                return (
                    <InputNumber
                        placeholder="second try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleScoreChange(
                                record.user_id,
                                eventKey,
                                "try2",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Try 3",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try3 || "";
                return (
                    <InputNumber
                        placeholder="third try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleScoreChange(
                                record.user_id,
                                eventKey,
                                "try3",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Best Time",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventKey];
                return <span>{scores ? getBestTime(scores) : "N/A"}</span>;
            },
        },
        {
            title: "Actions",
            width: 120,
            render: (_, record) => (
                <Button type="primary" status="danger" onClick={() => handleClearScores(record.user_id, eventKey)}>
                    Clear
                </Button>
            ),
        },
    ];

    const getTeamColumns = (eventKey: string): TableColumnProps<TeamScore>[] => [
        {title: "Position", width: 80, render: (_value, _record, index) => index + 1},
        {title: "Team Name", dataIndex: "name", width: 200},
        {title: "Leader ID", dataIndex: "leader_id", width: 150},
        {
            title: "Members",
            dataIndex: "members",
            width: 200,
            render: (members: TeamMember[]) => (
                <div>
                    {members.map((m) => (
                        <div key={m.global_id}>{m.global_id}</div>
                    ))}
                </div>
            ),
        },
        {
            title: "Try 1",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try1 || "";
                return (
                    <InputNumber
                        placeholder="first try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleTeamScoreChange(
                                record.id,
                                eventKey,
                                "try1",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Try 2",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try2 || "";
                return (
                    <InputNumber
                        placeholder="second try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleTeamScoreChange(
                                record.id,
                                eventKey,
                                "try2",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Try 3",
            width: 120,
            render: (_, record) => {
                const score = record.scores[eventKey]?.try3 || "";
                return (
                    <InputNumber
                        placeholder="third try"
                        value={score === "" ? undefined : Number.parseFloat(score)}
                        onChange={(val) =>
                            handleTeamScoreChange(
                                record.id,
                                eventKey,
                                "try3",
                                val === undefined || val === null ? "" : String(val),
                            )
                        }
                    />
                );
            },
        },
        {
            title: "Best Time",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventKey];
                return <span>{scores ? getBestTime(scores) : "N/A"}</span>;
            },
        },
        {
            title: "Actions",
            width: 120,
            render: (_, record) => (
                <Button type="primary" status="danger" onClick={() => handleClearTeamScores(record.id, eventKey)}>
                    Clear
                </Button>
            ),
        },
    ];

    return (
        <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
            <Button type="outline" onClick={() => navigate(`/tournaments/${tournamentId}/record/prelim`)} className="w-fit">
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>{tournament.name} Final Score</Title>
                    <div className="flex gap-2">
                        <Button type="primary" onClick={handleSaveAllScores} loading={loading}>
                            Save All Scores
                        </Button>
                        <Button
                            type="primary"
                            status="success"
                            onClick={async () => {
                                if (!tournamentId) return;
                                setLoading(true);
                                try {
                                    const finalRecords = await getTournamentFinalRecords(tournamentId);
                                    const allFinalistsScored = finalists.every((finalist) =>
                                        finalist.records.every((record) => {
                                            const isTeam = !!record.team;
                                            const id = isTeam ? record.team?.id : record.registration?.user_id;
                                            return finalRecords.some((fr: (typeof finalRecords)[0]) =>
                                                isTeam ? fr.participantId === id : fr.participantId === id,
                                            );
                                        }),
                                    );

                                    if (allFinalistsScored) {
                                        navigate(`/tournaments/${tournamentId}/record/final`);
                                    } else {
                                        Message.warning("Not all finalists have recorded scores yet.");
                                    }
                                } catch (error) {
                                    console.error("Failed to check final records:", error);
                                    Message.error("Failed to verify final records.");
                                } finally {
                                    setLoading(false);
                                }
                            }}
                        >
                            Final Done
                        </Button>
                    </div>
                </div>
                <Tabs
                    type="line"
                    destroyOnHide
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const finalist = finalists.find(
                            (f) => `${f.event.code.toLowerCase()}-${f.event.type.toLowerCase()}` === key,
                        );
                        if (finalist) {
                            setCurrentBracketTab(finalist.bracket.name);
                            if (finalist.classification) {
                                setCurrentClassificationTab(finalist.classification);
                            }
                        }
                    }}
                >
                    {finalists
                        .filter(
                            (finalist, index, self) =>
                                index ===
                                self.findIndex(
                                    (f) =>
                                        `${f.event.code.toLowerCase()}-${f.event.type.toLowerCase()}` ===
                                        `${finalist.event.code.toLowerCase()}-${finalist.event.type.toLowerCase()}`,
                                ),
                        )
                        .map((finalist) => {
                            const eventKey = `${finalist.event.code.toLowerCase()}-${finalist.event.type.toLowerCase()}`;
                            const isTeamEvent = ["double", "team relay", "parent & child"].includes(
                                finalist.event.type.toLowerCase(),
                            );
                            const classifications = [
                                ...new Set(
                                    finalists
                                        .filter(
                                            (f) =>
                                                f.event.code.toLowerCase() === finalist.event.code.toLowerCase() &&
                                                f.event.type.toLowerCase() === finalist.event.type.toLowerCase(),
                                        )
                                        .map((f) => f.classification),
                                ),
                            ];

                            return (
                                <TabPane key={eventKey} title={`${finalist.event.code} (${finalist.event.type})`}>
                                    <Tabs
                                        type="capsule"
                                        tabPosition="top"
                                        destroyOnHide
                                        activeTab={currentBracketTab}
                                        onChange={(key) => setCurrentBracketTab(key)}
                                    >
                                        {[
                                            ...new Map(
                                                finalists
                                                    .filter(
                                                        (f) =>
                                                            f.event.code.toLowerCase() === finalist.event.code.toLowerCase() &&
                                                            f.event.type.toLowerCase() === finalist.event.type.toLowerCase(),
                                                    )
                                                    .map((item) => [item.bracket.name, item]),
                                            ).values(),
                                        ].map((bracketFinalist) => (
                                            <TabPane
                                                key={bracketFinalist.bracket.name}
                                                title={`${bracketFinalist.bracket.name} (${bracketFinalist.bracket.min_age}-${bracketFinalist.bracket.max_age})`}
                                            >
                                                <Tabs
                                                    type="rounded"
                                                    activeTab={currentClassificationTab}
                                                    onChange={setCurrentClassificationTab}
                                                >
                                                    {classifications.map((classification) => {
                                                        const classificationFinalist = finalists.find(
                                                            (f) =>
                                                                f.event.code.toLowerCase() ===
                                                                    finalist.event.code.toLowerCase() &&
                                                                f.event.type.toLowerCase() ===
                                                                    finalist.event.type.toLowerCase() &&
                                                                f.bracket.name === bracketFinalist.bracket.name &&
                                                                f.classification === classification,
                                                        );
                                                        if (!classificationFinalist) return null;
                                                        return (
                                                            <TabPane key={classification} title={classification}>
                                                                <BracketContent
                                                                    isTeamEvent={isTeamEvent}
                                                                    bracketFinalist={classificationFinalist}
                                                                    teamScores={teamScores}
                                                                    participantScores={participantScores}
                                                                    getTeamColumns={getTeamColumns}
                                                                    getIndividualColumns={getIndividualColumns}
                                                                    eventKey={eventKey}
                                                                    loading={loading}
                                                                    currentClassification={currentClassificationTab}
                                                                />
                                                            </TabPane>
                                                        );
                                                    })}
                                                </Tabs>
                                            </TabPane>
                                        ))}
                                    </Tabs>
                                </TabPane>
                            );
                        })}
                </Tabs>
            </div>
        </div>
    );
}
