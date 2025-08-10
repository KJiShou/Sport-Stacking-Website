import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Team, TeamMember, Tournament} from "@/schema";
import {getRecords, getTournamentRecords, saveRecord, saveTeamRecord} from "@/services/firebase/recordService";
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
    scores: Record<string, Score>;
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
            setTeamScoreList(
                teams.map((team) => {
                    const teamScores: Record<string, Score> = {};
                    for (const eventKey of team.events) {
                        const record = records.find((rec) => "teamId" in rec && rec.teamId === team.id && rec.event === eventKey);
                        teamScores[eventKey] = {
                            try1: record?.try1?.toString() || "",
                            try2: record?.try2?.toString() || "",
                            try3: record?.try3?.toString() || "",
                        };
                    }
                    return {
                        ...team,
                        scores: teamScores,
                    };
                }),
            );

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

    const handleTeamScoreChange = (teamId: string, eventKey: string, tryNum: keyof Score, value: string) => {
        setTeamScoreList((prev) =>
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

    const getBestTime = (scores: Score) => {
        const times = [scores.try1, scores.try2, scores.try3]
            .map((s) => Number.parseFloat(s))
            .filter((t) => !Number.isNaN(t) && t > 0);
        return times.length > 0 ? Math.min(...times).toFixed(3) : "N/A";
    };

    const handleSaveAllScores = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const individualPromises = registrationList
                .flatMap((p) =>
                    Object.entries(p.scores).map(([eventKey, eventScores]) => {
                        if (eventScores?.try1 && eventScores.try2 && eventScores.try3) {
                            return saveRecord({
                                tournamentId,
                                event: eventKey,
                                participantId: p.user_id,
                                participantName: p.user_name,
                                participantAge: p.age,
                                round: "prelim",
                                classification: "beginner",
                                try1: Number.parseFloat(eventScores.try1),
                                try2: Number.parseFloat(eventScores.try2),
                                try3: Number.parseFloat(eventScores.try3),
                                status: "submitted",
                                submitted_at: new Date().toISOString(),
                            });
                        }
                        return null;
                    }),
                )
                .filter(Boolean);

            const teamPromises = teamScoreList
                .flatMap((t) =>
                    Object.entries(t.scores).map(([eventKey, teamScores]) => {
                        if (teamScores?.try1 && teamScores.try2 && teamScores.try3) {
                            return saveTeamRecord({
                                tournamentId,
                                event: eventKey,
                                teamId: t.id,
                                teamName: t.name,
                                leaderId: t.leader_id,
                                members: t.members,
                                round: "prelim",
                                classification: "beginner",
                                try1: Number.parseFloat(teamScores.try1),
                                try2: Number.parseFloat(teamScores.try2),
                                try3: Number.parseFloat(teamScores.try3),
                                status: "submitted",
                                submitted_at: new Date().toISOString(),
                            });
                        }
                        return null;
                    }),
                )
                .filter(Boolean);

            const allPromises = [...individualPromises, ...teamPromises];

            if (allPromises.length > 0) {
                await Promise.all(allPromises);
                Message.success("All scores saved successfully!");
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
                const teamsToSave = teamScoreList.filter((t) => t.events.includes(eventKey));

                const promises = teamsToSave
                    .map((t) => {
                        const teamScores = t.scores[eventKey];
                        if (teamScores?.try1 && teamScores.try2 && teamScores.try3) {
                            return saveTeamRecord({
                                tournamentId,
                                event: eventKey,
                                teamId: t.id,
                                teamName: t.name,
                                leaderId: t.leader_id,
                                members: t.members,
                                round: "prelim",
                                classification: "beginner",
                                try1: Number.parseFloat(teamScores.try1),
                                try2: Number.parseFloat(teamScores.try2),
                                try3: Number.parseFloat(teamScores.try3),
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
            } else {
                const participantsToSave = registrationList.filter((r) => r.events_registered.includes(eventKey));

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
                                classification: "beginner",
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

    const getTeamColumns = (eventKey: string): TableColumnProps<TeamScore>[] => [
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
    ];

    return (
        <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
            <Button type="outline" onClick={() => navigate("/tournaments")} className="w-fit">
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>{tournament.name} Prelim Score</Title>
                    <Button type="primary" onClick={handleSaveAllScores} loading={loading}>
                        Save All Scores
                    </Button>
                </div>
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
                                                    columns={getTeamColumns(evtKey)}
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
                                                    Save Event Scores
                                                </Button>
                                                <Button
                                                    type="primary"
                                                    status="success"
                                                    loading={loading}
                                                    onClick={async () => {
                                                        if (!tournamentId || !evtKey) return;
                                                        setLoading(true);
                                                        try {
                                                            const eventRecords = await getRecords(tournamentId, evtKey);
                                                            const prelimRecords = eventRecords.filter(
                                                                (r) => r.round === "prelim",
                                                            );

                                                            const participantsForBracket = registrationList.filter(
                                                                (r) =>
                                                                    r.events_registered.includes(evtKey) &&
                                                                    r.age >= br.min_age &&
                                                                    r.age <= br.max_age,
                                                            );
                                                            const teamsForBracket = teamScoreList.filter(
                                                                (t) =>
                                                                    t.events.includes(evtKey) &&
                                                                    t.largest_age >= br.min_age &&
                                                                    t.largest_age <= br.max_age,
                                                            );

                                                            const allRecorded = isTeamEvent
                                                                ? teamsForBracket.every((t) =>
                                                                      prelimRecords.some((r) => r.teamId === t.id),
                                                                  )
                                                                : participantsForBracket.every((p) =>
                                                                      prelimRecords.some((r) => r.participantId === p.user_id),
                                                                  );

                                                            if (allRecorded) {
                                                                navigate(`/tournaments/${tournamentId}/record/prelim`);
                                                            } else {
                                                                Message.warning(
                                                                    "Not all participants have preliminary records yet.",
                                                                );
                                                            }
                                                        } catch (error) {
                                                            Message.error("Failed to check records.");
                                                        } finally {
                                                            setLoading(false);
                                                        }
                                                    }}
                                                    style={{marginLeft: 8}}
                                                >
                                                    Prelim Done
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
