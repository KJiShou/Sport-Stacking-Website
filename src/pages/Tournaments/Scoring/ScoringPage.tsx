import type {ParticipantScore, Score, Team, TeamMember, TeamScore, Tournament, TournamentEvent} from "@/schema";
import type {TournamentOverallRecord, TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {TournamentOverallRecordSchema, TournamentRecordSchema, TournamentTeamRecordSchema} from "@/schema/RecordSchema";
import {getUserByGlobalId} from "@/services/firebase/authService";
import {
    getBestRecords,
    getPrelimRecords,
    getTournamentPrelimRecords,
    saveOverallRecord,
    saveRecord,
    saveTeamRecord,
    updateParticipantRankingsAndResults,
} from "@/services/firebase/recordService";
import {fetchApprovedRegistrations, fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {formatTeamLeaderId, stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {
    getEventKey,
    getEventLabel,
    getEventTypeOrderIndex,
    getTeamEvents,
    getTeamMaxAge,
    isScoreTrackedEvent,
    matchesAnyEventKey,
    sanitizeEventCodes,
    teamMatchesEventKey,
} from "@/utils/tournament/eventUtils";
import {Button, Input, InputNumber, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch, IconUndo} from "@arco-design/web-react/icon";
import {useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";

const {Title} = Typography;
const {TabPane} = Tabs;

const isTeamTournamentRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    "team_id" in record;

const isIndividualTournamentRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentRecord =>
    "participant_id" in record;

/**
 * Helper function to determine age group based on participant age
 */
const getAgeGroup = (age: number): string => {
    if (age <= 6) return "6U";
    if (age <= 8) return "8U";
    if (age <= 10) return "10U";
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    if (age <= 17) return "17U";
    return "Open";
};

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

/**
 * Helper function to check if new record beats the current best record for the participant's age
 */
const checkAndNotifyNewRecord = async (bestTime: number, participantAge: number, eventType: string, code?: string) => {
    try {
        const bestRecords = await getBestRecords();
        const ageGroup = getAgeGroup(participantAge);

        // Get records for Individual category and the specific event type
        const eventKey = code || eventType;
        const records = bestRecords.Individual?.[eventKey as "3-3-3" | "3-6-3" | "Cycle"];

        if (!records || records.length === 0) {
            return; // No existing records to compare
        }

        // Filter records by the same age
        const ageRecords = records.filter((r) => r.age === participantAge);

        if (ageRecords.length === 0) {
            return; // No records for this specific age
        }

        // Get the best time for this age
        const currentBestRecord = ageRecords[0]; // Records are already sorted by time
        const currentBestTime =
            typeof currentBestRecord.time === "number" ? currentBestRecord.time : Number(currentBestRecord.time);
        // Check if new time beats the current best
        if (bestTime < currentBestTime) {
            const timeDifference = (currentBestTime - bestTime).toFixed(3);

            Modal.info({
                title: "Potential New Record!",
                content: (
                    <div>
                        <p style={{marginBottom: "1rem"}}>
                            This time ({bestTime.toFixed(3)}s) beats our current best record for age {participantAge}(
                            {currentBestTime.toFixed(3)}s) by {timeDifference}s!
                        </p>
                        <p style={{marginBottom: "1rem"}}>
                            Please verify if this time also beats the world record for age group <strong>{ageGroup}</strong>.
                        </p>
                        <p>
                            <a
                                href="https://issf.online/en/Records/"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{color: "#165DFF", textDecoration: "underline"}}
                            >
                                Check World Records →
                            </a>
                        </p>
                    </div>
                ),
                okText: "Got it",
            });
        }
    } catch (error) {
        console.error("Error checking records:", error);
        // Don't show error to user, just log it
    }
};

export default function ScoringPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[] | null>(null);
    const [registrationList, setRegistrationList] = useState<ParticipantScore[]>([]);
    const [teamScoreList, setTeamScoreList] = useState<TeamScore[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState<string>("");
    const mountedRef = useRef(false);
    const sortedEvents = [...(events ?? [])].sort((a, b) => {
        const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
        if (orderDiff !== 0) return orderDiff;
        return a.type.localeCompare(b.type);
    });

    // Modal state
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<ParticipantScore | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<TeamScore | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<string>("");
    const [modalScores, setModalScores] = useState<Record<string, Score>>({});

    const registrationMatchesEvent = (
        eventsRegistered: string[] | undefined,
        event: TournamentEvent | null | undefined,
        participantGender?: string,
    ): boolean => {
        const normalizedEvents = eventsRegistered ?? [];

        if (!event || normalizedEvents.length === 0) {
            return false;
        }

        if (!isGenderEligible(participantGender, event.gender)) {
            return false;
        }

        if (matchesAnyEventKey(normalizedEvents, event)) {
            return true;
        }

        const normalizedRegistered = normalizedEvents
            .filter((value): value is string => typeof value === "string")
            .map((value) => value.trim().toLowerCase())
            .filter((value) => value.length > 0);

        if (normalizedRegistered.includes(event.type.toLowerCase())) {
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
        const tournamentEvents = events ?? [];
        return teamMatchesEventKey(team, getEventKey(event), tournamentEvents);
    };

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            const tournamentEvents = await fetchTournamentEvents(tournamentId);
            const scoringEvents = tournamentEvents.filter((event) => isScoreTrackedEvent(event));
            setEvents(scoringEvents);
            if (scoringEvents?.[0]) {
                const sortedTournamentEvents = [...scoringEvents].sort((a, b) => {
                    const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                    if (orderDiff !== 0) return orderDiff;
                    return a.type.localeCompare(b.type);
                });
                const firstEvent = sortedTournamentEvents[0];
                const firstEventTabKey = firstEvent.id ?? firstEvent.type;
                setCurrentEventTab(firstEventTabKey);
                if (firstEvent.age_brackets?.[0]) {
                    setCurrentBracketTab(firstEvent.age_brackets[0].name);
                }
            }
            const [regs, teams, records] = await Promise.all([
                fetchApprovedRegistrations(tournamentId),
                fetchTeamsByTournament(tournamentId),
                getTournamentPrelimRecords(tournamentId),
            ]);
            setTeamScoreList(
                teams
                    .filter((team) => {
                        if (!isTeamFullyVerified(team)) {
                            return false;
                        }
                        const leaderId = stripTeamLeaderPrefix(team.leader_id);
                        return regs.some((r) => r.user_global_id === leaderId || r.user_id === leaderId);
                    })
                    .map((team) => {
                        const teamScores: Record<string, Score> = {};
                        const resolvedEvents = getTeamEvents(team, scoringEvents);
                        const leaderId = stripTeamLeaderPrefix(team.leader_id);

                        if (resolvedEvents.length > 0) {
                            for (const event of resolvedEvents) {
                                const eventType = event.type;
                                const eventId = event.id;
                                const eventCodes = sanitizeEventCodes(event.codes);

                                if (eventCodes.length > 0) {
                                    for (const code of eventCodes) {
                                        const codeEventKey = `${code}-${eventType}`;
                                        const record = records.find(
                                            (rec) =>
                                                isTeamTournamentRecord(rec) &&
                                                stripTeamLeaderPrefix(rec.leader_id) === leaderId &&
                                                rec.event === eventType &&
                                                rec.code === code &&
                                                (eventId ? rec.event_id === eventId : true),
                                        );

                                        teamScores[codeEventKey] = {
                                            try1: record?.try1?.toString() || "",
                                            try2: record?.try2?.toString() || "",
                                            try3: record?.try3?.toString() || "",
                                            recordId: record?.id,
                                        };
                                    }
                                } else {
                                    const eventKey = getEventKey(event);
                                    const record = records.find(
                                        (rec) =>
                                            isTeamTournamentRecord(rec) &&
                                            stripTeamLeaderPrefix(rec.leader_id) === leaderId &&
                                            rec.event === eventKey &&
                                            (eventId ? rec.event_id === eventId : true),
                                    );
                                    teamScores[eventKey] = {
                                        try1: record?.try1?.toString() || "",
                                        try2: record?.try2?.toString() || "",
                                        try3: record?.try3?.toString() || "",
                                        recordId: record?.id,
                                    };
                                }
                            }
                        } else {
                            const fallbackKeys = team.event_id ?? "";

                            for (const fallbackKey of fallbackKeys) {
                                const record = records.find(
                                    (rec) =>
                                        isTeamTournamentRecord(rec) &&
                                        stripTeamLeaderPrefix(rec.leader_id) === leaderId &&
                                        rec.event === fallbackKey,
                                );
                                teamScores[fallbackKey] = {
                                    try1: record?.try1?.toString() || "",
                                    try2: record?.try2?.toString() || "",
                                    try3: record?.try3?.toString() || "",
                                    recordId: record?.id,
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
                    for (const event of scoringEvents ?? []) {
                        if (!registrationMatchesEvent(r.events_registered, event, r.gender)) {
                            continue;
                        }

                        const eventType = event.type;
                        const eventId = event.id;
                        augmentedEvents.add(eventType);
                        const eventCodes = sanitizeEventCodes(event.codes);

                        if (eventCodes.length > 0) {
                            for (const code of eventCodes) {
                                const codeEventKey = `${code}-${eventType}`;
                                const record = records.find(
                                    (rec) =>
                                        isIndividualTournamentRecord(rec) &&
                                        rec.participant_id === r.user_id &&
                                        rec.event === eventType &&
                                        rec.code === code &&
                                        (eventId ? rec.event_id === eventId : true),
                                );
                                participantScores[codeEventKey] = {
                                    try1: record?.try1?.toString() || "",
                                    try2: record?.try2?.toString() || "",
                                    try3: record?.try3?.toString() || "",
                                    recordId: record?.id,
                                };
                            }
                        } else {
                            const record = records.find(
                                (rec) =>
                                    isIndividualTournamentRecord(rec) &&
                                    rec.participant_id === r.user_id &&
                                    rec.event === eventType &&
                                    (eventId ? rec.event_id === eventId : true),
                            );
                            participantScores[eventType] = {
                                try1: record?.try1?.toString() || "",
                                try2: record?.try2?.toString() || "",
                                try3: record?.try3?.toString() || "",
                                recordId: record?.id,
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

    // Helper function to validate a single score object
    const validateScoreFields = (
        scores: Score | undefined,
        label: string,
        participantName: string,
        participantId: string,
    ): string[] => {
        const errors: string[] = [];
        if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
            errors.push(`${participantName} (${participantId}): Missing records for ${label}`);
        } else {
            const invalidTries: string[] = [];
            const try1 = Number.parseFloat(scores.try1);
            const try2 = Number.parseFloat(scores.try2);
            const try3 = Number.parseFloat(scores.try3);

            if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1 (must be greater than 0)");
            if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2 (must be greater than 0)");
            if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3 (must be greater than 0)");

            if (invalidTries.length > 0) {
                errors.push(`${participantName} (${participantId}): Invalid times in ${label} - ${invalidTries.join(", ")}`);
            }
        }
        return errors;
    };

    const validateParticipantRecord = (participant: ParticipantScore) => {
        const errors: string[] = [];
        const missingEvents: string[] = [];

        for (const event of events ?? []) {
            if (!registrationMatchesEvent(participant.events_registered, event, participant.gender)) {
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
                    }
                    errors.push(
                        ...validateScoreFields(scores, `${code} (${eventType})`, participant.user_name, participant.user_id),
                    );
                }
            } else {
                // For events without codes
                const scores = participant.scores[eventType];
                if (!scores || !scores.try1 || !scores.try2 || !scores.try3) {
                    missingEvents.push(eventType);
                }
                errors.push(...validateScoreFields(scores, eventType, participant.user_name, participant.user_id));
            }
        }

        if (missingEvents.length > 0) {
            errors.push(`${participant.user_name} (${participant.user_id}): Missing records for ${missingEvents.join(", ")}`);
        }

        // Remove duplicate error messages
        return Array.from(new Set(errors));
    };

    const validateTeamRecord = (team: TeamScore) => {
        const errors: string[] = [];
        const missingEvents: string[] = [];

        for (const event of events ?? []) {
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
                            errors.push(
                                `${team.name} (Leader: ${team.leader_id}): Invalid times in ${code} (${eventType}) - ${invalidTries.join(", ")}`,
                            );
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
                        errors.push(
                            `${team.name} (Leader: ${team.leader_id}): Invalid times in ${eventType} - ${invalidTries.join(", ")}`,
                        );
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
        setModalScores((prev) => ({
            ...prev,
            [eventKey]: {
                ...prev[eventKey],
                [tryNum]: value,
            },
        }));
    };

    const validateModalRecord = () => {
        const errors: string[] = [];
        const event = events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);

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

                    if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1 (must be greater than 0)");
                    if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2 (must be greater than 0)");
                    if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3 (must be greater than 0)");

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

                if (Number.isNaN(try1) || try1 <= 0) invalidTries.push("Try 1 (must be greater than 0)");
                if (Number.isNaN(try2) || try2 <= 0) invalidTries.push("Try 2 (must be greater than 0)");
                if (Number.isNaN(try3) || try3 <= 0) invalidTries.push("Try 3 (must be greater than 0)");

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
            const errorMessage = `Validation Failed:\n${validationErrors.join("\n")}`;
            Message.error(errorMessage);
            return;
        }

        setLoading(true);
        try {
            const event = events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);

            if (selectedParticipant && event) {
                const updatedModalScores: Record<string, Score> = {...modalScores};
                const submittedAt = new Date().toISOString();
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
                            const best_time = Math.min(try1, try2, try3);

                            await checkAndNotifyNewRecord(best_time, selectedParticipant.age, event.type, code);

                            const savedRecordId = await saveRecord(
                                TournamentRecordSchema.parse({
                                    id: scores.recordId ?? "",
                                    tournament_id: tournamentId,
                                    tournament_name: tournament.name,
                                    event_id: event.id ?? "",
                                    event: event.type,
                                    code,
                                    participant_id: selectedParticipant.user_id,
                                    participant_global_id: selectedParticipant.user_global_id,
                                    participant_name: selectedParticipant.user_name,
                                    age: selectedParticipant.age,
                                    country: selectedParticipant.country,
                                    gender: selectedParticipant.gender || "Male",
                                    classification: "prelim",
                                    verified_by: null,
                                    verified_at: null,
                                    try1,
                                    try2,
                                    try3,
                                    best_time,
                                    status: "submitted",
                                    submitted_at: submittedAt,
                                }),
                            );
                            updatedModalScores[codeEventKey] = {...scores, recordId: savedRecordId};
                        }
                    }
                } else {
                    // For events without codes
                    const scores = modalScores[event.type];
                    if (scores?.try1 && scores.try2 && scores.try3) {
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);
                        const best_time = Math.min(try1, try2, try3);

                        await checkAndNotifyNewRecord(best_time, selectedParticipant.age, event.type);

                        const savedRecordId = await saveRecord(
                            TournamentRecordSchema.parse({
                                id: scores.recordId ?? "",
                                tournament_id: tournamentId,
                                tournament_name: tournament.name,
                                event_id: event.id ?? "",
                                event: event.type,
                                participant_id: selectedParticipant.user_id,
                                participant_global_id: selectedParticipant.user_global_id,
                                participant_name: selectedParticipant.user_name,
                                age: selectedParticipant.age,
                                country: selectedParticipant.country,
                                gender: selectedParticipant.gender || "Male",
                                classification: "prelim",
                                verified_by: null,
                                verified_at: null,
                                try1,
                                try2,
                                try3,
                                best_time,
                                status: "submitted",
                                submitted_at: submittedAt,
                            }),
                        );
                        updatedModalScores[event.type] = {...scores, recordId: savedRecordId};
                    }
                }

                setModalScores(updatedModalScores);

                // Update the participant in the list with new scores
                const nextRegistrationList = registrationList.map((p) =>
                    p.user_id === selectedParticipant.user_id ? {...p, scores: updatedModalScores} : p,
                );
                setRegistrationList(nextRegistrationList);

                // If individual event, try to calculate overall
                if (event.type === "Individual") {
                    await calculateAndSaveOverallResults(nextRegistrationList);
                }

                Message.success(`Record saved for ${selectedParticipant.user_name}!`);
                closeModal();
            } else if (selectedTeam && event) {
                const updatedModalScores: Record<string, Score> = {...modalScores};

                // Get team leader info
                const leaderInfo = await getUserByGlobalId(stripTeamLeaderPrefix(selectedTeam.leader_id));
                const country = leaderInfo?.country?.[0] || null;
                const submittedAt = new Date().toISOString();

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

                            const savedRecordId = await saveTeamRecord(
                                TournamentTeamRecordSchema.parse({
                                    id: scores.recordId ?? "",
                                    tournament_id: tournamentId,
                                    tournament_name: tournament.name,
                                    event_id: event.id ?? "",
                                    event: event.type,
                                    code,
                                    team_id: selectedTeam.id,
                                    team_name: selectedTeam.name,
                                    age: selectedTeam.team_age,
                                    country,
                                    leader_id: selectedTeam.leader_id,
                                    member_global_ids: selectedTeam.members.map((m: TeamMember) => m.global_id),
                                    classification: "prelim",
                                    try1,
                                    try2,
                                    try3,
                                    best_time: Math.min(try1, try2, try3),
                                    status: "submitted",
                                    submitted_at: submittedAt,
                                    verified_by: null,
                                    verified_at: null,
                                }),
                            );
                            updatedModalScores[codeEventKey] = {...scores, recordId: savedRecordId};
                        }
                    }
                } else {
                    // For events without codes
                    const scores = modalScores[event.type];
                    if (scores?.try1 && scores.try2 && scores.try3) {
                        const try1 = Number.parseFloat(scores.try1);
                        const try2 = Number.parseFloat(scores.try2);
                        const try3 = Number.parseFloat(scores.try3);

                        const savedRecordId = await saveTeamRecord(
                            TournamentTeamRecordSchema.parse({
                                id: scores.recordId ?? "",
                                tournament_id: tournamentId,
                                tournament_name: tournament.name,
                                event_id: event.id ?? "",
                                event: event.type,
                                code: "",
                                team_id: selectedTeam.id,
                                team_name: selectedTeam.name,
                                age: selectedTeam.team_age,
                                country,
                                leader_id: selectedTeam.leader_id,
                                member_global_ids: selectedTeam.members.map((m: TeamMember) => m.global_id),
                                classification: "prelim",
                                try1,
                                try2,
                                try3,
                                best_time: Math.min(try1, try2, try3),
                                status: "submitted",
                                submitted_at: submittedAt,
                                verified_by: null,
                                verified_at: null,
                            }),
                        );
                        updatedModalScores[event.type] = {...scores, recordId: savedRecordId};
                    }
                }

                setModalScores(updatedModalScores);

                // Update the team in the list with new scores
                setTeamScoreList((prev) => prev.map((t) => (t.id === selectedTeam.id ? {...t, scores: updatedModalScores} : t)));

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

    const calculateAndSaveOverallResults = async (participants: ParticipantScore[]) => {
        if (!tournamentId || !tournament) return;

        const individualEvents = (events ?? []).filter(
            (e) =>
                e.type === "Individual" && e.codes?.includes("3-3-3") && e.codes?.includes("3-6-3") && e.codes?.includes("Cycle"),
        );

        if (individualEvents.length === 0) return;

        try {
            let savedCount = 0;

            for (const individualEvent of individualEvents) {
                // Get all individual participants who have completed all three events
                const individualParticipants = participants.filter(
                    (p) =>
                        registrationMatchesEvent(p.events_registered, individualEvent, p.gender) &&
                        p.scores["3-3-3-Individual"] &&
                        p.scores["3-3-3-Individual"].try1 &&
                        p.scores["3-3-3-Individual"].try2 &&
                        p.scores["3-3-3-Individual"].try3 &&
                        p.scores["3-6-3-Individual"] &&
                        p.scores["3-6-3-Individual"].try1 &&
                        p.scores["3-6-3-Individual"].try2 &&
                        p.scores["3-6-3-Individual"].try3 &&
                        p.scores["Cycle-Individual"] &&
                        p.scores["Cycle-Individual"].try1 &&
                        p.scores["Cycle-Individual"].try2 &&
                        p.scores["Cycle-Individual"].try3,
                );

                // Calculate overall results and save them
                const overallPromises = individualParticipants.map(async (p) => {
                    const threeScores = p.scores["3-3-3-Individual"];
                    const threeSixThreeScores = p.scores["3-6-3-Individual"];
                    const cycleScores = p.scores["Cycle-Individual"];

                    // Get best times for each event
                    const threeBest = Math.min(
                        Number.parseFloat(threeScores.try1),
                        Number.parseFloat(threeScores.try2),
                        Number.parseFloat(threeScores.try3),
                    );
                    const threeSixThreeBest = Math.min(
                        Number.parseFloat(threeSixThreeScores.try1),
                        Number.parseFloat(threeSixThreeScores.try2),
                        Number.parseFloat(threeSixThreeScores.try3),
                    );
                    const cycleBest = Math.min(
                        Number.parseFloat(cycleScores.try1),
                        Number.parseFloat(cycleScores.try2),
                        Number.parseFloat(cycleScores.try3),
                    );

                    // Calculate overall time (sum of best times)
                    const overallTime = threeBest + threeSixThreeBest + cycleBest;

                    // Save overall record using TournamentOverallRecordSchema
                    const recordId = await saveOverallRecord(
                        TournamentOverallRecordSchema.parse({
                            id: "",
                            tournament_id: tournamentId,
                            tournament_name: tournament.name,
                            event_id: individualEvent.id ?? "",
                            event: "Individual",
                            code: "Overall",
                            participant_id: p.user_id,
                            participant_global_id: p.user_global_id,
                            participant_name: p.user_name,
                            age: p.age,
                            country: p.country,
                            gender: p.gender || "Male",
                            three_three_three: threeBest,
                            three_six_three: threeSixThreeBest,
                            cycle: cycleBest,
                            overall_time: overallTime,
                            classification: "prelim",
                            status: "submitted",
                            submitted_at: new Date().toISOString(),
                        }),
                    );
                    return {participantId: p.user_id, recordId, overallTime};
                });

                const overallResults = await Promise.all(overallPromises);
                savedCount += overallResults.length;
            }

            if (savedCount > 0) {
                Message.success(`Calculated and saved ${savedCount} overall results!`);
            }
        } catch (error) {
            console.error("Failed to calculate overall results:", error);
            Message.error("Failed to calculate overall results.");
        }
    };

    if (!tournament) return null;

    const modalEvent = events?.find((e) => e.id === selectedEvent || e.type === selectedEvent);
    const modalEventCodes = modalEvent?.codes ?? [];
    const modalBaseEventKey = modalEvent?.type ?? selectedEvent;

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
                stripTeamLeaderPrefix(t.leader_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.members.some((m) => m.global_id.toLowerCase().includes(searchTerm.toLowerCase())),
        );
    };

    const getExpandableColumns = (codes: string[], eventId: string, eventType: string): TableColumnProps<ParticipantScore>[] => [
        {title: "Global ID", dataIndex: "user_global_id", width: 150},
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
                const isComplete = codes.every((code) => {
                    const codeEventKey = `${code}-${eventType}`;
                    const scores = record.scores[codeEventKey];
                    return scores?.try1 && scores?.try2 && scores?.try3;
                });
                return <span style={{color: isComplete ? "green" : "orange"}}>{isComplete ? "Complete" : "Incomplete"}</span>;
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => openModal(record, null, eventId)}>
                    Edit
                </Button>
            ),
        },
    ];

    const getTeamExpandableColumns = (codes: string[], eventId: string, eventType: string): TableColumnProps<TeamScore>[] => [
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 150,
            render: (_, record) => formatTeamLeaderId(record.leader_id, eventType),
        },
        {
            title: "Members",
            dataIndex: "members",
            width: 200,
            render: (members: TeamMember[], record) => {
                const leaderId = stripTeamLeaderPrefix(record.leader_id);
                const ids = [leaderId, ...members.map((m) => m.global_id)].filter(Boolean);
                const uniqueIds = Array.from(new Set(ids));
                return (
                    <div>
                        {uniqueIds.map((memberId) => (
                            <div key={memberId}>{memberId}</div>
                        ))}
                    </div>
                );
            },
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
                const isComplete = codes.every((code) => {
                    const codeEventKey = `${code}-${eventType}`;
                    const scores = record.scores[codeEventKey];
                    return scores?.try1 && scores?.try2 && scores?.try3;
                });
                return <span style={{color: isComplete ? "green" : "orange"}}>{isComplete ? "Complete" : "Incomplete"}</span>;
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => openModal(null, record, eventId)}>
                    Edit
                </Button>
            ),
        },
    ];

    const getIndividualColumns = (eventId: string, eventType: string): TableColumnProps<ParticipantScore>[] => [
        {title: "Global ID", dataIndex: "user_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {
            title: "Status",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventType];
                const isComplete = scores?.try1 && scores?.try2 && scores?.try3;
                return <span style={{color: isComplete ? "green" : "orange"}}>{isComplete ? "Complete" : "Incomplete"}</span>;
            },
        },
        {
            title: "Best Time",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventType];
                return <span>{scores ? getBestTime(scores) : "N/A"}</span>;
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => openModal(record, null, eventId)}>
                    Edit
                </Button>
            ),
        },
    ];

    const getTeamColumns = (eventId: string, eventType: string): TableColumnProps<TeamScore>[] => [
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 150,
            render: (_, record) => formatTeamLeaderId(record.leader_id, eventType),
        },
        {
            title: "Members",
            dataIndex: "members",
            width: 200,
            render: (members: TeamMember[], record) => {
                const leaderId = stripTeamLeaderPrefix(record.leader_id);
                const ids = [leaderId, ...members.map((m) => m.global_id)].filter(Boolean);
                const uniqueIds = Array.from(new Set(ids));
                return (
                    <div>
                        {uniqueIds.map((memberId) => (
                            <div key={memberId}>{memberId}</div>
                        ))}
                    </div>
                );
            },
        },
        {
            title: "Status",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventType];
                const isComplete = scores?.try1 && scores?.try2 && scores?.try3;
                return <span style={{color: isComplete ? "green" : "orange"}}>{isComplete ? "Complete" : "Incomplete"}</span>;
            },
        },
        {
            title: "Best Time",
            width: 120,
            render: (_, record) => {
                const scores = record.scores[eventType];
                return <span>{scores ? getBestTime(scores) : "N/A"}</span>;
            },
        },
        {
            title: "Action",
            width: 100,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => openModal(null, record, eventId)}>
                    Edit
                </Button>
            ),
        },
    ];

    const currentEvent = events?.find((evt) => evt.id === currentEventTab || evt.type === currentEventTab);

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
                        const event = events?.find((e) => e.id === key || e.type === key);
                        if (event?.age_brackets?.[0]) {
                            setCurrentBracketTab(event.age_brackets[0].name);
                        }
                    }}
                >
                    {sortedEvents.map((evt) => {
                        const tabKey = evt.id ?? evt.type;
                        const eventTypeKey = evt.type;
                        const eventIdForModal = evt.id ?? evt.type; // Use event ID for modal
                        const isTeamEvent = ["double", "team relay", "parent & child"].includes(evt.type.toLowerCase());
                        const scoringCodes = sanitizeEventCodes(evt.codes);
                        const hasCodes = scoringCodes.length > 0;
                        return (
                            <TabPane key={tabKey} title={getEventLabel(evt)}>
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
                                                        columns={getTeamExpandableColumns(
                                                            scoringCodes,
                                                            eventIdForModal,
                                                            eventTypeKey,
                                                        )}
                                                        data={filterTeams(
                                                            teamScoreList.filter((t) => {
                                                                const teamAge = getTeamMaxAge(t);
                                                                return (
                                                                    teamMatchesEvent(t, evt) &&
                                                                    teamAge !== undefined &&
                                                                    teamAge >= br.min_age &&
                                                                    teamAge <= br.max_age
                                                                );
                                                            }),
                                                        )}
                                                        pagination={false}
                                                        loading={loading}
                                                        rowKey="id"
                                                    />
                                                ) : (
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={getTeamColumns(eventIdForModal, eventTypeKey)}
                                                        data={filterTeams(
                                                            teamScoreList.filter((t) => {
                                                                const teamAge = getTeamMaxAge(t);
                                                                return (
                                                                    teamMatchesEvent(t, evt) &&
                                                                    teamAge !== undefined &&
                                                                    teamAge >= br.min_age &&
                                                                    teamAge <= br.max_age
                                                                );
                                                            }),
                                                        )}
                                                        pagination={false}
                                                        loading={loading}
                                                        rowKey="id"
                                                    />
                                                )
                                            ) : hasCodes ? (
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={getExpandableColumns(scoringCodes, eventIdForModal, eventTypeKey)}
                                                    data={filterParticipants(
                                                        registrationList.filter(
                                                            (r) =>
                                                                registrationMatchesEvent(r.events_registered, evt, r.gender) &&
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
                                                    columns={getIndividualColumns(eventIdForModal, eventTypeKey)}
                                                    data={filterParticipants(
                                                        registrationList.filter(
                                                            (r) =>
                                                                registrationMatchesEvent(r.events_registered, evt, r.gender) &&
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
                                                        if (!tournamentId) return;
                                                        setLoading(true);
                                                        try {
                                                            // Validate current event (all brackets) before allowing completion
                                                            const validationErrors: string[] = [];

                                                            // Get all preliminary records once
                                                            const allPrelimRecords =
                                                                await getTournamentPrelimRecords(tournamentId);

                                                            const event = evt;
                                                            const eventType = event.type;
                                                            const eventId = event.id;
                                                            const eventCodes = sanitizeEventCodes(event.codes);
                                                            const isTeamEventType = [
                                                                "double",
                                                                "team relay",
                                                                "parent & child",
                                                            ].includes(eventType.toLowerCase());

                                                            // Check every age bracket within current event
                                                            for (const bracket of event.age_brackets) {
                                                                if (isTeamEventType) {
                                                                    // Validate team events
                                                                    const teamsForBracket = teamScoreList.filter((t) => {
                                                                        const teamAge = getTeamMaxAge(t);
                                                                        return (
                                                                            teamMatchesEvent(t, event) &&
                                                                            teamAge !== undefined &&
                                                                            teamAge >= bracket.min_age &&
                                                                            teamAge <= bracket.max_age
                                                                        );
                                                                    });

                                                                    for (const team of teamsForBracket) {
                                                                        if (eventCodes.length > 0) {
                                                                            // Check each code
                                                                            for (const code of eventCodes) {
                                                                                const hasRecord = allPrelimRecords.some(
                                                                                    (record) =>
                                                                                        isTeamTournamentRecord(record) &&
                                                                                        record.team_id === team.id &&
                                                                                        (eventId
                                                                                            ? record.event_id === eventId
                                                                                            : record.event === eventType) &&
                                                                                        record.code === code,
                                                                                );
                                                                                if (!hasRecord) {
                                                                                    validationErrors.push(
                                                                                        `Team "${team.name}" missing ${code} record for ${eventType} (${bracket.name})`,
                                                                                    );
                                                                                }
                                                                            }
                                                                        } else {
                                                                            // No codes, just check event
                                                                            const hasRecord = allPrelimRecords.some(
                                                                                (record) =>
                                                                                    isTeamTournamentRecord(record) &&
                                                                                    record.team_id === team.id &&
                                                                                    (eventId
                                                                                        ? record.event_id === eventId
                                                                                        : record.event === eventType),
                                                                            );
                                                                            if (!hasRecord) {
                                                                                validationErrors.push(
                                                                                    `Team "${team.name}" missing record for ${eventType} (${bracket.name})`,
                                                                                );
                                                                            }
                                                                        }
                                                                    }
                                                                } else {
                                                                    // Validate individual events
                                                                    const participantsForBracket = registrationList.filter(
                                                                        (r) =>
                                                                            registrationMatchesEvent(
                                                                                r.events_registered,
                                                                                event,
                                                                                r.gender,
                                                                            ) &&
                                                                            r.age >= bracket.min_age &&
                                                                            r.age <= bracket.max_age,
                                                                    );

                                                                    for (const participant of participantsForBracket) {
                                                                        if (eventCodes.length > 0) {
                                                                            // Check each code
                                                                            for (const code of eventCodes) {
                                                                                const hasRecord = allPrelimRecords.some(
                                                                                    (record) =>
                                                                                        isIndividualTournamentRecord(record) &&
                                                                                        record.participant_id ===
                                                                                            participant.user_id &&
                                                                                        (eventId
                                                                                            ? record.event_id === eventId
                                                                                            : record.event === eventType) &&
                                                                                        record.code === code,
                                                                                );
                                                                                if (!hasRecord) {
                                                                                    validationErrors.push(
                                                                                        `${participant.user_name} (${participant.user_global_id}) missing ${code} record for ${eventType} (${bracket.name})`,
                                                                                    );
                                                                                }
                                                                            }
                                                                        } else {
                                                                            // No codes, just check event
                                                                            const hasRecord = allPrelimRecords.some(
                                                                                (record) =>
                                                                                    isIndividualTournamentRecord(record) &&
                                                                                    record.participant_id ===
                                                                                        participant.user_id &&
                                                                                    (eventId
                                                                                        ? record.event_id === eventId
                                                                                        : record.event === eventType),
                                                                            );
                                                                            if (!hasRecord) {
                                                                                validationErrors.push(
                                                                                    `${participant.user_name} (${participant.user_global_id}) missing record for ${eventType} (${bracket.name})`,
                                                                                );
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }

                                                            // If there are validation errors, show them

                                                            if (validationErrors.length > 0) {
                                                                for (const error of validationErrors) {
                                                                    const errorMessage = `Cannot complete preliminary round for ${eventType}. Missing records:\n${error}`;
                                                                    Message.error(errorMessage);
                                                                }
                                                                setLoading(false);
                                                                return;
                                                            }

                                                            // All records are complete, proceed
                                                            try {
                                                                await updateParticipantRankingsAndResults(tournamentId, "prelim");
                                                                Message.success(
                                                                    "Participant rankings and results updated successfully!",
                                                                );
                                                            } catch (updateError) {
                                                                console.error("Error updating rankings:", updateError);
                                                                Message.warning("Records saved but failed to update rankings.");
                                                            }
                                                            navigate(`/tournaments/${tournamentId}/record/prelim`);
                                                        } catch (error) {
                                                            console.error("Failed to check records:", error);
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
                title={`Edit Record - ${selectedParticipant?.user_name || selectedTeam?.name || "Unknown"}`}
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
                style={{width: "800px"}}
            >
                {modalVisible && (
                    <div className="space-y-4">
                        {selectedParticipant && (
                            <div>
                                <h4 className="font-semibold mb-2">
                                    Participant: {selectedParticipant.user_name} ({selectedParticipant.user_global_id})
                                </h4>
                            </div>
                        )}

                        {selectedTeam && (
                            <div>
                                <h4 className="font-semibold mb-2">Team: {selectedTeam.name}</h4>
                                <p className="text-sm text-gray-600 mb-2">
                                    Leader: {formatTeamLeaderId(selectedTeam.leader_id, currentEvent?.type)}
                                </p>
                            </div>
                        )}

                        {modalEventCodes.length > 0 ? (
                            // For events with multiple codes
                            <div className="space-y-6">
                                {modalEventCodes.map((code) => {
                                    const codeEventKey = `${code}-${modalBaseEventKey}`;
                                    const scores = modalScores[codeEventKey] || {try1: "", try2: "", try3: ""};
                                    const try1Id = `${codeEventKey}-try1`;
                                    const try2Id = `${codeEventKey}-try2`;
                                    const try3Id = `${codeEventKey}-try3`;

                                    return (
                                        <div key={code} className="border rounded-lg p-4">
                                            <h5 className="font-semibold mb-3">{code}</h5>
                                            <div className="grid grid-cols-4 gap-4 items-center">
                                                <div>
                                                    <label className="block text-sm font-medium mb-1" htmlFor={try1Id}>
                                                        Try 1
                                                    </label>
                                                    <InputNumber
                                                        id={try1Id}
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
                                                        style={{width: "100%"}}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1" htmlFor={try2Id}>
                                                        Try 2
                                                    </label>
                                                    <InputNumber
                                                        id={try2Id}
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
                                                        style={{width: "100%"}}
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium mb-1" htmlFor={try3Id}>
                                                        Try 3
                                                    </label>
                                                    <InputNumber
                                                        id={try3Id}
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
                                                        style={{width: "100%"}}
                                                    />
                                                </div>
                                                <div>
                                                    <span className="block text-sm font-medium mb-1">Best Time</span>
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
                                        <label className="block text-sm font-medium mb-1" htmlFor={`${modalBaseEventKey}-try1`}>
                                            Try 1
                                        </label>
                                        <InputNumber
                                            id={`${modalBaseEventKey}-try1`}
                                            placeholder="First try"
                                            value={
                                                modalScores[modalBaseEventKey]?.try1 === ""
                                                    ? undefined
                                                    : Number.parseFloat(modalScores[modalBaseEventKey]?.try1 || "")
                                            }
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try1",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{width: "100%"}}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1" htmlFor={`${modalBaseEventKey}-try2`}>
                                            Try 2
                                        </label>
                                        <InputNumber
                                            id={`${modalBaseEventKey}-try2`}
                                            placeholder="Second try"
                                            value={
                                                modalScores[modalBaseEventKey]?.try2 === ""
                                                    ? undefined
                                                    : Number.parseFloat(modalScores[modalBaseEventKey]?.try2 || "")
                                            }
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try2",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{width: "100%"}}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium mb-1" htmlFor={`${modalBaseEventKey}-try3`}>
                                            Try 3
                                        </label>
                                        <InputNumber
                                            id={`${modalBaseEventKey}-try3`}
                                            placeholder="Third try"
                                            value={
                                                modalScores[modalBaseEventKey]?.try3 === ""
                                                    ? undefined
                                                    : Number.parseFloat(modalScores[modalBaseEventKey]?.try3 || "")
                                            }
                                            onChange={(val) =>
                                                handleModalScoreChange(
                                                    modalBaseEventKey,
                                                    "try3",
                                                    val === undefined || val === null ? "" : String(val),
                                                )
                                            }
                                            precision={3}
                                            min={0}
                                            style={{width: "100%"}}
                                        />
                                    </div>
                                    <div>
                                        <span className="block text-sm font-medium mb-1">Best Time</span>
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
