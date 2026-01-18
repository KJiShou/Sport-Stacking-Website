import LoginForm from "@/components/common/Login";
import {useAuthContext} from "@/context/AuthContext";
import type {FinalCriterion, FirestoreUser, PaymentMethod, Tournament, TournamentEvent} from "@/schema"; // 就是你那个 TournamentSchema infer出来的type
import {countries} from "@/schema/Country";
import {
    deleteTournamentById,
    fetchTournamentEvents,
    fetchTournamentsByType,
    saveTournamentEvents,
    updateTournament,
    updateTournamentStatus,
} from "@/services/firebase/tournamentsService";
import {getCountryFlag} from "@/utils/countryFlags";
import {
    Button,
    Card,
    Cascader,
    DatePicker,
    Descriptions,
    Divider,
    Drawer,
    Dropdown,
    Form,
    Image,
    Input,
    InputNumber,
    Link,
    Message,
    Modal,
    Popconfirm,
    Popover,
    Select,
    Spin,
    Table,
    type TableColumnProps,
    Tabs,
    Tag,
    Tooltip,
    Upload,
} from "@arco-design/web-react";
import {
    IconCalendar,
    IconDelete,
    IconEdit,
    IconExclamationCircle,
    IconEye,
    IconLaunch,
    IconPlayArrow,
    IconPlus,
    IconSearch,
    IconUser,
} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";
import {type ReactNode, useEffect, useRef, useState} from "react";

import {DEFAULT_AGE_BRACKET, DEFAULT_EVENTS} from "@/constants/tournamentDefaults";
import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {fetchUserByID} from "@/services/firebase/authService";
import {deleteFile, uploadFile} from "@/services/firebase/storageService";
import {formatDate} from "@/utils/Date/formatDate";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import Title from "@arco-design/web-react/es/Typography/title";
import type {UploadItem} from "@arco-design/web-react/es/Upload";
import MDEditor from "@uiw/react-md-editor";
import {useNavigate} from "react-router-dom";
import useMount from "react-use/lib/useMount";
import EventFields from "./EventField";
import LocationPicker, {isValidCountryPath} from "./LocationPicker";
import {useAgeBracketEditor} from "./useAgeBracketEditor";

type DraftTournamentEvent = Partial<TournamentEvent> & {__prevType?: string};

type TournamentFormData = Tournament & {
    date_range: [Timestamp | Date, Timestamp | Date];
    registration_date_range: [Timestamp | Date, Timestamp | Date];
    events: DraftTournamentEvent[];
};

const cloneAgeBrackets = (brackets: TournamentEvent["age_brackets"] = DEFAULT_AGE_BRACKET): TournamentEvent["age_brackets"] =>
    brackets.map((bracket) => ({
        ...bracket,
        number_of_participants: bracket.number_of_participants ?? 0,
        final_criteria: bracket.final_criteria?.map((criterion) => ({...criterion})),
    }));

const normalizeEventGender = (value: unknown): TournamentEvent["gender"] => {
    if (value === "Male" || value === "Female") {
        return value;
    }
    return "Mixed";
};

const cloneEvent = (event: TournamentEvent): TournamentEvent => ({
    ...event,
    gender: normalizeEventGender(event.gender),
    age_brackets: cloneAgeBrackets(event.age_brackets),
});

const EVENT_TYPE_OPTIONS: TournamentEvent["type"][] = ["Individual", "Double", "Team Relay", "Parent & Child", "Special Need"];

const isTournamentEventType = (value: unknown): value is TournamentEvent["type"] =>
    typeof value === "string" && EVENT_TYPE_OPTIONS.includes(value as TournamentEvent["type"]);

const EVENT_CODE_OPTIONS = ["3-3-3", "3-6-3", "Cycle"] as const;
type EventCode = (typeof EVENT_CODE_OPTIONS)[number];

const isEventCode = (value: unknown): value is EventCode =>
    typeof value === "string" && (EVENT_CODE_OPTIONS as readonly string[]).includes(value);

// Temporary type for UI tracking with unique ID
type AgeBracketWithId = TournamentEvent["age_brackets"][number] & {_id?: string};
type FinalCriterionWithId = FinalCriterion & {_tempId?: string};

