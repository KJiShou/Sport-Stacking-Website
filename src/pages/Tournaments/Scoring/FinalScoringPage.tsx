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
import {Button, InputNumber, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
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
    [key: string]: string | undefined;
}

interface ParticipantScore extends Registration {
    scores: Record<string, Score>;
}

interface TeamScore extends Team {
    scores: Record<string, Score>;
}

interface Finalist {
    event: TournamentEvent;
    eventCode: string;
    eventCodes: string[];
    bracket: AgeBracket;
    records: (PrelimResultData & {team?: Team; registration?: Registration})[];
    classification: "beginner" | "intermediate" | "advance";
}

const normalizeEventKey = (code: string, type: string): string => `${code.toLowerCase()}-${type.toLowerCase()}`;

const getFinalistCodes = (finalist: Finalist): string[] => {
    const codes = finalist.eventCodes?.filter((code) => code && code !== "Overall") ?? [];
    if (codes.length > 0) return codes;
    const fallback = sanitizeEventCodes(finalist.event.codes);
    return fallback.length > 0 ? fallback : [finalist.event.type];
};

interface ClassificationGroup {
    event: TournamentEvent;
    bracket: AgeBracket;
    classification: "beginner" | "intermediate" | "advance";
    finalists: Finalist[];
}

const sanitizeEventCodes = (codes?: string[]): string[] => (codes ?? []).filter((code) => code !== "Overall");

const buildEventCodeMap = (events?: TournamentEvent[]): Map<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const event of events ?? []) {
        const rawCodes = event.codes && event.codes.length > 0 ? event.codes : (event as {code?: string}).code ? [(event as {code: string}).code] : [];
        const sanitized = sanitizeEventCodes(rawCodes);
        if (sanitized.length === 0) continue;
        const key = event.type.toLowerCase();
        const existing = map.get(key) ?? [];
        for (const code of sanitized) {
            if (!existing.includes(code)) {
                existing.push(code);
            }
        }
        map.set(key, existing);
    }
    return map;
};

const getGroupCodes = (group: ClassificationGroup): string[] => {
    const firstFinalistCodes = group.finalists[0] ? getFinalistCodes(group.finalists[0]) : [];
    if (firstFinalistCodes.length > 0) return firstFinalistCodes;
    const combined = new Set<string>();
    for (const finalist of group.finalists) {
        for (const code of getFinalistCodes(finalist)) {
            combined.add(code);
        }
    }
    if (combined.size > 0) {
        return Array.from(combined);
    }
    const fallback = sanitizeEventCodes(group.event.codes);
    return fallback.length > 0 ? fallback : [group.event.type];
};

const getEventGroupKey = (finalist: Finalist): string => {
    const codes = getFinalistCodes(finalist);
    const codesKey = codes.length > 0 ? codes.join("|") : finalist.event.type;
    return `${codesKey}-${finalist.event.type}`.toLowerCase();
};

const getEventGroupLabel = (finalist: Finalist): string => {
    const codes = getFinalistCodes(finalist);
    const codesLabel = codes.length > 0 ? codes.join(", ") : finalist.event.type;
    return `${codesLabel} (${finalist.event.type})`;
};

