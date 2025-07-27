import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Team, Tournament} from "@/schema";
import {getTournamentRecords, saveRecord} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {Button, InputNumber, Message, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconUndo} from "@arco-design/web-react/icon";
import React, {useState, useRef} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";

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
    scores: Score;
}

export default function ScoringPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registrationList, setRegistrationList] = useState<ParticipantScore[]>([]);
    const [teamScoreList, setTeamScoreList] = useState<TeamScore[]>([]);
    const [teamList, setTeamList] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const mountedRef = useRef(false);

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            if (t?.events?.[0]) {
                const firstEvent = t.events[0];
                setCurrentEventTab(`${firstEvent.code}-${firstEvent.type}`);
                if (firstEvent.age_brackets?.[0]) {
                    setCurrentBracketTab(firstEvent.age_brackets[0].name);
                }
            }
            const [regs, teams, records] = await Promise.all([
                fetchRegistrations(tournamentId),
                fetchTeamsByTournament(tournamentId),
                getTournamentRecords(tournamentId),
            ]);

            setTeamList(teams);
            setTeamScoreList(teams.map((team) => ({...team, scores: {try1: "", try2: "", try3: ""}})));

            const approvedRegs = regs.filter((r) => r.registration_status === "approved");

            setRegistrationList(
                approvedRegs.map((r) => {
                    const participantScores: Record<string, Score> = {};
                    for (const eventKey of r.events_registered) {
                        const record = records.find((rec) => rec.participantId === r.user_id && rec.event === eventKey);
                        participantScores[eventKey] = {
                            try1: record?.try1?.toString() || "",
                            try2: record?.try2?.toString() || "",
                            try3: record?.try3?.toString() || "",
                        };
                    }
                    return {
                        ...r,
                        scores: participantScores,
                    };
                }),
            );
        } catch (error) {
            console.error(error);
            Message.error("Unable to fetch participants");
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        refreshParticipantList();
    });

    const handleScoreChange = (userId: string, eventKey: string, tryNum: keyof Score, value: string) => {
        setRegistrationList((prev) =>
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

    const handleTeamScoreChange = (teamId: string, tryNum: keyof Score, value: string) => {
        setTeamScoreList((prev) => prev.map((t) => (t.id === teamId ? {...t, scores: {...t.scores, [tryNum]: value}} : t)));
    };

    const getBestTime = (scores: Score) => {
        const times = [scores.try1, scores.try2, scores.try3]
            .map((s) => Number.parseFloat(s))
            .filter((t) => !Number.isNaN(t) && t > 0);
        return times.length > 0 ? Math.min(...times).toFixed(3) : "N/A";
    };

    const handleSaveScores = async (eventKey: string, bracketName: string, isTeamEvent: boolean) => {
        if (!tournamentId || !tournament) return;

        setLoading(true);
        try {
            const event = tournament.events?.find((e) => `${e.code}-${e.type}` === eventKey);
            const bracket = event?.age_brackets.find((b) => b.name === bracketName);

            if (!bracket) {
                Message.error("Invalid event or bracket.");
                setLoading(false);
                return;
            }

            if (isTeamEvent) {
                const teamsToSave = teamScoreList.filter(
                    (t) => t.events.includes(eventKey) && t.largest_age >= bracket.min_age && t.largest_age <= bracket.max_age,
                );

                // Team saving logic to be implemented
                console.log("Saving scores for teams:", teamsToSave);
                Message.info("Team score saving is not yet implemented.");
            } else {
                const participantsToSave = registrationList.filter(
                    (r) => r.events_registered.includes(eventKey) && r.age >= bracket.min_age && r.age <= bracket.max_age,
                );

                const promises = participantsToSave
                    .map((p) => {
                        const eventScores = p.scores[eventKey];
                        if (eventScores?.try1 && eventScores.try2 && eventScores.try3) {
                            return saveRecord({
                                tournamentId,
                                event: eventKey,
                                participantId: p.user_id,
                                participantName: p.user_name,
                                participantAge: p.age,
                                round: "prelim",
                                try1: Number.parseFloat(eventScores.try1),
                                try2: Number.parseFloat(eventScores.try2),
                                try3: Number.parseFloat(eventScores.try3),
                                status: "submitted",
                                submitted_at: new Date().toISOString(),
                            });
                        }
                        return null;
                    })
                    .filter(Boolean);

                if (promises.length > 0) {
                    await Promise.all(promises);
                    Message.success(`Scores for ${eventKey} - ${bracketName} saved successfully!`);
                } else {
                    Message.info("No scores to save.");
                }
            }
        } catch (error) {
            console.error("Failed to save scores:", error);
            Message.error("Failed to save scores. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    if (!tournament) return null;

    const getIndividualColumns = (eventKey: string): TableColumnProps<ParticipantScore>[] => [
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
    ];

    const teamColumns: TableColumnProps<TeamScore>[] = [
        {title: "Team Name", dataIndex: "name", width: 200},
        {title: "Leader ID", dataIndex: "leader_id", width: 150},
        {
            title: "Try 1",
            width: 120,
            render: (_, record) => (
                <InputNumber
                    placeholder="first try"
                    value={record.scores.try1 === "" ? undefined : Number.parseFloat(record.scores.try1)}
                    onChange={(val) =>
                        handleTeamScoreChange(record.id, "try1", val === undefined || val === null ? "" : String(val))
                    }
                />
            ),
        },
        {
            title: "Try 2",
            width: 120,
            render: (_, record) => (
                <InputNumber
                    placeholder="second try"
                    value={record.scores.try2 === "" ? undefined : Number.parseFloat(record.scores.try2)}
                    onChange={(val) =>
                        handleTeamScoreChange(record.id, "try2", val === undefined || val === null ? "" : String(val))
                    }
                />
            ),
        },
        {
            title: "Try 3",
            width: 120,
            render: (_, record) => (
                <InputNumber
                    placeholder="third try"
                    value={record.scores.try3 === "" ? undefined : Number.parseFloat(record.scores.try3)}
                    onChange={(val) =>
                        handleTeamScoreChange(record.id, "try3", val === undefined || val === null ? "" : String(val))
                    }
                />
            ),
        },
        {
            title: "Best Time",
            width: 120,
            render: (_, record) => <span>{getBestTime(record.scores)}</span>,
        },
    ];

    return (
        <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
            <Button type="outline" onClick={() => navigate(-1)} className="w-fit">
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                <Title heading={3}>{tournament.name} Prelim Score</Title>
                <Tabs
                    type="line"
                    destroyOnHide
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const event = tournament.events?.find((e) => `${e.code}-${e.type}` === key);
                        if (event?.age_brackets?.[0]) {
                            setCurrentBracketTab(event.age_brackets[0].name);
                        }
                    }}
                >
                    {tournament.events?.map((evt) => {
                        const evtKey = `${evt.code}-${evt.type}`;
                        const isTeamEvent = ["double", "team relay", "parent & child"].includes(evt.type.toLowerCase());
                        return (
                            <TabPane key={evtKey} title={`${evt.code} (${evt.type})`}>
                                <Tabs
                                    type="capsule"
                                    tabPosition="top"
                                    destroyOnHide
                                    activeTab={currentBracketTab}
                                    onChange={(key) => setCurrentBracketTab(key)}
                                >
                                    {evt.age_brackets.map((br) => (
                                        <TabPane key={br.name} title={`${br.name} (${br.min_age}-${br.max_age})`}>
                                            {isTeamEvent ? (
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={teamColumns}
                                                    data={teamScoreList.filter(
                                                        (t) =>
                                                            t.events.includes(evtKey) &&
                                                            t.largest_age >= br.min_age &&
                                                            t.largest_age <= br.max_age,
                                                    )}
                                                    pagination={false}
                                                    loading={loading}
                                                    rowKey="id"
                                                />
                                            ) : (
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={getIndividualColumns(evtKey)}
                                                    data={registrationList.filter(
                                                        (r) =>
                                                            r.events_registered.includes(evtKey) &&
                                                            r.age >= br.min_age &&
                                                            r.age <= br.max_age,
                                                    )}
                                                    pagination={false}
                                                    loading={loading}
                                                    rowKey="user_id"
                                                />
                                            )}
                                            <div className="flex justify-end mt-4">
                                                <Button
                                                    type="primary"
                                                    onClick={() => handleSaveScores(evtKey, br.name, isTeamEvent)}
                                                >
                                                    Save Scores
                                                </Button>
                                            </div>
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
