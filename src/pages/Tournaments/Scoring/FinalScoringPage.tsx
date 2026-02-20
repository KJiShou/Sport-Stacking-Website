import type {FinalistGroupPayload, Registration, Team, TeamMember, Tournament, TournamentEvent} from "@/schema";
import {
    TournamentOverallRecordSchema,
    type TournamentRecord,
    TournamentRecordSchema,
    type TournamentTeamRecord,
    TournamentTeamRecordSchema,
} from "@/schema/RecordSchema";
import {fetchTournamentFinalists} from "@/services/firebase/finalistService";
import {
    getBestRecords,
    getTournamentFinalRecords,
    saveOverallRecord,
    saveRecord,
    saveTeamRecord,
    updateParticipantRankingsAndResults,
} from "@/services/firebase/recordService";
import {fetchApprovedRegistrations, fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {formatTeamLeaderId, stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {getEventLabel, getEventTypeOrderIndex, isScoreTrackedEvent} from "@/utils/tournament/eventUtils";
import {Button, Input, InputNumber, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch, IconUndo} from "@arco-design/web-react/icon";
import {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";

const {Title} = Typography;
const {TabPane} = Tabs;
const TEAM_EVENT_TYPES = new Set(["Double", "Team Relay", "Parent & Child"]);

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
                title: "🎉 Potential New Record!",
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

export default function FinalScoringPage() {
    const navigate = useNavigate();
    const {tournamentId} = useParams<{tournamentId: string}>();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [records, setRecords] = useState<(TournamentRecord | TournamentTeamRecord)[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [finalist, setFinalist] = useState<FinalistGroupPayload[]>([]);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentEvent, setCurrentEvent] = useState<TournamentEvent | null>(null);
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("");
    const [selectedParticipant, setSelectedParticipant] = useState<Registration | null>(null);
    const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
    const [isIndividual, setIsIndividual] = useState<boolean>(true);
    const [modalState, setModalState] = useState<boolean>(false);
    const [searchTerm, setSearchTerm] = useState("");
    const mountedRef = useRef(false);
    const [modalScores, setModalScores] = useState<Record<string, {try1: string; try2: string; try3: string; id?: string}>>({});
    const sortedEvents = [...events].sort((a, b) => {
        const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
        if (orderDiff !== 0) return orderDiff;
        return a.type.localeCompare(b.type);
    });

    const refreshFinalScore = async () => {
        if (!tournamentId) return;
        setLoading(true);
        // Preserve current tab state
        const prevEventTab = currentEventTab;
        const prevBracketTab = currentBracketTab;
        const prevClassificationTab = currentClassificationTab;
        try {
            const tournament = await fetchTournamentById(tournamentId);
            setTournament(tournament);

            const events = await fetchTournamentEvents(tournamentId);
            setEvents(events.filter((event) => isScoreTrackedEvent(event)));

            const registrations = await fetchApprovedRegistrations(tournamentId);
            setRegistrations(registrations);

            const teams = await fetchTeamsByTournament(tournamentId);
            setTeams(
                teams.filter((t) => {
                    if (!isTeamFullyVerified(t)) {
                        return false;
                    }
                    const leaderId = stripTeamLeaderPrefix(t.leader_id);
                    return registrations.some((r) => r.user_global_id === leaderId || r.user_id === leaderId);
                }),
            );

            const finalists = await fetchTournamentFinalists(tournamentId);
            setFinalist(finalists);
            const recordsData = await getTournamentFinalRecords(tournamentId);
            const parsedRecords: (TournamentRecord | TournamentTeamRecord)[] = recordsData.map((record) => {
                if (TEAM_EVENT_TYPES.has(record.event)) {
                    return TournamentTeamRecordSchema.parse(record);
                }
                return TournamentRecordSchema.parse(record);
            });
            setRecords(parsedRecords);

            // Restore previous tab state if still valid, else fallback to first
            const sortedEventList = [...events].sort((a, b) => {
                const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                if (orderDiff !== 0) return orderDiff;
                return a.type.localeCompare(b.type);
            });
            const eventTabToSet =
                events.find((e) => e.id === prevEventTab || e.type === prevEventTab)?.id ||
                events.find((e) => e.id === prevEventTab || e.type === prevEventTab)?.type ||
                sortedEventList?.[0]?.id ||
                sortedEventList?.[0]?.type ||
                "";
            setCurrentEventTab(eventTabToSet);

            const eventForBracket = events.find((e) => e.id === eventTabToSet || e.type === eventTabToSet);
            const bracketTabToSet =
                eventForBracket?.age_brackets?.find((b) => b.name === prevBracketTab)?.name ||
                eventForBracket?.age_brackets?.[0]?.name ||
                "";
            setCurrentBracketTab(bracketTabToSet);

            const bracketForClass = eventForBracket?.age_brackets?.find((b) => b.name === bracketTabToSet);
            const classTabToSet =
                bracketForClass?.final_criteria?.find((fc) => fc.classification === prevClassificationTab)?.classification ||
                bracketForClass?.final_criteria?.[0]?.classification ||
                "";
            setCurrentClassificationTab(classTabToSet);
        } catch (error) {
            console.error(error);
            Message.error("Failed to refresh final scores.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!tournamentId) return;
    }, [tournamentId]);

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        refreshFinalScore();
    });

    const filterParticipants = (participants: Registration[]) => {
        if (!searchTerm.trim()) return participants;
        return participants.filter(
            (p) =>
                p.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
                p.user_name.toLowerCase().includes(searchTerm.toLowerCase()),
        );
    };

    const filterTeams = (teams: Team[]) => {
        if (!searchTerm.trim()) return teams;
        return teams.filter(
            (t) =>
                t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                stripTeamLeaderPrefix(t.leader_id).toLowerCase().includes(searchTerm.toLowerCase()) ||
                t.members.some((m) => m.global_id.toLowerCase().includes(searchTerm.toLowerCase())),
        );
    };

    const getExpandableColumns = (
        codes: string[],
        eventId: string | undefined,
        eventType: string,
    ): TableColumnProps<Registration>[] => [
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
                const isAllCodesRecorded = codes.every((code) =>
                    records.some(
                        (r) =>
                            r.event === eventType &&
                            "participant_id" in r &&
                            r.participant_id === record.user_id &&
                            r.code === code &&
                            (eventId ? r.event_id === eventId : true),
                    ),
                );

                return (
                    <span style={{color: isAllCodesRecorded ? "green" : "orange"}}>
                        {isAllCodesRecorded ? "Complete" : "Incomplete"}
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
                    onClick={() => {
                        setModalState(true);
                        setSelectedParticipant(record);
                        setIsIndividual(true);
                        // Use the actual event context where this button resides
                        const evt =
                            events.find((e) => e.id === currentEventTab) ||
                            events.find((e) => e.type === currentEventTab) ||
                            null;
                        setCurrentEvent(evt);
                        // Prefill modal scores from existing records
                        if (evt) {
                            const initial: Record<string, {try1: string; try2: string; try3: string; id?: string}> = {};
                            for (const code of evt.codes ?? []) {
                                const key = `${code}-${evt.type}`;
                                const existing = records.find(
                                    (r) =>
                                        r.event === evt.type &&
                                        r.code === code &&
                                        (r as TournamentRecord).participant_id === record.user_id &&
                                        (evt.id ? r.event_id === evt.id : true),
                                ) as TournamentRecord | undefined;
                                initial[key] = {
                                    try1: existing?.try1 != null ? String(existing.try1) : "",
                                    try2: existing?.try2 != null ? String(existing.try2) : "",
                                    try3: existing?.try3 != null ? String(existing.try3) : "",
                                    id: existing?.id,
                                };
                            }
                            setModalScores(initial);
                        } else {
                            setModalScores({});
                        }
                    }}
                >
                    Edit
                </Button>
            ),
        },
    ];

    const getTeamExpandableColumns = (
        codes: string[],
        eventId: string | undefined,
        eventType: string,
    ): TableColumnProps<Team>[] => [
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
                const isAllCodesRecorded = codes.every((code) =>
                    records.some(
                        (r) =>
                            r.event === eventType &&
                            "team_id" in r &&
                            r.team_id === record.id &&
                            r.code === code &&
                            (eventId ? r.event_id === eventId : true),
                    ),
                );

                return (
                    <span style={{color: isAllCodesRecorded ? "green" : "orange"}}>
                        {isAllCodesRecorded ? "Complete" : "Incomplete"}
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
                    onClick={() => {
                        setModalState(true);
                        setSelectedTeam(record);
                        setIsIndividual(false);
                        const evt =
                            events.find((e) => e.id === currentEventTab) ||
                            events.find((e) => e.type === currentEventTab) ||
                            null;
                        setCurrentEvent(evt);
                        // Prefill modal scores from existing team records
                        if (evt) {
                            const initial: Record<string, {try1: string; try2: string; try3: string; id?: string}> = {};
                            for (const code of evt.codes ?? []) {
                                const key = `${code}-${evt.type}`;
                                const existing = records.find(
                                    (r) =>
                                        r.event === evt.type &&
                                        r.code === code &&
                                        (r as TournamentTeamRecord).team_id === record.id &&
                                        (evt.id ? r.event_id === evt.id : true),
                                ) as TournamentTeamRecord | undefined;
                                initial[key] = {
                                    try1: existing?.try1 != null ? String(existing.try1) : "",
                                    try2: existing?.try2 != null ? String(existing.try2) : "",
                                    try3: existing?.try3 != null ? String(existing.try3) : "",
                                    id: existing?.id,
                                };
                            }
                            setModalScores(initial);
                        } else {
                            setModalScores({});
                        }
                    }}
                >
                    Edit
                </Button>
            ),
        },
    ];

    const handleModalScoreChange = (key: string, field: "try1" | "try2" | "try3", value: string) => {
        setModalScores((prev) => ({
            ...prev,
            [key]: {
                try1: prev[key]?.try1 ?? "",
                try2: prev[key]?.try2 ?? "",
                try3: prev[key]?.try3 ?? "",
                id: prev[key]?.id,
                [field]: value,
            },
        }));
    };

    const getBestTime = (scores?: {try1: string; try2: string; try3: string}): string => {
        if (!scores) return "N/A";
        const t1 = Number.parseFloat(scores.try1);
        const t2 = Number.parseFloat(scores.try2);
        const t3 = Number.parseFloat(scores.try3);
        const vals = [t1, t2, t3].filter((v) => Number.isFinite(v) && v > 0);
        if (vals.length === 0) return "N/A";
        return Math.min(...vals).toFixed(3);
    };

    const checkAllFinalistsAndNavigate = async (targetEvent: TournamentEvent) => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            type Missing = {id: string; code: string; eventType: string; eventId?: string};
            const missing: Missing[] = [];

            const getCodesForGroup = (g: FinalistGroupPayload): string[] => {
                if (g.event_code && g.event_code.length > 0) return g.event_code;
                const evtDef = events.find((e) => e.id === g.event_id) || events.find((e) => e.type === g.event_type);
                return evtDef?.codes ?? [];
            };

            const currentEventFinalists = finalist.filter((g) => {
                if (targetEvent.id && g.event_id) {
                    return g.event_id === targetEvent.id;
                }
                return g.event_type === targetEvent.type;
            });

            if (currentEventFinalists.length === 0) {
                Message.info(`No finalists found for ${getEventLabel(targetEvent)}.`);
                setLoading(false);
                return;
            }

            for (const g of currentEventFinalists) {
                const isTeam = g.participant_type === "Team";
                const codes = getCodesForGroup(g);
                const eventType = g.event_type;
                const eventId = g.event_id;

                for (const pid of g.participant_ids ?? []) {
                    for (const code of codes) {
                        const hasRecord = records.some((r) => {
                            // Check event type match
                            if (r.event !== eventType) return false;

                            // Check code match
                            if (r.code !== code) return false;

                            // Check event_id match when available (critical for duplicate event types)
                            if (eventId) {
                                if (r.event_id !== eventId) {
                                    return false;
                                }
                            }

                            // Check participant/team match
                            if (isTeam) {
                                return (r as TournamentTeamRecord).team_id === pid;
                            }
                            return (r as TournamentRecord).participant_id === pid;
                        });

                        if (!hasRecord) {
                            missing.push({id: pid, code, eventType, eventId: eventId ?? undefined});
                        }
                    }
                }
            }

            if (missing.length === 0) {
                // Update participant rankings and results for all final classifications before navigating
                try {
                    const finalClassifications: Array<"advance" | "intermediate" | "beginner"> = [
                        "advance",
                        "intermediate",
                        "beginner",
                    ];
                    // Update rankings for each classification
                    await Promise.all(
                        finalClassifications.map((classification) =>
                            updateParticipantRankingsAndResults(tournamentId, classification),
                        ),
                    );
                    Message.success(`${getEventLabel(targetEvent)} is complete. Redirecting to results…`);
                } catch (updateError) {
                    console.error("Error updating rankings:", updateError);
                    Message.warning("Records complete but failed to update some rankings.");
                }
                navigate(`/tournaments/${tournamentId}/record/final`);
            } else {
                const resolveName = (id: string, eventType: string) => {
                    const isTeamEvt = ["double", "team relay", "parent & child"].includes(eventType.toLowerCase());
                    if (isTeamEvt) {
                        const team = teams.find((t) => t.id === id);
                        return team?.name ?? id;
                    }
                    const reg = registrations.find((r) => r.user_id === id);
                    return reg ? `${reg.user_name} (${reg.user_global_id})` : id;
                };

                const getEventName = (m: Missing) => {
                    if (m.eventId) {
                        const evt = events.find((e) => e.id === m.eventId);
                        return evt ? `${evt.type} (ID: ${m.eventId.slice(0, 8)})` : m.eventType;
                    }
                    return m.eventType;
                };

                const preview = missing
                    .slice(0, 12)
                    .map((m) => `${resolveName(m.id, m.eventType)} [${m.code} - ${getEventName(m)}]`)
                    .join(", ");
                const more = missing.length > 12 ? ` and ${missing.length - 12} more` : "";
                Message.warning(`Some finalists are missing scores: ${preview}${more}`);
            }
        } catch (error) {
            console.error("Failed to check records:", error);
            Message.error("Failed to check records.");
        } finally {
            setLoading(false);
        }
    };

    const saveModalRecord = async (): Promise<void> => {
        if (!tournamentId || !currentEvent) return;
        setLoading(true);
        try {
            const now = new Date().toISOString();
            const codes = currentEvent.codes ?? [];
            // Track best times per code while saving
            const bestTimes: Partial<Record<"3-3-3" | "3-6-3" | "Cycle", number>> = {};

            // Validate all scores before saving
            const validationErrors: string[] = [];
            for (const code of codes) {
                const key = `${code}-${currentEvent.type}`;
                const scores = modalScores[key];
                if (!scores) continue;

                const t1 = scores.try1 === "" ? undefined : Number.parseFloat(scores.try1);
                const t2 = scores.try2 === "" ? undefined : Number.parseFloat(scores.try2);
                const t3 = scores.try3 === "" ? undefined : Number.parseFloat(scores.try3);

                // Check for zero or negative values
                if (t1 !== undefined && t1 <= 0) validationErrors.push(`${code} Try 1 must be greater than 0`);
                if (t2 !== undefined && t2 <= 0) validationErrors.push(`${code} Try 2 must be greater than 0`);
                if (t3 !== undefined && t3 <= 0) validationErrors.push(`${code} Try 3 must be greater than 0`);
            }

            if (validationErrors.length > 0) {
                Message.error(`Invalid times: ${validationErrors.join(", ")}`);
                setLoading(false);
                return;
            }

            for (const code of codes) {
                const key = `${code}-${currentEvent.type}`;
                const scores = modalScores[key];
                if (!scores) continue;
                const t1 = scores.try1 === "" ? undefined : Number.parseFloat(scores.try1);
                const t2 = scores.try2 === "" ? undefined : Number.parseFloat(scores.try2);
                const t3 = scores.try3 === "" ? undefined : Number.parseFloat(scores.try3);
                const numbers = [t1, t2, t3].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0);
                if (numbers.length === 0) continue; // skip empty
                const best = Math.min(...numbers);
                bestTimes[code] = best;

                if (isIndividual && selectedParticipant) {
                    // find existing record for update fields like submitted_at
                    const existing = records.find(
                        (r) =>
                            r.event === currentEvent.type &&
                            r.code === code &&
                            (r as TournamentRecord).participant_id === selectedParticipant.user_id,
                    ) as TournamentRecord | undefined;

                    const data: TournamentRecord = {
                        id: existing?.id ?? "",
                        tournament_id: tournamentId,
                        tournament_name: tournament?.name ?? null,
                        event_id: currentEvent.id ?? "",
                        event: currentEvent.type,
                        code,
                        age: selectedParticipant.age,
                        country: selectedParticipant.country,
                        best_time: best,
                        status: (existing?.status ?? "submitted") as "submitted" | "verified",
                        try1: (t1 ?? existing?.try1 ?? 0) as number,
                        try2: (t2 ?? existing?.try2 ?? 0) as number,
                        try3: (t3 ?? existing?.try3 ?? 0) as number,
                        video_url: existing?.video_url ?? null,
                        classification:
                            (currentClassificationTab as "beginner" | "intermediate" | "advance" | "prelim" | undefined) ??
                            existing?.classification ??
                            undefined,
                        submitted_at: existing?.submitted_at ?? now,
                        created_at: existing?.created_at ?? new Date().toISOString(),
                        updated_at: existing?.updated_at ?? new Date().toISOString(),
                        verified_at: existing?.verified_at ?? null,
                        verified_by: existing?.verified_by ?? null,
                        participant_id: selectedParticipant.user_id,
                        participant_global_id: selectedParticipant.user_global_id,
                        participant_name: selectedParticipant.user_name,
                        gender: selectedParticipant.gender ?? "Male",
                    };

                    await saveRecord(TournamentRecordSchema.parse(data));

                    // Check if this beats the current best record
                    await checkAndNotifyNewRecord(best, selectedParticipant.age, currentEvent.type, code);
                }

                if (!isIndividual && selectedTeam) {
                    const existing = records.find(
                        (r) =>
                            r.event === currentEvent.type &&
                            r.code === code &&
                            (r as TournamentTeamRecord).team_id === selectedTeam.id,
                    ) as TournamentTeamRecord | undefined;

                    // Get leader's country from registrations
                    const leaderRegistration = registrations.find(
                        (r) => r.user_global_id === stripTeamLeaderPrefix(selectedTeam.leader_id),
                    );
                    const teamCountry = leaderRegistration?.country ?? null;

                    const data: TournamentTeamRecord = {
                        id: existing?.id ?? "",
                        tournament_id: tournamentId,
                        tournament_name: tournament?.name ?? null,
                        event_id: currentEvent.id ?? "",
                        event: currentEvent.type,
                        code,
                        age: selectedTeam.team_age ?? null,
                        country: teamCountry,
                        best_time: best,
                        status: (existing?.status ?? "submitted") as "submitted" | "verified",
                        try1: (t1 ?? existing?.try1 ?? 0) as number,
                        try2: (t2 ?? existing?.try2 ?? 0) as number,
                        try3: (t3 ?? existing?.try3 ?? 0) as number,
                        video_url: existing?.video_url ?? null,
                        classification:
                            (currentClassificationTab as "beginner" | "intermediate" | "advance" | "prelim" | undefined) ??
                            existing?.classification ??
                            undefined,
                        submitted_at: existing?.submitted_at ?? now,
                        created_at: existing?.created_at ?? new Date().toISOString(),
                        updated_at: existing?.updated_at ?? new Date().toISOString(),
                        verified_at: existing?.verified_at ?? null,
                        verified_by: existing?.verified_by ?? null,
                        team_id: selectedTeam.id,
                        team_name: selectedTeam.name,
                        member_global_ids: selectedTeam.members?.map((m) => m.global_id) ?? [],
                        leader_id: selectedTeam.leader_id ?? null,
                    };

                    await saveTeamRecord(TournamentTeamRecordSchema.parse(data));
                }
            }

            // After saving individual code records, create/update overall record for Individual finals
            if (
                isIndividual &&
                selectedParticipant &&
                (currentEvent.type === "Individual" || currentEvent.type === "Open Age Individual") &&
                (["3-3-3", "3-6-3", "Cycle"] as const).every((c) => new Set(currentEvent.codes ?? []).has(c))
            ) {
                // Ensure we have best times for all three codes from modal, otherwise try to derive from existing records
                const needCodes: Array<"3-3-3" | "3-6-3" | "Cycle"> = ["3-3-3", "3-6-3", "Cycle"];
                for (const c of needCodes) {
                    if (bestTimes[c] == null) {
                        const existing = records.find(
                            (r) =>
                                r.event === currentEvent.type &&
                                r.code === c &&
                                (r as TournamentRecord).participant_id === selectedParticipant.user_id,
                        ) as TournamentRecord | undefined;
                        if (existing) {
                            const vals = [existing.try1, existing.try2, existing.try3].filter(
                                (v): v is number => typeof v === "number" && Number.isFinite(v),
                            );
                            if (vals.length > 0) bestTimes[c] = Math.min(...vals);
                        }
                    }
                }

                if (needCodes.every((c) => typeof bestTimes[c] === "number")) {
                    const threeBest = bestTimes["3-3-3"] as number;
                    const threeSixThreeBest = bestTimes["3-6-3"] as number;
                    const cycleBest = bestTimes.Cycle as number;
                    const overallTime = threeBest + threeSixThreeBest + cycleBest;

                    await saveOverallRecord(
                        TournamentOverallRecordSchema.parse({
                            id: "",
                            tournament_id: tournamentId,
                            tournament_name: tournament?.name ?? null,
                            event_id: currentEvent.id ?? "",
                            event: "Individual",
                            code: "Overall",
                            participant_id: selectedParticipant.user_id,
                            participant_global_id: selectedParticipant.user_global_id,
                            participant_name: selectedParticipant.user_name,
                            age: selectedParticipant.age,
                            country: selectedParticipant.country,
                            gender: selectedParticipant.gender || "Male",
                            three_three_three: threeBest,
                            three_six_three: threeSixThreeBest,
                            cycle: cycleBest,
                            overall_time: overallTime,
                            classification:
                                (currentClassificationTab as "beginner" | "intermediate" | "advance" | "prelim" | undefined) ??
                                undefined,
                            round: "final",
                            try1: overallTime,
                            try2: overallTime,
                            try3: overallTime,
                            status: "submitted",
                            submitted_at: now,
                        }),
                    );
                }
            }

            await refreshFinalScore();
            setModalState(false);
            setSelectedParticipant(null);
            setSelectedTeam(null);
            setModalScores({});
            Message.success("Record(s) saved.");
        } catch (error) {
            console.error(error);
            Message.error("Failed to save record(s).");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-ghostwhite p-6 gap-6">
            <Button type="outline" onClick={() => navigate(`/tournaments/${tournamentId}/record/prelim`)} className="w-fit">
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-6 shadow-lg rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>{tournament?.name} Final Score</Title>
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
                        const eventIdForModal = evt.id ?? undefined;
                        const isTeamEvent = ["double", "team relay", "parent & child"].includes(evt.type.toLowerCase());
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
                                            <Tabs
                                                type="rounded"
                                                tabPosition="top"
                                                destroyOnHide
                                                activeTab={currentClassificationTab}
                                                onChange={(key) => setCurrentClassificationTab(key)}
                                            >
                                                {br.final_criteria?.map((fc) => {
                                                    // Filter finalists for this specific bracket and classification
                                                    const relevantFinalists = finalist.filter(
                                                        (f) =>
                                                            ((f.event_id && f.event_id === evt.id) ||
                                                                (f.event_type && f.event_type === evt.type)) &&
                                                            f.bracket_name === br.name &&
                                                            f.classification === fc.classification,
                                                    );

                                                    // Extract all participant IDs for this classification
                                                    const participantIdsInClassification = new Set(
                                                        relevantFinalists.flatMap((f) => f.participant_ids ?? []),
                                                    );

                                                    return (
                                                        <TabPane key={fc.classification} title={`${fc.classification}`}>
                                                            {isTeamEvent ? (
                                                                <Table
                                                                    style={{width: "100%"}}
                                                                    columns={getTeamExpandableColumns(
                                                                        evt.codes,
                                                                        eventIdForModal,
                                                                        eventTypeKey,
                                                                    )}
                                                                    data={filterTeams(
                                                                        teams.filter((t) => {
                                                                            // Team must belong to current event and be within bracket
                                                                            const matchesEvent = t.event_id === evt.id;
                                                                            const matchesAge =
                                                                                t.team_age >= br.min_age &&
                                                                                t.team_age <= br.max_age;
                                                                            const isInClassification =
                                                                                participantIdsInClassification.has(t.id);

                                                                            return (
                                                                                matchesEvent && matchesAge && isInClassification
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
                                                                    columns={getExpandableColumns(
                                                                        evt.codes,
                                                                        eventIdForModal,
                                                                        eventTypeKey,
                                                                    )}
                                                                    data={filterParticipants(
                                                                        registrations.filter((r) => {
                                                                            // Participant within age bracket
                                                                            const matchesAge =
                                                                                r.age >= br.min_age && r.age <= br.max_age;
                                                                            const isInClassification =
                                                                                participantIdsInClassification.has(r.user_id);

                                                                            return matchesAge && isInClassification;
                                                                        }),
                                                                    )}
                                                                    pagination={false}
                                                                    loading={loading}
                                                                    rowKey="user_id"
                                                                />
                                                            )}
                                                        </TabPane>
                                                    );
                                                })}
                                            </Tabs>
                                            <div className="flex justify-end mt-4">
                                                <Button
                                                    type="primary"
                                                    status="success"
                                                    loading={loading}
                                                    onClick={() => checkAllFinalistsAndNavigate(evt)}
                                                    style={{marginLeft: 8}}
                                                >
                                                    Final Done
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
                title={`Edit Record - ${isIndividual && selectedParticipant ? selectedParticipant.user_name : ""}${!isIndividual && selectedTeam ? selectedTeam.name : ""}`}
                visible={modalState}
                onCancel={() => setModalState(false)}
                footer={[
                    <Button key="cancel" onClick={() => setModalState(false)}>
                        Cancel
                    </Button>,
                    <Button key="save" type="primary" loading={loading} onClick={saveModalRecord}>
                        Save Record
                    </Button>,
                ]}
                style={{width: "800px"}}
            >
                {modalState && (
                    <div className="space-y-4">
                        {isIndividual && (
                            <div>
                                <h4 className="font-semibold mb-2">
                                    Participant: {selectedParticipant?.user_name} ({selectedParticipant?.user_global_id})
                                </h4>
                            </div>
                        )}

                        {!isIndividual && (
                            <div>
                                <h4 className="font-semibold mb-2">Team: {selectedTeam?.name}</h4>
                                <p className="text-sm text-gray-600 mb-2">
                                    Leader: {formatTeamLeaderId(selectedTeam?.leader_id, currentEvent?.type)}
                                </p>
                            </div>
                        )}

                        {currentEvent?.codes?.length ? (
                            // For events with multiple codes
                            <div className="space-y-6">
                                {currentEvent.codes.map((code) => {
                                    const codeEventKey = `${code}-${currentEvent.type}`;
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
                        ) : null}
                    </div>
                )}
            </Modal>
        </div>
    );
}