const BracketContent: React.FC<{
    isTeamEvent: boolean;
    group: ClassificationGroup;
    teamScores: TeamScore[];
    participantScores: ParticipantScore[];
    loading: boolean;
    currentClassification: string;
    handleClearScores: (userId: string, group: ClassificationGroup) => void;
    handleClearTeamScores: (teamId: string, group: ClassificationGroup) => void;
    openModal: (options: {participant?: ParticipantScore; team?: TeamScore; group: ClassificationGroup}) => void;
}> = ({
    isTeamEvent,
    group,
    teamScores,
    participantScores,
    loading,
    currentClassification,
    handleClearScores,
    handleClearTeamScores,
    openModal,
}) => {
    const eventCodes = getGroupCodes(group);

    const participantsInGroup = useMemo(() => {
        const ids = new Set<string>();
        for (const finalist of group.finalists) {
            for (const record of finalist.records) {
                if (record.registration?.user_id) {
                    ids.add(record.registration.user_id);
                }
            }
        }
        return ids;
    }, [group.finalists]);

    const teamsInGroup = useMemo(() => {
        const ids = new Set<string>();
        for (const finalist of group.finalists) {
            for (const record of finalist.records) {
                if (record.team?.id) {
                    ids.add(record.team.id);
                }
            }
        }
        return ids;
    }, [group.finalists]);

    const filteredTeamScores = useMemo(
        () =>
            teamScores.filter(
                (t) => group.classification === currentClassification && teamsInGroup.has(t.id),
            ),
        [teamScores, group.classification, currentClassification, teamsInGroup],
    );

    const filteredParticipantScores = useMemo(
        () =>
            participantScores.filter(
                (p) => group.classification === currentClassification && participantsInGroup.has(p.user_id),
            ),
        [participantScores, group.classification, currentClassification, participantsInGroup],
    );

    const participantColumns = useMemo(
        () =>
            [
                {title: "Position", width: 80, render: (_value: unknown, _record: ParticipantScore, index: number) => index + 1},
                {title: "Global ID", dataIndex: "user_id", width: 120},
                {title: "Name", dataIndex: "user_name", width: 160},
                {
                    title: "Event Codes",
                    width: 180,
                    render: () => eventCodes.join(", "),
                },
                {
                    title: "Status",
                    width: 140,
                    render: (_: unknown, record: ParticipantScore) => {
                        const isComplete = eventCodes.every((code) => {
                            const key = normalizeEventKey(code, group.event.type);
                            const scores = record.scores[key];
                            return Boolean(scores?.try1 && scores?.try2 && scores?.try3);
                        });
                        return (
                            <span style={{color: isComplete ? "#16a34a" : "#f97316", fontWeight: 600}}>
                                {isComplete ? "Complete" : "Incomplete"}
                            </span>
                        );
                    },
                },
                {
                    title: "Action",
                    width: 200,
                    render: (_: unknown, record: ParticipantScore) => (
                        <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}>
                            <Button
                                size="small"
                                type="primary"
                                onClick={() => openModal({participant: record, group})}
                            >
                                Edit
                            </Button>
                            <Button
                                size="small"
                                status="danger"
                                onClick={() => handleClearScores(record.user_id, group)}
                            >
                                Clear
                            </Button>
                        </div>
                    ),
                },
            ] as TableColumnProps<ParticipantScore>[],
        [eventCodes, group, handleClearScores, openModal],
    );

    const teamColumns = useMemo(() => {
        return [
            {title: "Position", width: 80, render: (_value: unknown, _record: TeamScore, index: number) => index + 1},
            {title: "Team Name", dataIndex: "name", width: 200},
            {title: "Leader ID", dataIndex: "leader_id", width: 150},
            {
                title: "Members",
                dataIndex: "members",
                width: 220,
                render: (members: TeamMember[]) => (
                    <div>
                        {members.map((member) => (
                            <div key={member.global_id}>{member.global_id}</div>
                        ))}
                    </div>
                ),
            },
            {
                title: "Event Codes",
                width: 180,
                render: () => eventCodes.join(", "),
            },
            {
                title: "Status",
                width: 140,
                render: (_: unknown, record: TeamScore) => {
                    const isComplete = eventCodes.every((code) => {
                        const key = normalizeEventKey(code, group.event.type);
                        const scores = record.scores[key];
                        return Boolean(scores?.try1 && scores?.try2 && scores?.try3);
                    });
                    return (
                        <span style={{color: isComplete ? "#16a34a" : "#f97316", fontWeight: 600}}>
                            {isComplete ? "Complete" : "Incomplete"}
                        </span>
                    );
                },
            },
            {
                title: "Action",
                width: 220,
                render: (_: unknown, record: TeamScore) => (
                    <div style={{display: "flex", gap: "8px", flexWrap: "wrap"}}>
                        <Button
                            size="small"
                            type="primary"
                            onClick={() => openModal({team: record, group})}
                        >
                            Edit
                        </Button>
                        <Button
                            size="small"
                            status="danger"
                            onClick={() => handleClearTeamScores(record.id, group)}
                        >
                            Clear
                        </Button>
                    </div>
                ),
            },
        ] as TableColumnProps<TeamScore>[];
    }, [eventCodes, group, handleClearTeamScores, openModal]);

    if (isTeamEvent) {
        return (
            <Table
                style={{width: "100%"}}
                columns={teamColumns}
                data={filteredTeamScores}
                pagination={false}
                loading={loading}
                rowKey="id"
            />
        );
    }

    return (
        <Table
            style={{width: "100%"}}
            columns={participantColumns}
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
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<ParticipantScore | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<TeamScore | null>(null);
    const [modalScores, setModalScores] = useState<Record<string, Score>>({});
    const [selectedGroup, setSelectedGroup] = useState<ClassificationGroup | null>(null);

    const buildEmptyScoreForFinalist = (): Score => ({try1: "", try2: "", try3: ""});

    const toNumberOrUndefined = (value?: string): number | undefined => {
        if (value === undefined || value === "") {
            return undefined;
        }
        const parsed = Number.parseFloat(value);
        return Number.isNaN(parsed) ? undefined : parsed;
    };

    const openModal = ({
        participant,
        team,
        group,
    }: {
        participant?: ParticipantScore;
        team?: TeamScore;
        group: ClassificationGroup;
    }) => {
        setSelectedParticipant(participant ?? null);
        setSelectedTeam(team ?? null);
        setSelectedGroup(group);

        const codes = getGroupCodes(group);
        const initialScores: Record<string, Score> = {};
        for (const code of codes) {
            const eventKey = normalizeEventKey(code, group.event.type);
            const existingScore = participant?.scores[eventKey] ?? team?.scores[eventKey];
            initialScores[eventKey] = {
                try1: existingScore?.try1 ?? "",
                try2: existingScore?.try2 ?? "",
                try3: existingScore?.try3 ?? "",
            };
        }

        setModalScores(initialScores);
        setModalVisible(true);
    };

    const closeModal = () => {
        setModalVisible(false);
        setSelectedParticipant(null);
        setSelectedTeam(null);
        setSelectedGroup(null);
        setModalScores({});
    };

    const handleModalScoreChange = (eventKey: string, field: keyof Score, value: string) => {
        setModalScores((prev) => ({
            ...prev,
            [eventKey]: {
                ...(prev[eventKey] ?? buildEmptyScoreForFinalist()),
                [field]: value,
            },
        }));
    };

    const resetModalScore = () => {
        if (!selectedGroup) return;
        const codes = getGroupCodes(selectedGroup);
        const cleared: Record<string, Score> = {};
        for (const code of codes) {
            const eventKey = normalizeEventKey(code, selectedGroup.event.type);
            cleared[eventKey] = buildEmptyScoreForFinalist();
        }
        setModalScores(cleared);
    };

    const validateModalScores = (): string[] => {
        if (!selectedGroup) return ["No event selected."];

        const errors: string[] = [];
        const codesToCheck = getGroupCodes(selectedGroup);

        for (const code of codesToCheck) {
            const eventKey = normalizeEventKey(code, selectedGroup.event.type);
            const scores = modalScores[eventKey];

            if (!scores) {
                errors.push(`Missing scores for ${code}`);
                continue;
            }

            const tries: Array<{label: string; value: string}> = [
                {label: "Try 1", value: scores.try1},
                {label: "Try 2", value: scores.try2},
                {label: "Try 3", value: scores.try3},
            ];

            const missing = tries.filter((item) => !item.value || item.value.trim() === "");
            if (missing.length > 0) {
                errors.push(`Missing values for ${code}: ${missing.map((m) => m.label).join(", ")}`);
                continue;
            }

            const invalid = tries
                .filter((item) => {
                    const parsed = Number.parseFloat(item.value);
                    return Number.isNaN(parsed) || parsed <= 0;
                })
                .map((item) => item.label);

            if (invalid.length > 0) {
                errors.push(`Invalid times for ${code}: ${invalid.join(", ")}`);
            }
        }

        return errors;
    };

    const saveModalScores = async () => {
        if (!tournamentId || !selectedGroup) {
            closeModal();
            return;
        }

        const validationErrors = validateModalScores();
        if (validationErrors.length > 0) {
            const message = `Validation Failed:\n${validationErrors.join("\n")}`;
            Message.error(message);
            return;
        }

        setLoading(true);
        try {
            const codesToProcess = getGroupCodes(selectedGroup);
            const classification = selectedGroup.classification;
            const now = new Date().toISOString();

            if (selectedParticipant) {
                const promises: Promise<void>[] = [];

                for (const code of codesToProcess) {
                    const eventKey = normalizeEventKey(code, selectedGroup.event.type);
                    const scores = modalScores[eventKey];
                    if (!scores) continue;

                    const try1 = Number.parseFloat(scores.try1);
                    const try2 = Number.parseFloat(scores.try2);
                    const try3 = Number.parseFloat(scores.try3);

                    const eventName = `${code}-${selectedGroup.event.type}`;

                    promises.push(
                        saveRecord({
                            tournamentId,
                            event: eventName,
                            participantId: selectedParticipant.user_id,
                            participantName: selectedParticipant.user_name,
                            participantAge: selectedParticipant.age,
                            country: selectedParticipant.country || "MY",
                            gender: selectedParticipant.gender || "Male",
                            round: "final",
                            classification,
                            try1,
                            try2,
                            try3,
                            status: "submitted",
                            submitted_at: now,
                        }),
                    );
                }

                await Promise.all(promises);

                setParticipantScores((prev) =>
                    prev.map((participant) => {
                        if (participant.user_id !== selectedParticipant.user_id) return participant;
                        const updatedScores = {...participant.scores};
                        for (const [key, value] of Object.entries(modalScores)) {
                            updatedScores[key] = {...value};
                        }
                        return {...participant, scores: updatedScores};
                    }),
                );

                Message.success(`Final score saved for ${selectedParticipant.user_name}!`);
            } else if (selectedTeam) {
                const promises: Promise<void>[] = [];

                for (const code of codesToProcess) {
                    const eventKey = normalizeEventKey(code, selectedGroup.event.type);
                    const scores = modalScores[eventKey];
                    if (!scores) continue;

                    const try1 = Number.parseFloat(scores.try1);
                    const try2 = Number.parseFloat(scores.try2);
                    const try3 = Number.parseFloat(scores.try3);

                    const eventName = `${code}-${selectedGroup.event.type}`;

                    promises.push(
                        saveTeamRecord({
                            tournamentId,
                            event: eventName,
                            participantId: selectedTeam.id,
                            teamName: selectedTeam.name,
                            country: "MY",
                            leaderId: selectedTeam.leader_id,
                            members: selectedTeam.members,
                            round: "final",
                            classification,
                            try1,
                            try2,
                            try3,
                            status: "submitted",
                            submitted_at: now,
                        }),
                    );
                }

                await Promise.all(promises);

                setTeamScores((prev) =>
                    prev.map((team) => {
                        if (team.id !== selectedTeam.id) return team;
                        const updatedScores = {...team.scores};
                        for (const [key, value] of Object.entries(modalScores)) {
                            updatedScores[key] = {...value};
                        }
                        return {...team, scores: updatedScores};
                    }),
                );

                Message.success(`Final score saved for team ${selectedTeam.name}!`);
            }

            closeModal();
        } catch (error) {
            console.error("Failed to save final score:", error);
            Message.error("Failed to save final score. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const fetchAndProcessData = async () => {
            if (!tournamentId) return;

            setLoading(true);
            try {
                let finalistData: Finalist[];
                let tournamentData: Tournament;
                let registrations: Registration[];
                let teams: Team[];
                let eventCodesByType = new Map<string, string[]>();

                if (location.state) {
                    // Use state if available
                    ({finalists: finalistData, tournament: tournamentData, registrations, teams} = location.state);
                    eventCodesByType = buildEventCodeMap(tournamentData.events);
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
                    eventCodesByType = buildEventCodeMap(tournamentData.events);

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
                        const eventCodes = event.codes ?? [];

                        for (const code of eventCodes) {
                            if (code === "Overall") {
                                continue;
                            }
                            const eventKey = `${code}-${event.type}`;

                            for (const bracket of event.age_brackets ?? []) {
                                const isTeamEvent =
                                    ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                                const mappedCodes = eventCodesByType.get(event.type.toLowerCase()) ?? [];
                                const fallbackCodes = sanitizeEventCodes(event.codes);
                                const resolvedCodes = mappedCodes.length > 0 ? mappedCodes : fallbackCodes;
                                const eventCodesForFinal = resolvedCodes.length > 0 ? [...resolvedCodes] : [event.type];

                                let records: (PrelimResultData & {team?: Team; registration?: Registration})[] = [];

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
                                                teamId,
                                                team,
                                            };
                                        });
                                } else {
                                    records = prelimRecords
                                        .filter((r) => {
                                            const participantId = r.participantId as string;
                                            const age = ageMap[participantId];
                                            return (
                                                r.event === eventKey &&
                                                age >= bracket.min_age &&
                                                age <= bracket.max_age &&
                                                !("leaderId" in r)
                                            );
                                        })
                                        .sort((a, b) => a.bestTime - b.bestTime)
                                        .map((record, index) => ({
                                            ...record,
                                            rank: index + 1,
                                            name: nameMap[record.participantId as string] || "N/A",
                                            id: record.participantId as string,
                                            registration: registrations.find(
                                                (reg) => reg.user_id === record.participantId,
                                            ),
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
                                            eventCode: code,
                                            eventCodes: eventCodesForFinal,
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
                }

                finalistData = finalistData.map((finalist) => {
                    const mappedCodes =
                        finalist.eventCodes && finalist.eventCodes.length > 0
                            ? finalist.eventCodes
                            : eventCodesByType.get(finalist.event.type.toLowerCase()) ?? [];
                    const fallbackCodes = sanitizeEventCodes(finalist.event.codes);
                    const resolvedCodes = mappedCodes.length > 0 ? mappedCodes : fallbackCodes;
                    const eventCodes = resolvedCodes.length > 0 ? [...resolvedCodes] : [finalist.event.type];

                    if (finalist.eventCode) {
                        return {
                            ...finalist,
                            eventCodes,
                        };
                    }

                    const derivedCode =
                        finalist.records?.[0]?.event?.split("-").slice(0, -1).join("-") ||
                        finalist.event.codes?.[0] ||
                        finalist.event.type;
                    return {
                        ...finalist,
                        eventCode: derivedCode,
                        eventCodes,
                    };
                });

                setTournament(tournamentData);
                setFinalists(finalistData);

                const finalRecords = await getTournamentFinalRecords(tournamentId);

                const participantScoresMap: Record<string, ParticipantScore> = {};
                const teamScoresMap: Record<string, TeamScore> = {};
                for (const finalist of finalistData) {
                    const isTeamEvent = ["double", "team relay", "parent & child"].includes(finalist.event.type.toLowerCase());
                    const finalistCodes = getFinalistCodes(finalist);
                    const codesToUse = finalistCodes.length > 0 ? finalistCodes : [finalist.event.type];

                    for (const record of finalist.records) {
                        if (isTeamEvent && record.team) {
                            const teamId = record.team.id;
                            if (!teamScoresMap[teamId]) {
                                teamScoresMap[teamId] = {...record.team, scores: {}};
                            }

                            for (const code of codesToUse) {
                                const eventKey = normalizeEventKey(code, finalist.event.type);
                                const finalRecord = finalRecords.find(
                                    (r) => r.participantId === teamId && r.event.toLowerCase() === eventKey,
                                ) as TournamentTeamRecord | undefined;
                                const existingScore = teamScoresMap[teamId].scores[eventKey] ?? {};
                                teamScoresMap[teamId].scores[eventKey] = {
                                    ...existingScore,
                                    try1: finalRecord?.try1?.toString() || "",
                                    try2: finalRecord?.try2?.toString() || "",
                                    try3: finalRecord?.try3?.toString() || "",
                                };
                            }
                        } else if (!isTeamEvent && record.registration) {
                            const userId = record.registration.user_id;
                            if (!participantScoresMap[userId]) {
                                participantScoresMap[userId] = {...record.registration, scores: {}};
                            }

                            for (const code of codesToUse) {
                                const eventKey = normalizeEventKey(code, finalist.event.type);
                                const finalRecord = finalRecords.find(
                                    (r) => r.participantId === userId && r.event.toLowerCase() === eventKey,
                                );
                                const existingScore = participantScoresMap[userId].scores[eventKey] ?? {};
                                participantScoresMap[userId].scores[eventKey] = {
                                    ...existingScore,
                                    try1: finalRecord?.try1?.toString() || "",
                                    try2: finalRecord?.try2?.toString() || "",
                                    try3: finalRecord?.try3?.toString() || "",
                                };
                            }
                        }
                    }
                }

                setParticipantScores(Object.values(participantScoresMap));
                setTeamScores(Object.values(teamScoresMap));

                if (finalistData[0]) {
                    const firstFinalist = finalistData[0];
                    const firstEventKey = getEventGroupKey(firstFinalist);
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

    const handleClearScores = (userId: string, groupToClear: ClassificationGroup) => {
        const codes = getGroupCodes(groupToClear);

        setParticipantScores((prev) =>
            prev.map((participant) => {
                if (participant.user_id !== userId) return participant;
                const updatedScores = {...participant.scores};
                for (const code of codes) {
                    const eventKey = normalizeEventKey(code, groupToClear.event.type);
                    updatedScores[eventKey] = buildEmptyScoreForFinalist();
                }
                return {
                    ...participant,
                    scores: updatedScores,
                };
            }),
        );
    };

    const handleClearTeamScores = (teamId: string, groupToClear: ClassificationGroup) => {
        const codes = getGroupCodes(groupToClear);

        setTeamScores((prev) =>
            prev.map((team) => {
                if (team.id !== teamId) return team;
                const updatedScores = {...team.scores};
                for (const code of codes) {
                    const eventKey = normalizeEventKey(code, groupToClear.event.type);
                    updatedScores[eventKey] = buildEmptyScoreForFinalist();
                }
                return {
                    ...team,
                    scores: updatedScores,
                };
            }),
        );
    };

    const getBestTime = (scores: Score) => {
        const times = [scores.try1, scores.try2, scores.try3]
            .map((s) => Number.parseFloat(s))
            .filter((t) => !Number.isNaN(t) && t > 0);
        return times.length > 0 ? Math.min(...times).toFixed(3) : "N/A";
    };

    const modalEventLabel = selectedGroup ? selectedGroup.event.type : "";
    const modalCodes = selectedGroup ? getGroupCodes(selectedGroup) : [];

    const eventGroups = useMemo(() => {
        const map = new Map<
            string,
            {
                key: string;
                label: string;
                finalists: Finalist[];
            }
        >();

        for (const finalist of finalists) {
            const key = getEventGroupKey(finalist);
            const label = getEventGroupLabel(finalist);
            const entry = map.get(key);
            if (entry) {
                entry.finalists.push(finalist);
            } else {
                map.set(key, {
                    key,
                    label,
                    finalists: [finalist],
                });
            }
        }

        return Array.from(map.values());
    }, [finalists]);

    useEffect(() => {
        if (eventGroups.length === 0) return;
        const exists = eventGroups.some((group) => group.key === currentEventTab);
        if (!exists) {
            const firstGroup = eventGroups[0];
            setCurrentEventTab(firstGroup.key);
            if (firstGroup.finalists[0]) {
                const firstFinalist = firstGroup.finalists[0];
                setCurrentBracketTab(firstFinalist.bracket.name);
                if (firstFinalist.classification) {
                    setCurrentClassificationTab(firstFinalist.classification);
                }
            }
        }
    }, [eventGroups, currentEventTab]);

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

    return (
        <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
            <Button type="outline" onClick={() => navigate(`/tournaments/${tournamentId}/record/prelim`)} className="w-fit">
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>{tournament.name} Final Score</Title>
                    <div className="flex gap-2">
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
                        const group = eventGroups.find((g) => g.key === key);
                        if (group?.finalists[0]) {
                            const first = group.finalists[0];
                            setCurrentBracketTab(first.bracket.name);
                            if (first.classification) {
                                setCurrentClassificationTab(first.classification);
                            }
                        }
                    }}
                >
                    {eventGroups.map(({key: eventGroupKey, label, finalists: eventFinalists}) => {
                        const bracketMap = new Map<string, Finalist>();
                        for (const finalist of eventFinalists) {
                            if (!bracketMap.has(finalist.bracket.name)) {
                                bracketMap.set(finalist.bracket.name, finalist);
                            }
                        }
                        const bracketEntries = Array.from(bracketMap.values());
                        const classifications = [
                            ...new Set(eventFinalists.map((finalist) => finalist.classification)),
                        ] as ClassificationGroup["classification"][];

                        return (
                            <TabPane key={eventGroupKey} title={label}>
                                <Tabs
                                    type="capsule"
                                    tabPosition="top"
                                    destroyOnHide
                                    activeTab={currentBracketTab}
                                    onChange={(key) => setCurrentBracketTab(key)}
                                >
                                    {bracketEntries.map((bracketFinalist) => (
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
                                                    const classificationFinalists = eventFinalists.filter(
                                                        (f) =>
                                                            f.bracket.name === bracketFinalist.bracket.name &&
                                                            f.classification === classification,
                                                    );
                                                    if (classificationFinalists.length === 0) return null;

                                                    const classificationGroup: ClassificationGroup = {
                                                        event: classificationFinalists[0].event,
                                                        bracket: classificationFinalists[0].bracket,
                                                        classification,
                                                        finalists: classificationFinalists,
                                                    };

                                                    const groupIsTeamEvent =
                                                        ["double", "team relay", "parent & child"].includes(
                                                            classificationGroup.event.type.toLowerCase(),
                                                        );

                                                    return (
                                                        <TabPane key={classification} title={classification}>
                                                            <BracketContent
                                                                isTeamEvent={groupIsTeamEvent}
                                                                group={classificationGroup}
                                                                teamScores={teamScores}
                                                                participantScores={participantScores}
                                                                loading={loading}
                                                                currentClassification={currentClassificationTab}
                                                                handleClearScores={handleClearScores}
                                                                handleClearTeamScores={handleClearTeamScores}
                                                                openModal={openModal}
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

            <Modal
                title={`Edit Final Score - ${selectedParticipant?.user_name || selectedTeam?.name || ""}`}
                visible={modalVisible}
                onCancel={closeModal}
                footer={[
                    <Button key="clear" onClick={resetModalScore} disabled={!selectedGroup}>
                        Clear
                    </Button>,
                    <Button key="cancel" onClick={closeModal}>
                        Cancel
                    </Button>,
                    <Button key="save" type="primary" onClick={saveModalScores}>
                        Save
                    </Button>,
                ]}
                style={{width: 560}}
            >
                {modalVisible && selectedGroup && modalCodes.length > 0 && (
                    <div style={{display: "flex", flexDirection: "column", gap: "16px"}}>
                        <div style={{display: "flex", flexDirection: "column", gap: "4px"}}>
                            {selectedParticipant && (
                                <span style={{fontWeight: 600}}>
                                    Participant: {selectedParticipant.user_name} ({selectedParticipant.user_id})
                                </span>
                            )}
                            {selectedTeam && (
                                <span style={{fontWeight: 600}}>
                                    Team: {selectedTeam.name} (Leader: {selectedTeam.leader_id})
                                </span>
                            )}
                            {selectedTeam?.members?.length ? (
                                <span>
                                    Members: {selectedTeam.members.map((member) => member.global_id).join(", ")}
                                </span>
                            ) : null}
                            {modalEventLabel && <span>Event Type: {modalEventLabel}</span>}
                            <span>Event Codes: {modalCodes.join(", ")}</span>
                            <span>
                                Bracket: {selectedGroup.bracket.name} ({selectedGroup.bracket.min_age}-
                                {selectedGroup.bracket.max_age})
                            </span>
                            <span>Classification: {selectedGroup.classification}</span>
                        </div>

                        <div style={{display: "flex", flexDirection: "column", gap: "16px"}}>
                            {modalCodes.map((code) => {
                                const eventKey = normalizeEventKey(code, selectedGroup.event.type);
                                const score = modalScores[eventKey] ?? buildEmptyScoreForFinalist();
                                const bestTime = getBestTime(score);
                                return (
                                    <div key={eventKey} style={{border: "1px solid #e5e7eb", borderRadius: "6px", padding: "12px"}}>
                                        <div style={{display: "flex", justifyContent: "space-between", marginBottom: "12px"}}>
                                            <span style={{fontWeight: 600}}>{code}</span>
                                            <span style={{fontWeight: 600}}>Best Time: {bestTime}</span>
                                        </div>
                                        <div style={{display: "grid", gap: "12px", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))"}}>
                                            {(["try1", "try2", "try3"] as const).map((attemptKey) => (
                                                <div key={attemptKey} style={{display: "flex", flexDirection: "column", gap: "6px"}}>
                                                    <span style={{fontWeight: 500}}>{`Try ${attemptKey.slice(3)}`}</span>
                                                    <InputNumber
                                                        placeholder={`Try ${attemptKey.slice(3)}`}
                                                        value={toNumberOrUndefined(score[attemptKey])}
                                                        onChange={(val) =>
                                                            handleModalScoreChange(
                                                                eventKey,
                                                                attemptKey,
                                                                val === undefined || val === null ? "" : String(val),
                                                            )
                                                        }
                                                        precision={3}
                                                        min={0}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
}
