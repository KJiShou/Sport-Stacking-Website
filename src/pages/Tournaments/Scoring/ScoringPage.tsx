import type {Registration, Team, TeamMember, Tournament, TournamentEvent} from "@/schema";
import {getUserByGlobalId} from "@/services/firebase/authService";
import {getPrelimRecords, getTournamentPrelimRecords, saveRecord, saveTeamRecord} from "@/services/firebase/recordService";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {getEventKey, getTeamEvents, sanitizeEventCodes, teamMatchesEventKey} from "@/utils/tournament/eventUtils";
import {Button, Input, InputNumber, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch, IconUndo} from "@arco-design/web-react/icon";
import {useRef, useState} from "react";
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
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registrationList, setRegistrationList] = useState<ParticipantScore[]>([]);
    const [teamScoreList, setTeamScoreList] = useState<TeamScore[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState<string>("");
    const mountedRef = useRef(false);

    // Modal state
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<ParticipantScore | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<TeamScore | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<string>("");
    const [modalScores, setModalScores] = useState<Record<string, Score>>({});

    const registrationMatchesEvent = (eventsRegistered: string[], event: TournamentEvent): boolean => {
        const normalizedRegistered = eventsRegistered.map((value) => value.toLowerCase());
        const normalizedType = event.type.toLowerCase();
        if (normalizedRegistered.includes(normalizedType)) {
            return true;
        }

        return sanitizeEventCodes(event.codes).some((code) => {
            const normalizedCode = code.toLowerCase();
            if (normalizedRegistered.includes(normalizedCode)) {
                return true;
            }
            const combined = `${code}-${event.type}`.toLowerCase();
            return normalizedRegistered.includes(combined);
        });
    };

    const teamMatchesEvent = (team: Team, event: TournamentEvent): boolean => {
        const tournamentEvents = tournament?.events ?? [];
        return teamMatchesEventKey(team, getEventKey(event), tournamentEvents);
    };

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            if (t?.events?.[0]) {
                const firstEvent = t.events[0];
                const firstEventTabKey = firstEvent.id ?? firstEvent.type;
                setCurrentEventTab(firstEventTabKey);
                if (firstEvent.age_brackets?.[0]) {
                    setCurrentBracketTab(firstEvent.age_brackets[0].name);
                }
            }
            const [regs, teams, records] = await Promise.all([
                fetchRegistrations(tournamentId),
                fetchTeamsByTournament(tournamentId),
                getTournamentPrelimRecords(tournamentId),
            ]);
            setTeamScoreList(
                teams.map((team) => {
                    const teamScores: Record<string, Score> = {};
                    const tournamentEvents = t?.events ?? [];
                    const resolvedEvents = getTeamEvents(team, tournamentEvents);

                    if (resolvedEvents.length > 0) {
                        for (const event of resolvedEvents) {
                            const eventType = event.type;
                            const eventCodes = sanitizeEventCodes(event.codes);

                            if (eventCodes.length > 0) {
                                for (const code of eventCodes) {
                                    const codeEventKey = `${code}-${eventType}`;
                                    const record = records.find(
                                        (rec) =>
                                            "leaderId" in rec &&
                                            rec.leaderId === team.leader_id &&
                                            rec.event === codeEventKey,
                                    );
                                    teamScores[codeEventKey] = {
                                        try1: record?.try1?.toString() || "",
                                        try2: record?.try2?.toString() || "",
                                        try3: record?.try3?.toString() || "",
                                    };
                                }
                            } else {
                                const eventKey = getEventKey(event);
                                const record = records.find(
                                    (rec) =>
                                        "leaderId" in rec &&
                                        rec.leaderId === team.leader_id &&
                                        rec.event === eventKey,
                                );
                                teamScores[eventKey] = {
                                    try1: record?.try1?.toString() || "",
                                    try2: record?.try2?.toString() || "",
                                    try3: record?.try3?.toString() || "",
                                };
                            }
                        }
                    } else {
                        const fallbackKeys = (team.event_ids && team.event_ids.length > 0
                            ? team.event_ids
                            : team.events ?? []);

                        for (const fallbackKey of fallbackKeys) {
                            const record = records.find(
                                (rec) =>
                                    "leaderId" in rec &&
                                    rec.leaderId === team.leader_id &&
                                    rec.event === fallbackKey,
                            );
                            teamScores[fallbackKey] = {
                                try1: record?.try1?.toString() || "",
                                try2: record?.try2?.toString() || "",
                                try3: record?.try3?.toString() || "",
                            };
                        }
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
                    const augmentedEvents = new Set<string>(r.events_registered);

                    for (const event of t?.events ?? []) {
                        if (!registrationMatchesEvent(r.events_registered, event)) {
                            continue;
                        }

                        const eventType = event.type;
                        augmentedEvents.add(eventType);
                        const eventCodes = sanitizeEventCodes(event.codes);

                        if (eventCodes.length > 0) {
                            for (const code of eventCodes) {
                                const codeEventKey = `${code}-${eventType}`;
                                const record = records.find(
                                    (rec) => rec.participantId === r.user_id && rec.event === codeEventKey,
                                );
                                participantScores[codeEventKey] = {
                                    try1: record?.try1?.toString() || "",
                                    try2: record?.try2?.toString() || "",
                                    try3: record?.try3?.toString() || "",
                                };
                            }
                        } else {
                            const record = records.find(
                                (rec) => rec.participantId === r.user_id && rec.event === eventType,
                            );
                            participantScores[eventType] = {
                                try1: record?.try1?.toString() || "",
                                try2: record?.try2?.toString() || "",
                                try3: record?.try3?.toString() || "",
                            };
                        }
                    }

                    return {
                        ...r,
                        events_registered: Array.from(augmentedEvents),
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

    const validateParticipantRecord = (participant: ParticipantScore) => {
        const errors: string[] = [];
        const missingEvents: string[] = [];

        for (const event of tournament?.events ?? []) {
            if (!registrationMatchesEvent(participant.events_registered, event)) {
                continue;
            }

            const eventType = event.type;
            const eventCodes = sanitizeEventCodes(event.codes);

            if (eventCodes.length > 0) {
                // For events with multiple codes (like Individual with 3-3-3, 3-6-3, Cycle)
                for (const code of eventCodes) {
                    const codeEventKey = `${code}-${eventType}`;
                    const scores = participant.scores[codeEventKey];

                    if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                        missingEvents.push(`${code} (${eventType})`);
                    } else {
                        // Validate that all tries have valid positive numbers
                        const invalidTries: string[] = [];
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);

                        if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                        if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                        if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                        if (invalidTries.length > 0) {
                            errors.push(`${participant.user_name} (${participant.user_id}): Invalid times in ${code} (${eventType}) - ${invalidTries.join(", ")}`);
                        }
                    }
                }
            } else {
                // For events without codes
                const scores = participant.scores[eventType];
                if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                    missingEvents.push(eventType);
                } else {
                    // Validate that all tries have valid positive numbers
                    const invalidTries: string[] = [];
                    const try1 = Number.parseFloat(scores.try1);
                    const try2 = Number.parseFloat(scores.try2);
                    const try3 = Number.parseFloat(scores.try3);

                    if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                    if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                    if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                    if (invalidTries.length > 0) {
                        errors.push(`${participant.user_name} (${participant.user_id}): Invalid times in ${eventType} - ${invalidTries.join(", ")}`);
                    }
                }
            }
        }

        if (missingEvents.length > 0) {
            errors.push(`${participant.user_name} (${participant.user_id}): Missing records for ${missingEvents.join(", ")}`);
        }

        return errors;
    };

    const validateTeamRecord = (team: TeamScore) => {
        const errors: string[] = [];
        const missingEvents: string[] = [];

        for (const event of tournament?.events ?? []) {
            if (!teamMatchesEvent(team, event)) {
                continue;
            }

            const eventType = event.type;
            const eventCodes = sanitizeEventCodes(event.codes);

            if (eventCodes.length > 0) {
                // For events with multiple codes
                for (const code of eventCodes) {
                    const codeEventKey = `${code}-${eventType}`;
                    const scores = team.scores[codeEventKey];

                    if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                        missingEvents.push(`${code} (${eventType})`);
                    } else {
                        // Validate that all tries have valid positive numbers
                        const invalidTries: string[] = [];
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);

                        if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                        if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                        if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                        if (invalidTries.length > 0) {
                            errors.push(`${team.name} (Leader: ${team.leader_id}): Invalid times in ${code} (${eventType}) - ${invalidTries.join(", ")}`);
                        }
                    }
                }
            } else {
                // For events without codes
                const scores = team.scores[eventType];
                if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                    missingEvents.push(eventType);
                } else {
                    // Validate that all tries have valid positive numbers
                    const invalidTries: string[] = [];
                    const try1 = Number.parseFloat(scores.try1);
                    const try2 = Number.parseFloat(scores.try2);
                    const try3 = Number.parseFloat(scores.try3);

                    if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                    if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                    if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                    if (invalidTries.length > 0) {
                        errors.push(`${team.name} (Leader: ${team.leader_id}): Invalid times in ${eventType} - ${invalidTries.join(", ")}`);
                    }
                }
            }
        }

        if (missingEvents.length > 0) {
            errors.push(`${team.name} (Leader: ${team.leader_id}): Missing records for ${missingEvents.join(", ")}`);
        }

        return errors;
    };

    // Modal functions
    const openModal = (participant: ParticipantScore | null, team: TeamScore | null, eventKey: string) => {
        setSelectedParticipant(participant);
        setSelectedTeam(team);
        setSelectedEvent(eventKey);

        // Initialize modal scores with current scores
        if (participant) {
            setModalScores({...participant.scores});
        } else if (team) {
            setModalScores({...team.scores});
        }

        setModalVisible(true);
    };

    const closeModal = () => {
        setModalVisible(false);
        setSelectedParticipant(null);
        setSelectedTeam(null);
        setSelectedEvent("");
        setModalScores({});
    };

    const handleModalScoreChange = (eventKey: string, tryNum: keyof Score, value: string) => {
        setModalScores(prev => ({
            ...prev,
            [eventKey]: {
                ...prev[eventKey],
                [tryNum]: value,
            },
        }));
    };

    const validateModalRecord = () => {
        const errors: string[] = [];
        const event = tournament?.events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);

        if (!event) return errors;

        const eventCodes = sanitizeEventCodes(event.codes);

        if (eventCodes.length > 0) {
            // For events with multiple codes
            for (const code of eventCodes) {
                const codeEventKey = `${code}-${event.type}`;
                const scores = modalScores[codeEventKey];

                if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                    errors.push(`Missing records for ${code} (${selectedEvent})`);
                } else {
                    const invalidTries: string[] = [];
                    const try1 = Number.parseFloat(scores.try1);
                    const try2 = Number.parseFloat(scores.try2);
                    const try3 = Number.parseFloat(scores.try3);

                    if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                    if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                    if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                    if (invalidTries.length > 0) {
                        errors.push(`Invalid times in ${code} (${selectedEvent}) - ${invalidTries.join(", ")}`);
                    }
                }
            }
        } else {
            // For events without codes
            const scores = modalScores[event.type];
            if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                errors.push(`Missing records for ${selectedEvent}`);
            } else {
                const invalidTries: string[] = [];
                const try1 = Number.parseFloat(scores.try1);
                const try2 = Number.parseFloat(scores.try2);
                const try3 = Number.parseFloat(scores.try3);

                if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1");
                if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2");
                if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3");

                if (invalidTries.length > 0) {
                    errors.push(`Invalid times in ${selectedEvent} - ${invalidTries.join(", ")}`);
                }
            }
        }

        return errors;
    };

    const saveModalRecord = async () => {
        if (!tournamentId || !tournament) return;

        const validationErrors = validateModalRecord();
        if (validationErrors.length > 0) {
            const errorMessage = `Validation Failed:\n${validationErrors.join('\n')}`;
            Message.error(errorMessage);
            return;
        }

        setLoading(true);
        try {
            const event = tournament.events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);

            if (selectedParticipant && event) {
                // Save participant records
                const promises: Promise<void>[] = [];

                const eventCodes = sanitizeEventCodes(event.codes);

                if (eventCodes.length > 0) {
                    // For events with codes
                    for (const code of eventCodes) {
                        const codeEventKey = `${code}-${event.type}`;
                        const scores = modalScores[codeEventKey];

                        if (scores?.try1 && scores.try2 && scores.try3) {
                            const try1 = Number.parseFloat(scores.try1);
                            const try2 = Number.parseFloat(scores.try2);
                            const try3 = Number.parseFloat(scores.try3);

                            promises.push(saveRecord({
                                tournamentId,
                                event: codeEventKey,
                                participantId: selectedParticipant.user_id,
                                participantName: selectedParticipant.user_name,
                                participantAge: selectedParticipant.age,
                                country: selectedParticipant.country,
                                gender: selectedParticipant.gender || "Male",
                                round: "prelim",
                                classification: undefined,
                                verified_by: undefined,
                                verified_at: undefined,
                                try1,
                                try2,
                                try3,
                                status: "submitted",
                                submitted_at: new Date().toISOString(),
                            }));
                        }
                    }
                } else {
                    // For events without codes
                    const scores = modalScores[event.type];
                    if (scores?.try1 && scores.try2 && scores.try3) {
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);

                        promises.push(saveRecord({
                            tournamentId,
                            event: event.type,
                            participantId: selectedParticipant.user_id,
                            participantName: selectedParticipant.user_name,
                            participantAge: selectedParticipant.age,
                            country: selectedParticipant.country,
                            gender: selectedParticipant.gender || "Male",
                            round: "prelim",
                            classification: undefined,
                            verified_by: undefined,
                            verified_at: undefined,
                            try1,
                            try2,
                            try3,
                            status: "submitted",
                            submitted_at: new Date().toISOString(),
                        }));
                    }
                }

                await Promise.all(promises);

                // Update the participant in the list with new scores
                setRegistrationList(prev => prev.map(p =>
                    p.user_id === selectedParticipant.user_id ? {...p, scores: modalScores} : p
                ));

                // If individual event, try to calculate overall
                if (selectedEvent === "Individual") {
                    await calculateAndSaveOverallResults();
                }

                Message.success(`Record saved for ${selectedParticipant.user_name}!`);
                closeModal();

            } else if (selectedTeam && event) {
                // Save team records
                const promises: Promise<void>[] = [];

                // Get team leader info
                const leaderInfo = await getUserByGlobalId(selectedTeam.leader_id);
                const country = leaderInfo?.country?.[0] || "MY";

                const eventCodes = sanitizeEventCodes(event.codes);

                if (eventCodes.length > 0) {
                    // For events with codes
                    for (const code of eventCodes) {
                        const codeEventKey = `${code}-${event.type}`;
                        const scores = modalScores[codeEventKey];

                        if (scores?.try1 && scores.try2 && scores.try3) {
                            const try1 = Number.parseFloat(scores.try1);
                            const try2 = Number.parseFloat(scores.try2);
                            const try3 = Number.parseFloat(scores.try3);

                            promises.push(saveTeamRecord({
                                tournamentId,
                                event: codeEventKey,
                                participantId: selectedTeam.id,
                                teamName: selectedTeam.name,
                                country,
                                leaderId: selectedTeam.leader_id,
                                members: selectedTeam.members,
                                round: "prelim",
                                classification: undefined,
                                verified_by: undefined,
                                verified_at: undefined,
                                try1,
                                try2,
                                try3,
                                status: "submitted",
                                submitted_at: new Date().toISOString(),
                            }));
                        }
                    }
                } else {
                    // For events without codes
                    const scores = modalScores[event.type];
                    if (scores?.try1 && scores.try2 && scores.try3) {
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);

                        promises.push(saveTeamRecord({
                            tournamentId,
                            event: event.type,
                            participantId: selectedTeam.id,
                            teamName: selectedTeam.name,
                            country,
                            leaderId: selectedTeam.leader_id,
                            members: selectedTeam.members,
                            round: "prelim",
                            classification: undefined,
                            verified_by: undefined,
                            verified_at: undefined,
                            try1,
                            try2,
                            try3,
                            status: "submitted",
                            submitted_at: new Date().toISOString(),
                        }));
                    }
                }

                await Promise.all(promises);

                // Update the team in the list with new scores
                setTeamScoreList(prev => prev.map(t =>
                    t.id === selectedTeam.id ? {...t, scores: modalScores} : t
                ));

                Message.success(`Record saved for team ${selectedTeam.name}!`);
                closeModal();
            }
        } catch (error) {
            console.error("Failed to save record:", error);
            Message.error("Failed to save record. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    const calculateAndSaveOverallResults = async () => {
        if (!tournamentId || !tournament) return;

        // Find Individual event with all three codes
        const individualEvent = tournament.events?.find(
            (e) => e.type === "Individual" &&
            e.codes?.includes("3-3-3") &&
            e.codes?.includes("3-6-3") &&
            e.codes?.includes("Cycle")
        );

        if (!individualEvent) return;

        try {
            // Get all individual participants who have completed all three events
            const individualParticipants = registrationList.filter(p =>
                p.events_registered.includes("Individual") &&
                p.scores["3-3-3-Individual"] && p.scores["3-3-3-Individual"].try1 && p.scores["3-3-3-Individual"].try2 && p.scores["3-3-3-Individual"].try3 &&
                p.scores["3-6-3-Individual"] && p.scores["3-6-3-Individual"].try1 && p.scores["3-6-3-Individual"].try2 && p.scores["3-6-3-Individual"].try3 &&
                p.scores["Cycle-Individual"] && p.scores["Cycle-Individual"].try1 && p.scores["Cycle-Individual"].try2 && p.scores["Cycle-Individual"].try3
            );

            // Calculate overall results and save them
            const overallPromises = individualParticipants.map(p => {
                const threeScores = p.scores["3-3-3-Individual"];
                const threeSixThreeScores = p.scores["3-6-3-Individual"];
                const cycleScores = p.scores["Cycle-Individual"];

                // Get best times for each event
                const threeBest = Math.min(
                    Number.parseFloat(threeScores.try1),
                    Number.parseFloat(threeScores.try2),
                    Number.parseFloat(threeScores.try3)
                );
                const threeSixThreeBest = Math.min(
                    Number.parseFloat(threeSixThreeScores.try1),
                    Number.parseFloat(threeSixThreeScores.try2),
                    Number.parseFloat(threeSixThreeScores.try3)
                );
                const cycleBest = Math.min(
                    Number.parseFloat(cycleScores.try1),
                    Number.parseFloat(cycleScores.try2),
                    Number.parseFloat(cycleScores.try3)
                );

                // Calculate overall time (sum of best times)
                const overallTime = threeBest + threeSixThreeBest + cycleBest;

                // Save overall record
                return saveRecord({
                    tournamentId,
                    event: "Overall-Individual",
                    participantId: p.user_id,
                    participantName: p.user_name,
                    participantAge: p.age,
                    country: p.country,
                    gender: p.gender || "Male",
                    round: "prelim",
                    classification: undefined,
                    verified_by: undefined,
                    verified_at: undefined,
                    try1: overallTime, // Store overall time in try1
                    try2: overallTime, // Store overall time in try2
                    try3: overallTime, // Store overall time in try3
                    status: "submitted",
                    submitted_at: new Date().toISOString(),
                });
            });

            await Promise.all(overallPromises);

            if (overallPromises.length > 0) {
                Message.success(`Calculated and saved ${overallPromises.length} overall results!`);
            }
        } catch (error) {
            console.error("Failed to calculate overall results:", error);
            Message.error("Failed to calculate overall results.");
        }
    };


    const handleSaveScores = async (eventKey: string, bracketName: string, isTeamEvent: boolean) => {
        if (!tournamentId || !tournament) return;

        const event = tournament.events?.find((e) => e.id === eventKey || e.type === eventKey);
        const eventType = event?.type ?? eventKey;
        const bracket = event?.age_brackets.find((b) => b.name === bracketName);

        if (!bracket) {
            Message.error("Invalid event or bracket.");
            return;
        }

        // Get participants/teams for this specific bracket to validate
        const validationErrors: string[] = [];

        if (isTeamEvent) {
            const tournamentEvents = tournament.events ?? [];
            const teamsForBracket = teamScoreList.filter(
                (t) =>
                    (event ? teamMatchesEvent(t, event) : teamMatchesEventKey(t, eventType, tournamentEvents)) &&
                    t.largest_age >= bracket.min_age &&
                    t.largest_age <= bracket.max_age,
            );

            for (const team of teamsForBracket) {
                validationErrors.push(...validateTeamRecord(team));
            }
        } else {
            const participantsForBracket = registrationList.filter(
                (r) =>
                    (event ? registrationMatchesEvent(r.events_registered, event) : r.events_registered.includes(eventType)) &&
                    r.age >= bracket.min_age &&
                    r.age <= bracket.max_age,
            );

            for (const participant of participantsForBracket) {
                validationErrors.push(...validateParticipantRecord(participant));
            }
        }

        if (validationErrors.length > 0) {
            const errorMessage = `Validation Failed:\n${validationErrors.slice(0, 5).join('\n')}${validationErrors.length > 5 ? `\n... and ${validationErrors.length - 5} more errors` : ''}`;
            Message.error(errorMessage);
            return;
        }

        setLoading(true);
        try {

            if (isTeamEvent) {
                const tournamentEvents = tournament.events ?? [];
                const teamsToSave = teamScoreList.filter((t) =>
                    event ? teamMatchesEvent(t, event) : teamMatchesEventKey(t, eventType, tournamentEvents),
                );

                // First get all leader info
                const teamLeaderInfo = await Promise.all(
                    teamsToSave.map(async (t) => ({
                        teamId: t.id,
                        leaderInfo: await getUserByGlobalId(t.leader_id),
                    })),
                );

                // Create a map for quick lookup
                const leaderInfoMap = Object.fromEntries(
                    teamLeaderInfo.map(({teamId, leaderInfo}) => [teamId, leaderInfo?.country?.[0] || "MY"]),
                );

                // Now save all team records
                const event = tournament.events?.find((e) => e.id === eventKey || e.type === eventKey);
                const eventCodes = sanitizeEventCodes(event?.codes);
                let promises: (Promise<void> | null)[] = [];

                if (eventCodes.length > 0) {
                    // For events with codes, save scores for each code separately
                    promises = teamsToSave
                        .flatMap(
                            (t) =>
                                eventCodes.map((code) => {
                                    const codeEventKey = `${code}-${event?.type ?? eventType}`;
                                    const teamScores = t.scores[codeEventKey];
                                    if (teamScores?.try1 && teamScores.try2 && teamScores.try3) {
                                        return saveTeamRecord({
                                            tournamentId,
                                            event: codeEventKey,
                                            participantId: t.id,
                                            teamName: t.name,
                                            country: leaderInfoMap[t.id],
                                            leaderId: t.leader_id,
                                            members: t.members,
                                            round: "prelim",
                                            classification: undefined,
                                verified_by: undefined,
                                                    verified_at: undefined,
                                            try1: Number.parseFloat(teamScores.try1),
                                            try2: Number.parseFloat(teamScores.try2),
                                            try3: Number.parseFloat(teamScores.try3),
                                            status: "submitted",
                                            submitted_at: new Date().toISOString(),
                                            videoUrl: "",
                                        });
                                    }
                                    return null;
                                }),
                        )
                        .filter(Boolean);
                } else {
                    // For events without codes, use regular scoring
                    promises = teamsToSave
                        .map((t) => {
                            const key = event?.type ?? eventType;
                            const teamScores = t.scores[key];
                            if (teamScores?.try1 && teamScores.try2 && teamScores.try3) {
                                return saveTeamRecord({
                                    tournamentId,
                                    event: event?.type ?? eventType,
                                    participantId: t.id,
                                    teamName: t.name,
                                    country: leaderInfoMap[t.id],
                                    leaderId: t.leader_id,
                                    members: t.members,
                                    round: "prelim",
                                    classification: undefined,
                                verified_by: undefined,
                                verified_at: undefined,
                                    try1: Number.parseFloat(teamScores.try1),
                                    try2: Number.parseFloat(teamScores.try2),
                                    try3: Number.parseFloat(teamScores.try3),
                                    status: "submitted",
                                    submitted_at: new Date().toISOString(),
                                    videoUrl: "",
                                });
                            }
                            return null;
                        })
                        .filter(Boolean);
                }

                if (promises.length > 0) {
                    await Promise.all(promises);

                    // If we just saved individual team events, try to calculate overall results
                    if (eventType === "Individual") {
                        await calculateAndSaveOverallResults();
                    }

                    Message.success(`Scores for ${eventType} - ${bracketName} saved successfully!`);
                } else {
                    Message.info("No scores to save.");
                }
            } else {
                const participantsToSave = registrationList.filter((r) =>
                    event ? registrationMatchesEvent(r.events_registered, event) : r.events_registered.includes(eventType),
                );
                const event = tournament.events?.find((e) => e.id === eventKey || e.type === eventKey);

                const eventCodes = sanitizeEventCodes(event?.codes);
                let promises: (Promise<void> | null)[] = [];

                if (eventCodes.length > 0) {
                    // For events with codes, save scores for each code separately
                    promises = participantsToSave
                        .flatMap((p) =>
                            eventCodes.map((code) => {
                                const codeEventKey = `${code}-${event?.type ?? eventType}`;
                                const eventScores = p.scores[codeEventKey];
                                if (eventScores?.try1 && eventScores.try2 && eventScores.try3) {
                                    return saveRecord({
                                        tournamentId,
                                        event: codeEventKey,
                                        participantId: p.user_id,
                                        participantName: p.user_name,
                                        participantAge: p.age,
                                        country: p.country,
                                        gender: p.gender || "Male",
                                        round: "prelim",
                                        classification: undefined,
                                        verified_by: undefined,
                                        verified_at: undefined,
                                        try1: Number.parseFloat(eventScores.try1),
                                        try2: Number.parseFloat(eventScores.try2),
                                        try3: Number.parseFloat(eventScores.try3),
                                        status: "submitted",
                                        submitted_at: new Date().toISOString(),
                                        videoUrl: "",
                                    });
                                }
                                return null;
                            }),
                        )
                        .filter(Boolean);
                } else {
                    // For non-coded events, use regular scoring
                    promises = participantsToSave
                        .map((p) => {
                            const key = event?.type ?? eventType;
                            const eventScores = p.scores[key];
                            if (eventScores?.try1 && eventScores.try2 && eventScores.try3) {
                                return saveRecord({
                                    tournamentId,
                                    event: key,
                                    participantId: p.user_id,
                                    participantName: p.user_name,
                                    participantAge: p.age,
                                    country: p.country,
                                    gender: p.gender || "Male",
                                    round: "prelim",
                                    classification: undefined,
                                    verified_by: undefined,
                                    verified_at: undefined,
                                    try1: Number.parseFloat(eventScores.try1),
                                    try2: Number.parseFloat(eventScores.try2),
                                    try3: Number.parseFloat(eventScores.try3),
                                    status: "submitted",
                                    submitted_at: new Date().toISOString(),
                                    videoUrl: "",
                                });
                            }
                            return null;
                        })
                        .filter(Boolean);
                }

                if (promises.length > 0) {
                    await Promise.all(promises);

                    // If we just saved individual participant events, try to calculate overall results
                    if (eventType === "Individual") {
                        await calculateAndSaveOverallResults();
                    }

                    Message.success(`Scores for ${eventType} - ${bracketName} saved successfully!`);
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

    const modalEvent = tournament.events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);
    const modalEventCodes = sanitizeEventCodes(modalEvent?.codes);
    const modalBaseEventKey = modalEvent?.type ?? selectedEvent;

    // Helper function to convert system labels to display names
    const getDisplayName = (eventType: string): string => {
        switch (eventType) {
            case "Individual": return "Individual";
            case "Double": return "Double";
            case "Team Relay": return "Team Relay";
            case "Parent & Child": return "Parent & Child";
            case "Special Need": return "Special Need";
            default: return eventType;
        }
    };

    // Filter function for search
    const filterParticipants = (participants: ParticipantScore[]) => {
        if (!searchTerm.trim()) return participants;
        return participants.filter(
            (p) =>
                p.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.user_name.toLowerCase().includes(searchTerm.toLowerCase()),
        );
    };

    const filterTeams = (teams: TeamScore[]) => {
        if (!searchTerm.trim()) return teams;
        return teams.filter(
            (t) =>
                t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.leader_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.members.some((m) => m.global_id.toLowerCase().includes(searchTerm.toLowerCase())),
        );
    };

    const getExpandableColumns = (codes: string[], eventKey: string): TableColumnProps<ParticipantScore>[] => [
        {title: "Global ID", dataIndex: "user_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {
            title: "Event Codes",
            width: 200,
            render: () => <span>{codes.join(", ")}</span>,
        },
        {
            title: "Status",
            width: 100,
            render: (_, record) => {
                const isComplete = codes.every(code => {
                    const codeEventKey = `${code}-${eventKey}`;
                    const scores = record.scores[codeEventKey];
                    return scores?.try1 && scores?.try2 && scores?.try3;
                });
                return (
                    <span style={{ color: isComplete ? 'green' : 'orange' }}>
                        {isComplete ? 'Complete' : 'Incomplete'}
                    </span>
                );
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button
                    type="primary"
                    size="small"
                    onClick={() => openModal(record, null, eventKey)}
                >
                    Edit
                </Button>
            ),
        },
    ];

    const getTeamExpandableColumns = (codes: string[], eventKey: string): TableColumnProps<TeamScore>[] => [
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
            title: "Event Codes",
            width: 150,
            render: () => <span>{codes.join(", ")}</span>,
        },
        {
            title: "Status",
            width: 100,
            render: (_, record) => {
                const isComplete = codes.every(code => {
                    const codeEventKey = `${code}-${eventKey}`;
                    const scores = record.scores[codeEventKey];
                    return scores?.try1 && scores?.try2 && scores?.try3;
                });
                return (
                    <span style={{ color: isComplete ? 'green' : 'orange' }}>
                        {isComplete ? 'Complete' : 'Incomplete'}
                    </span>
                );
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button
                    type="primary"
                    size="small"
                    onClick={() => openModal(null, record, eventKey)}
                >
                    Edit
                </Button>
            ),
        },
    ];

    const getIndividualColumns = (eventKey: string): TableColumnProps<ParticipantScore>[] => [
        {title: "Global ID", dataIndex: "user_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {
            title: "Status",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventKey];
                const isComplete = scores?.try1 && scores?.try2 && scores?.try3;
                return (
                    <span style={{ color: isComplete ? 'green' : 'orange' }}>
                        {isComplete ? 'Complete' : 'Incomplete'}
                    </span>
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
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button
                    type="primary"
                    size="small"
                    onClick={() => openModal(record, null, eventKey)}
                >
                    Edit
                </Button>
            ),
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
            title: "Status",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventKey];
                const isComplete = scores?.try1 && scores?.try2 && scores?.try3;
                return (
                    <span style={{ color: isComplete ? 'green' : 'orange' }}>
                        {isComplete ? 'Complete' : 'Incomplete'}
                    </span>
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
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button
                    type="primary"
                    size="small"
                    onClick={() => openModal(null, record, eventKey)}
                >
                    Edit
                </Button>
            ),
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
                    <div className="flex gap-4 items-center">
                        <Input
                            placeholder="Search by Global ID or Name"
                            value={searchTerm}
                            onChange={setSearchTerm}
                            prefix={<IconSearch />}
                            style={{width: 250}}
                        />
                    </div>
                </div>
                <Tabs
                    type="line"
                    destroyOnHide
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const event = tournament.events?.find((e) => e.id === key || e.type === key);
                        if (event?.age_brackets?.[0]) {
                            setCurrentBracketTab(event.age_brackets[0].name);
                        }
                    }}
                >
                    {tournament.events?.map((evt) => {
                        const tabKey = evt.id ?? evt.type;
                        const eventTypeKey = evt.type;
                        const isTeamEvent = ["double", "team relay", "parent & child"].includes(evt.type.toLowerCase());
                        const scoringCodes = sanitizeEventCodes(evt.codes);
                        const hasCodes = scoringCodes.length > 0;
                        const titleCodes = hasCodes ? scoringCodes.join(", ") : evt.codes?.join(", ") || "N/A";
                        return (
                            <TabPane key={tabKey} title={`${getDisplayName(evt.type)} (${titleCodes})`}>
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
                                                hasCodes ? (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={getTeamExpandableColumns(scoringCodes, eventTypeKey)}
                                                        data={filterTeams(
                                                            teamScoreList.filter(
                                                                (t) =>
                                                                    teamMatchesEvent(t, evt) &&
                                                                    t.largest_age >= br.min_age &&
                                                                    t.largest_age <= br.max_age,
                                                            ),
                                                        )}
                                                        pagination={false}
                                                        loading={loading}
                                                        rowKey="id"
                                                    />
                                                ) : (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={getTeamColumns(eventTypeKey)}
                                                        data={filterTeams(
                                                            teamScoreList.filter(
                                                                (t) =>
                                                                    teamMatchesEvent(t, evt) &&
                                                                    t.largest_age >= br.min_age &&
                                                                    t.largest_age <= br.max_age,
                                                            ),
                                                        )}
                                                        pagination={false}
                                                        loading={loading}
                                                        rowKey="id"
                                                    />
                                                )
                                            ) : hasCodes ? (
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={getExpandableColumns(scoringCodes, eventTypeKey)}
                                                    data={filterParticipants(
                                                        registrationList.filter(
                                                            (r) =>
                                                                registrationMatchesEvent(r.events_registered, evt) &&
                                                                r.age >= br.min_age &&
                                                                r.age <= br.max_age,
                                                        ),
                                                    )}
                                                    pagination={false}
                                                    loading={loading}
                                                    rowKey="user_id"
                                                />
                                            ) : (
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={getIndividualColumns(eventTypeKey)}
                                                    data={filterParticipants(
                                                        registrationList.filter(
                                                            (r) =>
                                                                registrationMatchesEvent(r.events_registered, evt) &&
                                                                r.age >= br.min_age &&
                                                                r.age <= br.max_age,
                                                        ),
                                                    )}
                                                    pagination={false}
                                                    loading={loading}
                                                    rowKey="user_id"
                                                />
                                            )}
                                            <div className="flex justify-end mt-4">
                                                <Button
                                                    type="primary"
                                                    status="success"
                                                    loading={loading}
                                                    onClick={async () => {
                                                        if (!tournamentId || !eventTypeKey) return;
                                                        setLoading(true);
                                                        try {
                                                            // Get records for all code-event combinations
                                                            const eventCodes = sanitizeEventCodes(evt.codes);
                                                            let prelimRecords: (TournamentRecord | TournamentTeamRecord)[] = [];
                                                            if (eventCodes.length > 0) {
                                                                // For events with codes, get records for each code-event combination
                                                                const recordPromises = eventCodes.map((code) => {
                                                                    const codeEventKey = `${code}-${eventTypeKey}`;
                                                                    return getPrelimRecords(tournamentId, codeEventKey);
                                                                });
                                                                const allCodeRecords = await Promise.all(recordPromises);
                                                                prelimRecords = allCodeRecords.flat();
                                                            } else {
                                                                // Fallback for events without codes
                                                                prelimRecords = await getPrelimRecords(tournamentId, eventTypeKey);
                                                            }

                                                            const participantsForBracket = registrationList.filter(
                                                                (r) =>
                                                                    registrationMatchesEvent(r.events_registered, evt) &&
                                                                    r.age >= br.min_age &&
                                                                    r.age <= br.max_age,
                                                            );
                                                            const teamsForBracket = teamScoreList.filter(
                                                                (t) =>
                                                                    teamMatchesEvent(t, evt) &&
                                                                    t.largest_age >= br.min_age &&
                                                                    t.largest_age <= br.max_age,
                                                            );
                                                            let allRecorded = false;

                                                            if (isTeamEvent) {
                                                                allRecorded = teamsForBracket.every((team) => {
                                                                    if (eventCodes.length > 0) {
                                                                        return eventCodes.every((code) =>
                                                                            prelimRecords.some(
                                                                                (record) =>
                                                                                    record.participantId === team.id &&
                                                                                    record.event === `${code}-${evt.type}`,
                                                                            ),
                                                                        );
                                                                    }
                                                                    return prelimRecords.some(
                                                                        (record) =>
                                                                            record.participantId === team.id &&
                                                                            record.event === evt.type,
                                                                    );
                                                                });
                                                            } else if (eventCodes.length > 0) {
                                                                allRecorded = participantsForBracket.every((participant) =>
                                                                    eventCodes.every((code) =>
                                                                        prelimRecords.some(
                                                                            (record) =>
                                                                                record.participantId === participant.user_id &&
                                                                                record.event === `${code}-${evt.type}`,
                                                                        ),
                                                                    ),
                                                                );
                                                            } else {
                                                                allRecorded = participantsForBracket.every((participant) =>
                                                                    prelimRecords.some(
                                                                        (record) =>
                                                                            record.participantId === participant.user_id &&
                                                                            record.event === evt.type,
                                                                    ),
                                                                );
                                                            }

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

            {/* Modal for editing records */}
            <Modal
                title={`Edit Record - ${selectedParticipant?.user_name || selectedTeam?.name || 'Unknown'}`}
                visible={modalVisible}
                onCancel={closeModal}
                footer={[
                    <Button key="cancel" onClick={closeModal}>
                        Cancel
                    </Button>,
                    <Button key="save" type="primary" loading={loading} onClick={saveModalRecord}>
                        Save Record
                    </Button>,
                ]}
                style={{ width: '800px' }}
            >
                {modalVisible && (
                    <div className="space-y-4">
                        {selectedParticipant && (
                            <div>
                                <h4 className="font-semibold mb-2">Participant: {selectedParticipant.user_name} ({selectedParticipant.user_id})</h4>
                                <p className="text-sm text-gray-600 mb-4">Event: {selectedEvent}</p>
                            </div>
                        )}

                        {selectedTeam && (
                            <div>
                                <h4 className="font-semibold mb-2">Team: {selectedTeam.name}</h4>
                                <p className="text-sm text-gray-600 mb-2">Leader: {selectedTeam.leader_id}</p>
                                <p className="text-sm text-gray-600 mb-4">Event: {selectedEvent}</p>
                            </div>
                        )}

                        {modalEventCodes.length > 0 ? (
                            // For events with multiple codes
                            <div className="space-y-6">
                                {modalEventCodes.map((code) => {
                                    const codeEventKey = `${code}-${modalBaseEventKey}`;
                                    const scores = modalScores[codeEventKey] || { try1: '', try2: '', try3: '' };

                                    return (
                                        <div key={code} className="border rounded-lg p-4">
                                            <h5 className="font-semibold mb-3">{code}</h5>
                                            <div className="grid grid-cols-4 gap-4 items-center">
                                                <div>
                                                    <label className="block text-sm font-medium mb-1">Try 1</label>
                                                    <InputNumber
                                                        placeholder="First try"
                                                        value={scores.try1 === "" ? undefined : Number.parseFloat(scores.try1)}
                                                        onChange={(val) =>
                                                            handleModalScoreChange(
                                                                codeEventKey,
                                                                "try1",
                                                                val === undefined || val === null ? "" : String(val),
                                                            )
                                                        }
                                                        precision={3}
                                                        min={0}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1">Try 2</label>
                                                    <InputNumber
                                                        placeholder="Second try"
                                                        value={scores.try2 === "" ? undefined : Number.parseFloat(scores.try2)}
                                                        onChange={(val) =>
                                                            handleModalScoreChange(
                                                                codeEventKey,
                                                                "try2",
                                                                val === undefined || val === null ? "" : String(val),
                                                            )
                                                        }
                                                        precision={3}
                                                        min={0}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1">Try 3</label>
                                                    <InputNumber
                                                        placeholder="Third try"
                                                        value={scores.try3 === "" ? undefined : Number.parseFloat(scores.try3)}
                                                        onChange={(val) =>
                                                            handleModalScoreChange(
                                                                codeEventKey,
                                                                "try3",
                                                                val === undefined || val === null ? "" : String(val),
                                                            )
                                                        }
                                                        precision={3}
                                                        min={0}
                                                        style={{ width: '100%' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1">Best Time</label>
                                                    <div className="p-2 bg-gray-100 rounded text-center">
                                                        {scores ? getBestTime(scores) : "N/A"}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            // For events without codes
                            <div className="border rounded-lg p-4">
                                <h5 className="font-semibold mb-3">{modalBaseEventKey}</h5>
                                <div className="grid grid-cols-4 gap-4 items-center">
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Try 1</label>
                                        <InputNumber
                                            placeholder="First try"
                                            value={modalScores[modalBaseEventKey]?.try1 === "" ? undefined : Number.parseFloat(modalScores[modalBaseEventKey]?.try1 || "")}
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try1",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Try 2</label>
                                        <InputNumber
                                            placeholder="Second try"
                                            value={modalScores[modalBaseEventKey]?.try2 === "" ? undefined : Number.parseFloat(modalScores[modalBaseEventKey]?.try2 || "")}
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try2",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Try 3</label>
                                        <InputNumber
                                            placeholder="Third try"
                                            value={modalScores[modalBaseEventKey]?.try3 === "" ? undefined : Number.parseFloat(modalScores[modalBaseEventKey]?.try3 || "")}
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try3",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{ width: '100%' }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Best Time</label>
                                        <div className="p-2 bg-gray-100 rounded text-center">
                                            {modalScores[modalBaseEventKey] ? getBestTime(modalScores[modalBaseEventKey]) : "N/A"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Modal>
        </div>
    );
}