export default function TournamentList() {
    // Ref and state for scroll position preservation
    const editModalContentRef = useRef<HTMLDivElement | null>(null);
    const scrollPositionRef = useRef<number>(0);
    const {TabPane} = Tabs;

    const {user, setUser, firebaseUser} = useAuthContext();
    const [form] = Form.useForm();
    const navigate = useNavigate();

    const deviceBreakpoint = useDeviceBreakpoint();

    const {handleTournamentDateChange, handleRangeChangeSmart} = useSmartDateHandlers(form);

    const {RangePicker} = DatePicker;

    const {
        ageBracketModalVisible,
        ageBrackets,
        setAgeBrackets,
        handleEditAgeBrackets,
        handleSaveAgeBrackets,
        makeHandleDeleteBracket,
        setAgeBracketModalVisible,
    } = useAgeBracketEditor(form);

    // Helper function to get predefined final criteria based on event type
    const getPredefinedFinalCriteria = (eventType: string) => {
        switch (eventType) {
            case "double":
            case "parent & child":
                return [{classification: "intermediate" as const, number: 5}];
            case "team relay":
                return [{classification: "intermediate" as const, number: 4}];
            default:
                return [{classification: "intermediate" as const, number: 10}];
        }
    };
    const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

    const [currentTournaments, setCurrentTournaments] = useState<Tournament[]>([]);
    const [historyTournaments, setHistoryTournaments] = useState<Tournament[]>([]);
    const [activeTab, setActiveTab] = useState("current");
    const [tournamentData, setTournamentData] = useState<{label?: ReactNode; value?: ReactNode}[]>([]);

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [loginModalVisible, setLoginModalVisible] = useState(false);
    const [viewModalVisible, setViewModalVisible] = useState(false);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);

    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);

    const [loading, setLoading] = useState(true);
    const mountedRef = useRef(false);

    const [agendaUploadList, setAgendaUploadList] = useState<UploadItem[]>([]);
    const [logoUploadList, setLogoUploadList] = useState<UploadItem[]>([]);
    const [selectedTournamentEvents, setSelectedTournamentEvents] = useState<TournamentEvent[]>([]);
    const [eventsLoading, setEventsLoading] = useState(false);

    // Search and filter states
    const [searchTerm, setSearchTerm] = useState("");
    const [dateFilter, setDateFilter] = useState<[dayjs.Dayjs, dayjs.Dayjs] | undefined>(undefined);

    function hasRegistered(user: FirestoreUser, tournamentId: string): boolean {
        return (user.registration_records ?? []).some((record) => record.tournament_id === tournamentId);
    }

    const getUserRegistration = (user: FirestoreUser, tournamentId: string): UserRegistrationRecord | undefined => {
        return user.registration_records?.find((record) => record.tournament_id === tournamentId);
    };

    const getParticipantCount = (tournament: Tournament): number | undefined =>
        (tournament as {participants?: number}).participants;

    const isTournamentFull = (tournament: Tournament): boolean => {
        const maxParticipants = tournament.max_participants;
        const participantCount = getParticipantCount(tournament);
        return (
            typeof maxParticipants === "number" &&
            maxParticipants > 0 &&
            typeof participantCount === "number" &&
            participantCount >= maxParticipants
        );
    };

    const renderFullAction = (tournament: Tournament) => (
        <Tooltip content="Participant limit reached.">
            <Button type="primary" onClick={() => handleView(tournament)}>
                <IconEye /> View Tournament
            </Button>
        </Tooltip>
    );

    // Filter tournaments based on search term and date range
    const filterTournaments = (tournaments: Tournament[]) => {
        return tournaments.filter((tournament) => {
            // Search filter
            const matchesSearch =
                !searchTerm ||
                (tournament.name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                (tournament.country?.[0]?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                (tournament.country?.[1]?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false) ||
                (tournament.venue?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false);

            // Date filter
            const matchesDate =
                !dateFilter ||
                !dateFilter[0] ||
                !dateFilter[1] ||
                (tournament.start_date &&
                    (() => {
                        const startDate =
                            tournament.start_date instanceof Timestamp ? tournament.start_date.toDate() : tournament.start_date;
                        // Set filter start to 00:00:00 of the selected start date
                        const filterStart = dateFilter[0].startOf("day").toDate();
                        // Set filter end to 00:00:00 of the next day (includes entire end date)
                        const filterEnd = dateFilter[1].add(1, "day").startOf("day").toDate();
                        return startDate >= filterStart && startDate < filterEnd;
                    })());

            return matchesSearch && matchesDate;
        });
    };

    const filteredCurrentTournaments = filterTournaments(currentTournaments);
    const filteredHistoryTournaments = filterTournaments(historyTournaments);

    const columns: (TableColumnProps<(typeof currentTournaments)[number]> | false)[] = [
        {
            title: "Name",
            dataIndex: "name",
            width: 200,
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Country / State",
            dataIndex: "country",
            width: 300,
            render: (country: string[]) => {
                const countryName = country[0];
                const state = country[1];
                const flagUrl = getCountryFlag(countryName);
                return (
                    <span style={{display: "flex", alignItems: "center", gap: 8}}>
                        {flagUrl && (
                            <img src={flagUrl} alt={`${countryName} flag`} style={{width: 20, height: 15, objectFit: "cover"}} />
                        )}
                        <span>
                            {countryName} / {state}
                        </span>
                    </span>
                );
            },
        },

        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Registration Start",
            dataIndex: "registration_start_date",
            width: 180,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Registration End",
            dataIndex: "registration_end_date",
            width: 180,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        {
            title: "Tournament Start",
            dataIndex: "start_date",
            width: 180,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Status",
            dataIndex: "status",
            width: 200,
            render: (status: string, tournament: Tournament) => {
                let color: string | undefined;
                let displayText: string = status;
                let userHasRegistered = false;
                let registrationStatus: string | undefined;
                let rejectionReason: string | undefined;
                let tooltipMessage = "";
                const tournamentFull = isTournamentFull(tournament);

                if (status === "Up Coming") {
                    color = "gold";
                } else if (status === "On Going") {
                    color = "arcoblue";
                } else if (status === "Close Registration") {
                    color = "orange";
                } else if (status === "End") {
                    color = "gray";
                }

                if (user) {
                    userHasRegistered = hasRegistered(user, tournament.id ?? "");
                    if (userHasRegistered) {
                        // Get the user's registration details
                        const userRegistration = getUserRegistration(user, tournament.id ?? "");
                        registrationStatus = userRegistration?.status; // assuming status field exists
                        rejectionReason = userRegistration?.rejection_reason ?? ""; // assuming rejectionReason field exists
                    }
                }

                if (userHasRegistered && registrationStatus) {
                    // Show registration status instead of tournament status
                    if (registrationStatus === "pending") {
                        color = "blue";
                        displayText = "Pending";
                        tooltipMessage =
                            "Your registration is pending approval. Please contact us if you need to update your registration details.";
                    } else if (registrationStatus === "approved") {
                        if (tournament.status === "On Going") {
                            color = "arcoblue";
                            displayText = "On Going";
                            tooltipMessage = "Your registration is approved. The tournament is currently running.";
                        } else if (tournament.status === "End") {
                            color = "gray";
                            displayText = "End";
                            tooltipMessage = "Your registration is approved. The tournament has ended.";
                        } else {
                            color = "green";
                            displayText = "Approved";
                            tooltipMessage =
                                "Your registration has been approved! Contact us if you need to make any changes to your registration.";
                        }
                    } else if (registrationStatus === "rejected") {
                        color = "red";
                        displayText = "Rejected";
                        tooltipMessage = rejectionReason ? `Rejected: ${rejectionReason}` : "Your registration was rejected.";
                    }
                } else if (tournamentFull) {
                    color = "red";
                    displayText = "Full";
                    tooltipMessage = "Participant limit reached.";
                }

                return (
                    <Tooltip content={tooltipMessage || displayText}>
                        <Tag color={color}>{displayText}</Tag>
                    </Tooltip>
                );
            },
        },
        {
            title: "Action",
            dataIndex: "action",
            width: 220,
            render: (_: unknown, tournament: Tournament) => {
                const tournamentFull = isTournamentFull(tournament);
                if (!user) {
                    if (tournamentFull) {
                        return renderFullAction(tournament);
                    }
                    return (
                        <Dropdown.Button
                            type="primary"
                            trigger={["click", "hover"]}
                            buttonProps={{
                                loading: loading,
                                onClick: () => handleRegister(tournament.id ?? ""),
                            }}
                            droplist={
                                <div
                                    className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                >
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => handleView(tournament)}
                                    >
                                        <IconEye /> View Tournament
                                    </Button>
                                </div>
                            }
                        >
                            Register
                        </Dropdown.Button>
                    );
                }

                const isEditor = user?.roles?.edit_tournament || user?.global_id === tournament?.editor;
                const isRecorder = user?.global_id === tournament?.recorder;
                const canManage = isEditor || isRecorder;

                if (canManage) {
                    if (tournament.status === "On Going") {
                        return (
                            <Dropdown.Button
                                type="primary"
                                trigger={["click", "hover"]}
                                onClick={() => navigate(`/tournaments/${tournament.id}/start/record`)}
                                droplist={
                                    <div
                                        className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                    >
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => handleView(tournament)}
                                        >
                                            <IconEye /> View Tournament
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/registrations`)}
                                        >
                                            <IconEye /> View Registration List
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/participants`)}
                                        >
                                            <IconUser /> Participant List
                                        </Button>
                                        {isEditor && (
                                            <>
                                                <Button
                                                    type="text"
                                                    loading={loading}
                                                    className={`text-left`}
                                                    onClick={async () => handleEdit(tournament)}
                                                >
                                                    <IconEdit /> Edit
                                                </Button>
                                                <Button
                                                    type="text"
                                                    status="danger"
                                                    loading={loading}
                                                    className={`text-left`}
                                                    onClick={async () => handleDelete(tournament)}
                                                >
                                                    <IconDelete /> Delete
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                }
                                buttonProps={{
                                    loading: loading,
                                }}
                            >
                                <IconPlayArrow />
                                Record
                            </Dropdown.Button>
                        );
                    }

                    // Only editors can start tournaments
                    if (!isEditor) {
                        return (
                            <Dropdown.Button
                                type="primary"
                                trigger={["click", "hover"]}
                                disabled
                                droplist={
                                    <div
                                        className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                    >
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => handleView(tournament)}
                                        >
                                            <IconEye /> View Tournament
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/registrations`)}
                                        >
                                            <IconEye /> View Registration List
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/participants`)}
                                        >
                                            <IconUser /> Participant List
                                        </Button>
                                    </div>
                                }
                            >
                                View
                            </Dropdown.Button>
                        );
                    }

                    return (
                        <Popconfirm
                            title="Start Tournament"
                            content="Are you sure you want to start this tournament?"
                            onOk={async () => {
                                if (user && tournament.id) {
                                    try {
                                        setLoading(true);
                                        await updateTournamentStatus(user, tournament.id, "On Going");
                                        await fetchTournaments();
                                        Message.success("Tournament started successfully!");
                                        navigate(`/tournaments/${tournament.id}/start/record`);
                                    } catch (error) {
                                        console.error("Failed to start tournament:", error);
                                        Message.error("Failed to start tournament.");
                                    } finally {
                                        setLoading(false);
                                    }
                                }
                            }}
                            onCancel={() => setLoading(false)}
                            okText="Start"
                            cancelText="Cancel"
                            okButtonProps={{type: "primary"}}
                        >
                            <Dropdown.Button
                                type="primary"
                                trigger={["click", "hover"]}
                                droplist={
                                    <div
                                        className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                    >
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => handleView(tournament)}
                                        >
                                            <IconEye /> View Tournament
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/registrations`)}
                                        >
                                            <IconEye /> View Registration List
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => navigate(`/tournaments/${tournament.id}/participants`)}
                                        >
                                            <IconUser /> Participant List
                                        </Button>
                                        <Button
                                            type="text"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => handleEdit(tournament)}
                                        >
                                            <IconEdit /> Edit
                                        </Button>
                                        <Button
                                            type="text"
                                            status="danger"
                                            loading={loading}
                                            className={`text-left`}
                                            onClick={async () => handleDelete(tournament)}
                                        >
                                            <IconDelete /> Delete
                                        </Button>
                                    </div>
                                }
                                buttonProps={{
                                    loading: loading,
                                }}
                            >
                                <IconPlayArrow />
                                Start
                            </Dropdown.Button>
                        </Popconfirm>
                    );
                }

                const alreadyRegistered = hasRegistered(user, tournament.id ?? "");

                if (alreadyRegistered) {
                    return (
                        <Dropdown.Button
                            type="primary"
                            trigger={["click", "hover"]}
                            buttonProps={{
                                loading: loading,
                                onClick: () => navigate(`/tournaments/${tournament.id}/register/${user.global_id}/view`),
                            }}
                            droplist={
                                <div
                                    className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                >
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => handleView(tournament)}
                                    >
                                        <IconEye /> View Tournament
                                    </Button>
                                </div>
                            }
                        >
                            <IconEye /> View Registration
                        </Dropdown.Button>
                    );
                }
                if (!tournament.registration_start_date || !tournament.registration_end_date) {
                    return;
                }
                if (tournamentFull) {
                    return renderFullAction(tournament);
                }
                if (tournament.registration_end_date > Timestamp.now()) {
                    return (
                        <Dropdown.Button
                            type="primary"
                            trigger={["click", "hover"]}
                            buttonProps={{
                                loading: loading,
                                onClick: () => handleRegister(tournament.id ?? ""),
                            }}
                            droplist={
                                <div
                                    className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                >
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => handleView(tournament)}
                                    >
                                        <IconEye /> View Tournament
                                    </Button>
                                </div>
                            }
                        >
                            Register
                        </Dropdown.Button>
                    );
                }
                return (
                    <Dropdown.Button
                        type="primary"
                        trigger={["click", "hover"]}
                        droplist={
                            <div
                                className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                            >
                                <Button
                                    type="text"
                                    loading={loading}
                                    className={`text-left`}
                                    onClick={async () => handleView(tournament)}
                                >
                                    <IconEye /> View Tournament
                                </Button>
                            </div>
                        }
                    >
                        <Popover
                            content={
                                <span>
                                    <p>This tournament has ended registration.</p>
                                </span>
                            }
                        >
                            Register
                        </Popover>
                    </Dropdown.Button>
                );
            },
        },
    ];

    const loadTournamentEvents = async (tournamentId: string) => {
        setEventsLoading(true);
        try {
            const events = await fetchTournamentEvents(tournamentId);
            const normalizedEvents = events.map(cloneEvent);
            setSelectedTournamentEvents(normalizedEvents);
            form.setFieldValue("events", normalizedEvents);
        } catch (error) {
            console.error("Failed to fetch tournament events", error);
            Message.error("Unable to load tournament events.");
            setSelectedTournamentEvents([]);
            form.setFieldValue("events", []);
        } finally {
            setEventsLoading(false);
        }
    };

    const fetchTournaments = async () => {
        setLoading(true);
        try {
            const [currentList, historyList] = await Promise.all([
                fetchTournamentsByType("current"),
                fetchTournamentsByType("history"),
            ]);
            setCurrentTournaments(currentList);
            setHistoryTournaments(historyList);
            if (firebaseUser?.uid) {
                const freshUser = await fetchUserByID(firebaseUser.uid);
                if (freshUser) setUser(freshUser);
            }
        } catch (error) {
            console.error("Failed to fetch tournaments:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (values: TournamentFormData) => {
        if (!selectedTournament?.id) return;
        setLoading(true);

        try {
            if (!user) return;

            const countryPath = values.country ?? [];
            if (!isValidCountryPath(countryPath)) {
                Message.error("Selected address does not match a valid country/state option. Please adjust manually.");
                setLoading(false);
                return;
            }

            const rawEvents = values.events ?? [];

            // Check for duplicate event type + code + gender combinations
            const eventSignatures = new Map<string, number>();
            for (let i = 0; i < rawEvents.length; i++) {
                const event = rawEvents[i];
                if (event.type) {
                    const normalizedCodes = Array.isArray(event.codes)
                        ? event.codes.filter(isEventCode)
                        : typeof event.codes === "string" && isEventCode(event.codes)
                          ? [event.codes]
                          : [];
                    const genderKey = normalizeEventGender(event.gender);
                    for (const code of normalizedCodes) {
                        const signature = `${event.type}-${code}-${genderKey}`;
                        if (eventSignatures.has(signature)) {
                            Message.error(
                                `Duplicate event found: ${event.type} with code ${code} and gender ${genderKey}. Each event type, code, and gender combination must be unique.`,
                            );
                            setLoading(false);
                            return;
                        }
                        eventSignatures.set(signature, i);
                    }
                }
            }

            const sanitizedEvents: TournamentEvent[] = [];
            const invalidEvents: string[] = [];

            for (let i = 0; i < rawEvents.length; i++) {
                const rawEvent = rawEvents[i];
                const {__prevType: _ignored, age_brackets, id, type, codes, teamSize, gender} = rawEvent;

                if (!isTournamentEventType(type)) {
                    invalidEvents.push(`Event ${i + 1}: Invalid event type "${type}"`);
                    continue;
                }

                // Ensure codes is an array before filtering
                const normalizedCodes = Array.isArray(codes)
                    ? codes.filter(isEventCode)
                    : typeof codes === "string" && isEventCode(codes)
                      ? [codes]
                      : [];
                if (normalizedCodes.length === 0) {
                    invalidEvents.push(`Event ${i + 1}: No valid event codes selected for "${type}"`);
                    continue;
                }

                // Preserve existing event ID, don't generate new one
                const sanitizedEvent: TournamentEvent = {
                    id: id || crypto.randomUUID(), // Use existing ID or generate only if truly missing
                    type,
                    gender: normalizeEventGender(gender),
                    codes: normalizedCodes,
                    age_brackets: cloneAgeBrackets(age_brackets ?? DEFAULT_AGE_BRACKET),
                };

                if (typeof teamSize === "number") {
                    sanitizedEvent.teamSize = teamSize;
                }

                sanitizedEvents.push(sanitizedEvent);
            }

            if (invalidEvents.length > 0) {
                Message.error("Cannot save tournament. Cannot have same events in a tournament");
                setLoading(false);
                return;
            }

            if (sanitizedEvents.length === 0) {
                Message.error("Please configure at least one valid event.");
                setLoading(false);
                return;
            }

            const startDate =
                values.date_range[0] instanceof Date
                    ? Timestamp.fromDate(values.date_range[0])
                    : Timestamp.fromDate(values.date_range[0].toDate());

            const endDate =
                values.date_range[1] instanceof Date
                    ? Timestamp.fromDate(values.date_range[1])
                    : Timestamp.fromDate(values.date_range[1].toDate());

            const registrationStartDate =
                values.registration_date_range[0] instanceof Date
                    ? Timestamp.fromDate(values.registration_date_range[0])
                    : Timestamp.fromDate(values.registration_date_range[0].toDate());
            const registrationEndDate =
                values.registration_date_range[1] instanceof Date
                    ? Timestamp.fromDate(values.registration_date_range[1])
                    : Timestamp.fromDate(values.registration_date_range[1].toDate());

            const agendaFile = form.getFieldValue("agenda");
            const logoFile = form.getFieldValue("logo");

            let agendaUrl = selectedTournament?.agenda ?? "";
            let logoUrl = selectedTournament?.logo ?? "";

            if (agendaFile instanceof File) {
                agendaUrl = await uploadFile(agendaFile, `agendas`, `${selectedTournament.id}`);
            } else if (agendaFile === null) {
                agendaUrl = "";
            }
            if (logoFile instanceof File) {
                logoUrl = await uploadFile(logoFile, `logos`, `${selectedTournament.id}`);
            } else if (logoFile === null) {
                if (selectedTournament?.id) {
                    await deleteFile(`logos/${selectedTournament.id}`);
                }
                logoUrl = "";
            }

            // Handle payment methods with QR code uploads
            const rawPaymentMethods = (form.getFieldValue("payment_methods") ?? []) as Array<
                PaymentMethod & {qr_code_file?: File}
            >;
            const processedPaymentMethods: PaymentMethod[] = [];

            for (const method of rawPaymentMethods) {
                let qrCodeUrl = method.qr_code_image || "";

                if (method.qr_code_file instanceof File) {
                    qrCodeUrl = await uploadFile(
                        method.qr_code_file,
                        `payment_qr_codes`,
                        `${selectedTournament.id}_${method.id}`,
                    );
                }

                processedPaymentMethods.push({
                    id: method.id,
                    qr_code_image: qrCodeUrl || null,
                    account_name: method.account_name,
                    account_number: method.account_number,
                    description: method.description || null,
                });
            }

            await saveTournamentEvents(selectedTournament.id, sanitizedEvents);
            const persistedEvents = sanitizedEvents.map((event) => cloneEvent(event));
            setSelectedTournamentEvents(persistedEvents);
            form.setFieldValue("events", persistedEvents);

            // Check if tournament is ongoing or ended - restrict name and location changes
            const isOngoingOrEnded = selectedTournament.status === "On Going" || selectedTournament.status === "End";

            updateTournament(user, selectedTournament.id, {
                name: isOngoingOrEnded ? selectedTournament.name : values.name,
                start_date: startDate,
                end_date: endDate,
                country: isOngoingOrEnded ? selectedTournament.country : values.country,
                venue: isOngoingOrEnded ? selectedTournament.venue : values.venue,
                address: isOngoingOrEnded ? selectedTournament.address : values.address,
                registration_start_date: registrationStartDate,
                registration_end_date: registrationEndDate,
                max_participants: values.max_participants,
                status: values.status,
                editor: values.editor ?? null,
                recorder: values.recorder ?? null,
                description: values.description ?? null,
                registration_fee: values.registration_fee,
                member_registration_fee: values.member_registration_fee,
                payment_methods: processedPaymentMethods.length > 0 ? processedPaymentMethods : null,
                agenda: agendaUrl || null,
                logo: logoUrl || null,
            });
            setEditModalVisible(false);
            await fetchTournaments();

            if (isOngoingOrEnded) {
                Message.warning("Tournament name and location cannot be changed for ongoing or completed tournaments.");
            } else {
                Message.success("Tournament updated successfully!");
            }
        } catch (error) {
            console.error(error);
            Message.error("Failed to update tournament.");
        } finally {
            setLoading(false);
        }
    };
    const handleEdit = (tournament: Tournament) => {
        setSelectedTournament(tournament);
        setEditModalVisible(true);
        setSelectedTournamentEvents([]);
        form.setFieldValue("events", []);
        if (tournament.id) {
            void loadTournamentEvents(tournament.id);
        } else {
            const fallbackEvents = DEFAULT_EVENTS.map((event) => cloneEvent(event));
            setSelectedTournamentEvents(fallbackEvents);
            form.setFieldValue("events", fallbackEvents);
        }
    };

    const handleView = (tournament: Tournament) => {
        navigate(`/tournaments/${tournament.id}/view`);
    };

    const handleDelete = async (tournament: Tournament) => {
        Modal.confirm({
            title: "Delete Confirmation",
            content: `Are you sure you want to delete the tournament "${tournament.name}"?`,
            okText: "Yes",
            cancelText: "Cancel",
            onOk: async () => {
                try {
                    setLoading(true);
                    if (!user) {
                        Message.error("You must be logged in to delete a tournament.");
                        return;
                    }
                    await deleteTournamentById(user, tournament?.id ?? "");
                    Message.success("Tournament deleted successfully.");
                    await fetchTournaments();
                } catch (error) {
                    Message.error("Failed to delete tournament.");
                    console.error(error);
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleRegister = (tournamentId: string) => {
        if (!user) {
            setLoginModalVisible(true);
            return;
        }
        if (!tournamentId) {
            Message.error("Invalid tournament ID.");
            return;
        }
        navigate(`/tournaments/${tournamentId}/register`);
    };

    useEffect(() => {
        if (selectedTournament) {
            setAgendaUploadList(
                selectedTournament.agenda
                    ? [
                          {
                              uid: "agenda-url",
                              name: "Agenda.pdf",
                              url: selectedTournament.agenda,
                              status: "done",
                          },
                      ]
                    : [],
            );

            setLogoUploadList(
                selectedTournament.logo
                    ? [
                          {
                              uid: "logo-url",
                              name: "Logo.png",
                              url: selectedTournament.logo,
                              status: "done",
                          },
                      ]
                    : [],
            );
            form.setFieldsValue({
                name: selectedTournament.name,
                country: selectedTournament.country,
                registration_fee: selectedTournament.registration_fee,
                member_registration_fee: selectedTournament.member_registration_fee,
                venue: selectedTournament.venue,
                address: selectedTournament.address,
                max_participants: selectedTournament.max_participants,
                editor: selectedTournament.editor,
                recorder: selectedTournament.recorder,
                date_range: [
                    selectedTournament.start_date instanceof Timestamp
                        ? dayjs(selectedTournament.start_date.toDate())
                        : dayjs(selectedTournament.start_date),
                    selectedTournament.end_date instanceof Timestamp
                        ? dayjs(selectedTournament.end_date.toDate())
                        : dayjs(selectedTournament.end_date),
                ],
                registration_date_range: [
                    selectedTournament.registration_start_date instanceof Timestamp
                        ? dayjs(selectedTournament.registration_start_date.toDate())
                        : dayjs(selectedTournament.registration_start_date),
                    selectedTournament.registration_end_date instanceof Timestamp
                        ? dayjs(selectedTournament.registration_end_date.toDate())
                        : dayjs(selectedTournament.registration_end_date),
                ],
                events: selectedTournamentEvents.length > 0 ? selectedTournamentEvents : [],
                description: selectedTournament.description ?? "",
                agenda: selectedTournament.agenda ?? null,
                logo: selectedTournament.logo ?? null,
                payment_methods: selectedTournament.payment_methods ?? [],
            });
        }
    }, [selectedTournament, selectedTournamentEvents, form]);

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        fetchTournaments();
    });

    return (
        <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
            <div className="relative w-full flex items-center mb-6">
                <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl font-semibold">Tournament Management</h1>
                <div className="ml-auto">
                    {user?.roles?.edit_tournament && (
                        <a href="/tournaments/create" target="_blank" rel="noopener noreferrer">
                            <Button type="primary">Create Tournament</Button>
                        </a>
                    )}
                </div>
            </div>

            {/* Search and Filter Controls */}
            <div className={`w-full flex flex-col md:flex-row gap-4 items-center`}>
                <Input
                    prefix={<IconSearch />}
                    placeholder="Search by name, country, state, or venue..."
                    value={searchTerm}
                    onChange={(value) => setSearchTerm(value)}
                    allowClear
                    className={`flex-1`}
                />
                <RangePicker
                    prefix={<IconCalendar />}
                    placeholder={["Start Date", "End Date"]}
                    value={dateFilter ?? undefined}
                    onChange={(value) => {
                        if (value?.[0] && value?.[1]) {
                            setDateFilter([dayjs(value[0]), dayjs(value[1])]);
                        } else {
                            setDateFilter(undefined);
                        }
                    }}
                    allowClear
                    className={`w-full md:w-auto`}
                />
                {(searchTerm || dateFilter) && (
                    <Button
                        onClick={() => {
                            setSearchTerm("");
                            setDateFilter(undefined);
                        }}
                    >
                        Clear Filters
                    </Button>
                )}
            </div>

            <Tabs activeTab={activeTab} onChange={setActiveTab} type="capsule" className={`w-full`}>
                <TabPane key="current" title="Current Tournaments">
                    <Table
                        rowKey="id"
                        columns={columns.filter((e): e is TableColumnProps<Tournament> => !!e)}
                        data={filteredCurrentTournaments}
                        pagination={{pageSize: 10}}
                        className="my-4"
                        loading={loading}
                    />
                </TabPane>
                <TabPane key="history" title="Tournament History">
                    <Table
                        rowKey="id"
                        columns={columns.filter((e): e is TableColumnProps<Tournament> => !!e)}
                        data={filteredHistoryTournaments}
                        pagination={{pageSize: 10}}
                        className="my-4"
                        loading={loading}
                    />
                </TabPane>
            </Tabs>

            <Modal
                title="Login"
                visible={loginModalVisible}
                onCancel={() => {
                    setLoginModalVisible(false);
                }}
                footer={null}
                autoFocus={false}
                focusLock={true}
                className={`max-w-[95vw] md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                <LoginForm onClose={() => setLoginModalVisible(false)} />
            </Modal>

            <Modal
                title="Edit Tournament"
                visible={editModalVisible}
                onCancel={() => setEditModalVisible(false)}
                footer={null}
                autoFocus={false}
                focusLock={false}
                className={`my-8 w-full md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                {selectedTournament && (
                    <Spin loading={eventsLoading} block>
                        <div
                            ref={editModalContentRef}
                            style={{maxHeight: "70vh", overflowY: "auto", paddingRight: 8}}
                            onScroll={() => {
                                if (editModalContentRef.current) {
                                    scrollPositionRef.current = editModalContentRef.current.scrollTop;
                                }
                            }}
                        >
                            <Form form={form} layout="horizontal" onSubmit={handleSubmit} requiredSymbol={false}>
                                <Form.Item label="Tournament Name" field="name" rules={[{required: true}]}>
                                    <Input
                                        placeholder="Enter tournament name"
                                        disabled={selectedTournament.status === "On Going" || selectedTournament.status === "End"}
                                    />
                                </Form.Item>
                                {(selectedTournament.status === "On Going" || selectedTournament.status === "End") && (
                                    <div style={{marginTop: -16, marginBottom: 16, color: "#ff7d00", fontSize: 12}}>
                                        Tournament name cannot be changed for ongoing or completed tournaments.
                                    </div>
                                )}

                                <Form.Item label="Tournament Date Range" field="date_range" rules={[{required: true}]}>
                                    <RangePicker
                                        showTime={{
                                            defaultValue: ["08:00", "18:00"],
                                            format: "HH:mm",
                                        }}
                                        style={{width: "100%"}}
                                        disabledDate={(current) => {
                                            const today = dayjs();
                                            return current?.isBefore(today.add(7, "day"), "day");
                                        }}
                                        onChange={handleTournamentDateChange}
                                    />
                                </Form.Item>

                                <Form.Item
                                    label="Country / State"
                                    field="country"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please select a country/region",
                                        },
                                    ]}
                                >
                                    <Cascader
                                        showSearch
                                        changeOnSelect
                                        allowClear
                                        disabled={selectedTournament.status === "On Going" || selectedTournament.status === "End"}
                                        filterOption={(input, node) => {
                                            return node.label.toLowerCase().includes(input.toLowerCase());
                                        }}
                                        onChange={(val) => {
                                            form.setFieldValue("country", val);
                                        }}
                                        options={countries}
                                        placeholder="Please select location"
                                        expandTrigger="hover"
                                    />
                                </Form.Item>

                                {/* Venue */}
                                <Form.Item
                                    label="Venue"
                                    field="venue"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please input venue",
                                        },
                                    ]}
                                >
                                    <Input
                                        placeholder="Enter venue name"
                                        disabled={selectedTournament.status === "On Going" || selectedTournament.status === "End"}
                                    />
                                </Form.Item>

                                {/* Address */}
                                <Form.Item
                                    label="Address"
                                    field="address"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please input address",
                                        },
                                    ]}
                                >
                                    <LocationPicker
                                        value={form.getFieldValue("address")}
                                        onChange={(val) => {
                                            if (selectedTournament.status !== "On Going" && selectedTournament.status !== "End") {
                                                form.setFieldValue("address", val);
                                            }
                                        }}
                                        onCountryChange={(countryPath) => {
                                            if (!isValidCountryPath(countryPath)) {
                                                Message.warning(
                                                    "This location is not in the selectable list. Please choose manually.",
                                                );
                                                form.resetFields(["country"]);
                                            } else {
                                                form.setFieldValue("country", countryPath);
                                            }
                                        }}
                                    />
                                </Form.Item>
                                {(selectedTournament.status === "On Going" || selectedTournament.status === "End") && (
                                    <div style={{marginTop: -16, marginBottom: 16, color: "#ff7d00", fontSize: 12}}>
                                        Location fields (country, venue, address) cannot be changed for ongoing or completed
                                        tournaments.
                                    </div>
                                )}

                                <Form.Item
                                    label="Registration Date Range"
                                    field="registration_date_range"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please input registration date",
                                        },
                                    ]}
                                >
                                    <RangePicker
                                        showTime={{
                                            defaultValue: [dayjs("08:00", "HH:mm"), dayjs("18:00", "HH:mm")],
                                            format: "HH:mm",
                                        }}
                                        style={{width: "100%"}}
                                        disabledDate={(current) => current?.isBefore(dayjs(), "day")}
                                        onChange={handleRangeChangeSmart("registration_date_range")}
                                    />
                                </Form.Item>

                                <Form.Item
                                    label={
                                        <div>
                                            Max Participants
                                            <Tooltip content="0 as no limit">
                                                <IconExclamationCircle
                                                    style={{
                                                        margin: "0 8px",
                                                        color: "rgb(var(--arcoblue-6))",
                                                    }}
                                                />
                                            </Tooltip>
                                        </div>
                                    }
                                    field="max_participants"
                                    rules={[
                                        {
                                            required: true,
                                            message: "Please input maximum participants",
                                        },
                                    ]}
                                >
                                    <InputNumber min={0} style={{width: "100%"}} placeholder="Enter max number of participants" />
                                </Form.Item>

                                <Form.Item
                                    label="Registration Fee"
                                    field="registration_fee"
                                    rules={[{required: true, message: "Please input registration fee"}]}
                                >
                                    <InputNumber min={0} style={{width: "100%"}} placeholder="Enter registration fee" />
                                </Form.Item>

                                <Form.Item
                                    label="Member Registration Fee"
                                    field="member_registration_fee"
                                    rules={[{required: true, message: "Please input member registration fee"}]}
                                >
                                    <InputNumber min={0} style={{width: "100%"}} placeholder="Enter member registration fee" />
                                </Form.Item>

                                <Form.Item label="Editor ID" field="editor">
                                    <Input placeholder="Enter editor global ID" />
                                </Form.Item>

                                <Form.Item label="Recorder ID" field="recorder">
                                    <Input placeholder="Enter recorder global ID" />
                                </Form.Item>

                                <Form.Item label="Events">
                                    <Form.List field="events">
                                        {(fields, {add, remove}) => (
                                            <>
                                                {fields.map((field, index) => (
                                                    <EventFields
                                                        key={field.key}
                                                        index={index}
                                                        onEditAgeBrackets={handleEditAgeBrackets}
                                                        onRemove={remove}
                                                    />
                                                ))}
                                                <Button
                                                    type="text"
                                                    onClick={() =>
                                                        add({
                                                            id: undefined, // Let backend/database assign the ID
                                                            type: "" as TournamentEvent["type"],
                                                            gender: "Mixed",
                                                            codes: [],
                                                            age_brackets: cloneAgeBrackets(DEFAULT_AGE_BRACKET),
                                                        })
                                                    }
                                                >
                                                    <IconPlus /> Add Event
                                                </Button>
                                            </>
                                        )}
                                    </Form.List>
                                </Form.Item>

                                <Drawer
                                    title="Edit Age Brackets"
                                    visible={ageBracketModalVisible}
                                    onCancel={() => {
                                        setAgeBracketModalVisible(false);
                                        setTimeout(() => {
                                            if (editModalContentRef.current) {
                                                editModalContentRef.current.scrollTop = scrollPositionRef.current;
                                            }
                                        }, 100);
                                    }}
                                    footer={
                                        <div style={{textAlign: "right"}}>
                                            <Button
                                                onClick={() => {
                                                    setAgeBracketModalVisible(false);
                                                    setTimeout(() => {
                                                        if (editModalContentRef.current) {
                                                            editModalContentRef.current.scrollTop = scrollPositionRef.current;
                                                        }
                                                    }, 100);
                                                }}
                                                style={{marginRight: 8}}
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="primary"
                                                onClick={() => {
                                                    handleSaveAgeBrackets();
                                                    setTimeout(() => {
                                                        if (editModalContentRef.current) {
                                                            editModalContentRef.current.scrollTop = scrollPositionRef.current;
                                                        }
                                                    }, 100);
                                                }}
                                            >
                                                Save
                                            </Button>
                                        </div>
                                    }
                                    afterOpen={() => {
                                        if (editModalContentRef.current) {
                                            scrollPositionRef.current = editModalContentRef.current.scrollTop;
                                        }
                                    }}
                                    autoFocus={false}
                                    focusLock={true}
                                    width={660}
                                    className={`w-full md:max-w-[80vw] lg:max-w-[60vw]`}
                                >
                                    <Form.List field="age_brackets_modal">
                                        {(fields, {add, remove}) => {
                                            return (
                                                <>
                                                    {ageBrackets.map((bracket, id) => {
                                                        // Ensure bracket has a unique ID for React key
                                                        const bracketId =
                                                            (bracket as AgeBracketWithId)._id || `bracket-${id}-${bracket.name}`;

                                                        const isMinError =
                                                            bracket.min_age === null || bracket.min_age > bracket.max_age;

                                                        let minAgeHelp: string | undefined;
                                                        if (bracket.min_age === null) {
                                                            minAgeHelp = "Enter min age";
                                                        } else if (bracket.min_age > bracket.max_age) {
                                                            minAgeHelp = "Min age > Max age";
                                                        }

                                                        // 2）再计算 Max Age 的校验状态和提示文字
                                                        const isMaxError =
                                                            bracket.max_age === null || bracket.max_age < bracket.min_age;

                                                        let maxAgeHelp: string | undefined;
                                                        if (bracket.max_age === null) {
                                                            maxAgeHelp = "Enter max age";
                                                        } else if (bracket.max_age < bracket.min_age) {
                                                            maxAgeHelp = "Max age < Min age";
                                                        }
                                                        return (
                                                            <div key={bracketId} className="border p-4 mb-4 rounded">
                                                                <div className="flex gap-4 mb-4 w-full">
                                                                    <Form.Item
                                                                        label="Bracket Name"
                                                                        required
                                                                        validateStatus={!bracket.name ? "error" : undefined}
                                                                        help={
                                                                            !bracket.name
                                                                                ? "Please enter bracket name"
                                                                                : undefined
                                                                        }
                                                                        className="w-1/3"
                                                                        layout="vertical"
                                                                    >
                                                                        <Input
                                                                            value={bracket.name}
                                                                            onChange={(v) => {
                                                                                const updated = [...ageBrackets];
                                                                                updated[id].name = v;
                                                                                setAgeBrackets(updated);
                                                                            }}
                                                                            placeholder="Bracket Name"
                                                                        />
                                                                    </Form.Item>
                                                                    <Form.Item
                                                                        label="Min Age"
                                                                        required
                                                                        validateStatus={isMinError ? "error" : undefined}
                                                                        help={minAgeHelp}
                                                                        className="w-1/4"
                                                                        layout="vertical"
                                                                    >
                                                                        <InputNumber
                                                                            value={bracket.min_age}
                                                                            min={0}
                                                                            onChange={(v) => {
                                                                                const updated = [...ageBrackets];
                                                                                updated[id].min_age = v ?? 0;
                                                                                setAgeBrackets(updated);
                                                                            }}
                                                                            placeholder="Min Age"
                                                                        />
                                                                    </Form.Item>
                                                                    <Form.Item
                                                                        label="Max Age"
                                                                        required
                                                                        validateStatus={isMaxError ? "error" : undefined}
                                                                        help={maxAgeHelp}
                                                                        className="w-1/4"
                                                                        layout="vertical"
                                                                    >
                                                                        <InputNumber
                                                                            value={bracket.max_age}
                                                                            min={0}
                                                                            onChange={(v) => {
                                                                                const updated = [...ageBrackets];
                                                                                updated[id].max_age = v ?? 0;
                                                                                setAgeBrackets(updated);
                                                                            }}
                                                                            placeholder="Max Age"
                                                                        />
                                                                    </Form.Item>
                                                                    <div className="flex items-end pb-8">
                                                                        <Button
                                                                            status="danger"
                                                                            onClick={makeHandleDeleteBracket(id)}
                                                                        >
                                                                            <IconDelete />
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                                {/* Final Criteria for this age bracket */}
                                                                <div className="mt-4">
                                                                    <h4 className="text-sm font-medium mb-2">
                                                                        Final Criteria for {bracket.name}
                                                                    </h4>
                                                                    {bracket.final_criteria?.map((criteria, criteriaIndex) => {
                                                                        const criteriaWithId = criteria as FinalCriterionWithId;
                                                                        const criteriaKey =
                                                                            criteriaWithId._tempId ||
                                                                            `${bracketId}-criteria-${criteriaIndex}`;

                                                                        return (
                                                                            <div key={criteriaKey} className="flex gap-2 mb-2">
                                                                                <Select
                                                                                    value={criteria.classification}
                                                                                    placeholder="Classification"
                                                                                    onChange={(value) => {
                                                                                        const updated = [...ageBrackets];
                                                                                        const targetBracket = updated[id];
                                                                                        if (!targetBracket) {
                                                                                            return;
                                                                                        }
                                                                                        if (!targetBracket.final_criteria) {
                                                                                            targetBracket.final_criteria = [];
                                                                                        }
                                                                                        const targetCriteria =
                                                                                            targetBracket.final_criteria[
                                                                                                criteriaIndex
                                                                                            ];
                                                                                        if (targetCriteria) {
                                                                                            targetCriteria.classification = value;
                                                                                        }
                                                                                        setAgeBrackets(updated);
                                                                                    }}
                                                                                    style={{width: 150}}
                                                                                >
                                                                                    <Select.Option value="advance">
                                                                                        Advanced
                                                                                    </Select.Option>
                                                                                    <Select.Option value="intermediate">
                                                                                        Intermediate
                                                                                    </Select.Option>
                                                                                    <Select.Option value="beginner">
                                                                                        Beginner
                                                                                    </Select.Option>
                                                                                </Select>
                                                                                <InputNumber
                                                                                    value={criteria.number}
                                                                                    placeholder="Number"
                                                                                    min={0}
                                                                                    onChange={(value) => {
                                                                                        const updated = [...ageBrackets];
                                                                                        const targetBracket = updated[id];
                                                                                        if (!targetBracket) {
                                                                                            return;
                                                                                        }
                                                                                        if (!targetBracket.final_criteria) {
                                                                                            targetBracket.final_criteria = [];
                                                                                        }
                                                                                        const targetCriteria =
                                                                                            targetBracket.final_criteria[
                                                                                                criteriaIndex
                                                                                            ];
                                                                                        if (targetCriteria) {
                                                                                            targetCriteria.number = value ?? 0;
                                                                                        }
                                                                                        setAgeBrackets(updated);
                                                                                    }}
                                                                                    style={{width: 100}}
                                                                                />
                                                                                <Button
                                                                                    status="danger"
                                                                                    onClick={() => {
                                                                                        const updated = [...ageBrackets];
                                                                                        const targetBracket = updated[id];
                                                                                        if (!targetBracket?.final_criteria) {
                                                                                            return;
                                                                                        }
                                                                                        targetBracket.final_criteria.splice(
                                                                                            criteriaIndex,
                                                                                            1,
                                                                                        );
                                                                                        setAgeBrackets(updated);
                                                                                    }}
                                                                                >
                                                                                    <IconDelete />
                                                                                </Button>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    <Button
                                                                        type="text"
                                                                        size="small"
                                                                        onClick={() => {
                                                                            const updated = [...ageBrackets];
                                                                            const targetBracket = updated[id];
                                                                            if (!targetBracket) {
                                                                                return;
                                                                            }
                                                                            if (!targetBracket.final_criteria) {
                                                                                targetBracket.final_criteria = [];
                                                                            }
                                                                            targetBracket.final_criteria.push({
                                                                                classification: "intermediate",
                                                                                number: 10,
                                                                                _tempId: crypto.randomUUID(),
                                                                            } as FinalCriterionWithId);
                                                                            setAgeBrackets(updated);
                                                                        }}
                                                                        disabled={(bracket.final_criteria?.length ?? 0) >= 4}
                                                                    >
                                                                        <IconPlus /> Add Final Criteria
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                    <Button
                                                        type="text"
                                                        onClick={() =>
                                                            setAgeBrackets([
                                                                ...ageBrackets,
                                                                {
                                                                    name: "",
                                                                    min_age: 0,
                                                                    max_age: 0,
                                                                    number_of_participants: 0,
                                                                    final_criteria: getPredefinedFinalCriteria("Individual"),
                                                                    _id: crypto.randomUUID(),
                                                                } as AgeBracketWithId,
                                                            ])
                                                        }
                                                    >
                                                        <IconPlus /> Add Bracket
                                                    </Button>
                                                </>
                                            );
                                        }}
                                    </Form.List>
                                </Drawer>

                                <Form.Item label="Description" field="description">
                                    <MDEditor
                                        value={form.getFieldValue("description")}
                                        onChange={(value) => {
                                            form.setFieldValue("description", value);
                                        }}
                                        height={300}
                                    />
                                </Form.Item>

                                {/* Agenda Upload (PDF) */}
                                <Form.Item
                                    label="Agenda (PDF)"
                                    field="agenda"
                                    extra="Only PDF file allowed"
                                    rules={[{required: false}]}
                                >
                                    <Upload
                                        accept=".pdf"
                                        limit={1}
                                        fileList={agendaUploadList}
                                        onChange={(fileList) => {
                                            if (fileList.length === 0) {
                                                form.setFieldValue("agenda", null);
                                                setAgendaUploadList([]);
                                                return;
                                            }

                                            const rawFile = fileList[0]?.originFile || undefined;
                                            form.setFieldValue("agenda", rawFile);
                                            setAgendaUploadList([
                                                {
                                                    uid: "agenda-file",
                                                    name: rawFile?.name,
                                                    originFile: rawFile,
                                                    status: "done",
                                                },
                                            ]);
                                        }}
                                        showUploadList
                                    />
                                </Form.Item>

                                {/* Logo Upload (Image) */}
                                <Form.Item
                                    label="Tournament Logo"
                                    field="logo"
                                    extra="PNG or JPG file"
                                    rules={[{required: false}]}
                                >
                                    <Upload
                                        accept="image/png,image/jpeg"
                                        limit={1}
                                        fileList={logoUploadList}
                                        onChange={(fileList) => {
                                            if (fileList.length === 0) {
                                                form.setFieldValue("logo", null);
                                                setLogoUploadList([]);
                                                return;
                                            }

                                            const rawFile = fileList[0]?.originFile || undefined;
                                            form.setFieldValue("logo", rawFile);
                                            setLogoUploadList([
                                                {
                                                    uid: "logo-file",
                                                    name: rawFile?.name,
                                                    originFile: rawFile,
                                                    status: "done",
                                                },
                                            ]);
                                        }}
                                        showUploadList
                                        listType="picture-card"
                                        imagePreview
                                    />
                                </Form.Item>

                                {/* Payment Methods */}
                                <Form.Item label="Payment Methods">
                                    <Form.List field="payment_methods">
                                        {(fields, {add, remove}) => (
                                            <>
                                                {fields.map((field, index) => {
                                                    const paymentMethods = form.getFieldValue("payment_methods") || [];
                                                    const currentMethod = paymentMethods[index] || {};

                                                    return (
                                                        <div key={field.key} className="border p-4 mb-4 rounded">
                                                            <div className="flex justify-between items-center mb-3">
                                                                <h4 className="text-sm font-medium">
                                                                    Payment Method {index + 1}
                                                                </h4>
                                                                <Button
                                                                    status="danger"
                                                                    size="small"
                                                                    onClick={() => remove(index)}
                                                                >
                                                                    <IconDelete /> Remove
                                                                </Button>
                                                            </div>

                                                            <Form.Item
                                                                label="Account Name"
                                                                field={`payment_methods[${index}].account_name`}
                                                                rules={[{required: true, message: "Please enter account name"}]}
                                                            >
                                                                <Input placeholder="Enter account holder name" />
                                                            </Form.Item>

                                                            <Form.Item
                                                                label="Account Number"
                                                                field={`payment_methods[${index}].account_number`}
                                                                rules={[{required: true, message: "Please enter account number"}]}
                                                            >
                                                                <Input placeholder="Enter account number" />
                                                            </Form.Item>

                                                            <Form.Item
                                                                label="Description (Optional)"
                                                                field={`payment_methods[${index}].description`}
                                                            >
                                                                <Input.TextArea
                                                                    placeholder="e.g., Bank name, payment platform"
                                                                    rows={2}
                                                                />
                                                            </Form.Item>

                                                            <Form.Item
                                                                label="QR Code Image (Optional)"
                                                                extra="PNG or JPG file for payment QR code"
                                                            >
                                                                <Upload
                                                                    accept="image/png,image/jpeg"
                                                                    limit={1}
                                                                    defaultFileList={
                                                                        currentMethod.qr_code_image
                                                                            ? [
                                                                                  {
                                                                                      uid: `qr-${index}`,
                                                                                      name: "QR Code",
                                                                                      url: currentMethod.qr_code_image,
                                                                                      status: "done" as const,
                                                                                  },
                                                                              ]
                                                                            : []
                                                                    }
                                                                    onChange={(fileList) => {
                                                                        const currentMethods =
                                                                            form.getFieldValue("payment_methods") || [];
                                                                        if (!currentMethods[index]) {
                                                                            currentMethods[index] = {
                                                                                id: crypto.randomUUID(),
                                                                                account_name: "",
                                                                                account_number: "",
                                                                            };
                                                                        }
                                                                        currentMethods[index].qr_code_file =
                                                                            fileList[0]?.originFile || null;
                                                                        form.setFieldValue("payment_methods", currentMethods);
                                                                    }}
                                                                    showUploadList
                                                                    listType="picture-card"
                                                                    imagePreview
                                                                />
                                                            </Form.Item>
                                                        </div>
                                                    );
                                                })}
                                                <Button
                                                    type="dashed"
                                                    long
                                                    onClick={() =>
                                                        add({
                                                            id: crypto.randomUUID(),
                                                            account_name: "",
                                                            account_number: "",
                                                            description: "",
                                                            qr_code_image: null,
                                                        })
                                                    }
                                                >
                                                    <IconPlus /> Add Payment Method
                                                </Button>
                                            </>
                                        )}
                                    </Form.List>
                                </Form.Item>

                                <Form.Item className={`w-full`} wrapperCol={{span: 24}}>
                                    <Button type="primary" htmlType="submit" loading={loading} className={`w-full`}>
                                        {loading ? <Spin /> : "Save Changes"}
                                    </Button>
                                </Form.Item>
                            </Form>
                        </div>
                    </Spin>
                )}
            </Modal>

            <Modal
                title="View Tournament"
                visible={viewModalVisible}
                onCancel={() => setViewModalVisible(false)}
                footer={null}
                className={`my-8 w-full md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                <div className={`flex flex-col items-center`}>
                    <Image src={`${selectedTournament?.logo}`} alt="logo" width={200} />
                    <Descriptions
                        column={1}
                        title={
                            <Title style={{textAlign: "center", width: "100%"}} heading={3}>
                                {selectedTournament?.name}
                            </Title>
                        }
                        data={tournamentData}
                        style={{marginBottom: 20}}
                        labelStyle={{textAlign: "right", paddingRight: 36}}
                    />
                    <Modal
                        title="Tournament Description"
                        visible={descriptionModalVisible}
                        onCancel={() => setDescriptionModalVisible(false)}
                        footer={null}
                        className={`m-10 w-1/2`}
                    >
                        <MDEditor.Markdown source={selectedTournament?.description ?? ""} />
                    </Modal>
                </div>
            </Modal>
        </div>
    );
}
