import LoginForm from "@/components/common/Login";
import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Tournament, TournamentEvent} from "@/schema"; // 就是你那个 TournamentSchema infer出来的type
import {countries} from "@/schema/Country";
import {
    deleteTournamentById,
    fetchTournamentEvents,
    fetchTournamentsByType,
    saveTournamentEvents,
    updateTournament,
    updateTournamentStatus,
} from "@/services/firebase/tournamentsService";
import {
    Button,
    Card,
    Cascader,
    DatePicker,
    Descriptions,
    Divider,
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
    IconUser,
} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";
import {type ReactNode, useEffect, useRef, useState} from "react";

import {DEFAULT_AGE_BRACKET, DEFAULT_EVENTS} from "@/constants/tournamentDefaults";
import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {fetchUserByID} from "@/services/firebase/authService";
import {uploadFile} from "@/services/firebase/storageService";
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

const cloneEvent = (event: TournamentEvent): TournamentEvent => ({
    ...event,
    age_brackets: cloneAgeBrackets(event.age_brackets),
});

const EVENT_TYPE_OPTIONS: TournamentEvent["type"][] = ["Individual", "Double", "Team Relay", "Parent & Child", "Special Need"];

const isTournamentEventType = (value: unknown): value is TournamentEvent["type"] =>
    typeof value === "string" && EVENT_TYPE_OPTIONS.includes(value as TournamentEvent["type"]);

const EVENT_CODE_OPTIONS = ["3-3-3", "3-6-3", "Cycle"] as const;
type EventCode = (typeof EVENT_CODE_OPTIONS)[number];

const isEventCode = (value: unknown): value is EventCode =>
    typeof value === "string" && (EVENT_CODE_OPTIONS as readonly string[]).includes(value);

export default function TournamentList() {
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

    function hasRegistered(user: FirestoreUser, tournamentId: string): boolean {
        return (user.registration_records ?? []).some((record) => record.tournament_id === tournamentId);
    }

    const getUserRegistration = (user: FirestoreUser, tournamentId: string): UserRegistrationRecord | undefined => {
        return user.registration_records?.find((record) => record.tournament_id === tournamentId);
    };

    const columns: (TableColumnProps<(typeof currentTournaments)[number]> | false)[] = [
        {
            title: "Name",
            dataIndex: "name",
            width: 200,
        },
        {
            title: "Country / State",
            dataIndex: "country",
            width: 300,
            render: (country: string) => {
                return `${country[0]} / ${country[1]}`;
            },
        },
        {
            title: "Start Date",
            dataIndex: "start_date",
            width: 200,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "End Date",
            dataIndex: "end_date",
            width: 200,
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
                        color = "green";
                        displayText = "Approved";
                        tooltipMessage =
                            "Your registration has been approved! Contact us if you need to make any changes to your registration.";
                    } else if (registrationStatus === "rejected") {
                        color = "red";
                        displayText = "Rejected";
                        tooltipMessage =
                            "Your registration was rejected. Please contact us to discuss your registration or submit a new application.";
                    }
                } else {
                    // Show tournament status for non-registered users
                    if (status === "Up Coming") {
                        color = "blue";
                        tooltipMessage = "Tournament registration is open. Register now to participate!";
                    } else if (status === "On Going") {
                        color = "green";
                        tooltipMessage = "Tournament is currently in progress.";
                    } else if (status === "Close Registration") {
                        color = "red";
                        tooltipMessage = "Registration is closed. Contact us if you missed the deadline.";
                    } else if (status === "End") {
                        color = "gray";
                        tooltipMessage = "Tournament has ended.";
                    } else {
                        color = undefined;
                        tooltipMessage = status;
                    }
                }

                return (
                    <div>
                        <Tooltip content={tooltipMessage}>
                            <Tag color={color} style={{cursor: "pointer"}}>
                                {displayText}
                            </Tag>
                        </Tooltip>
                        {userHasRegistered && registrationStatus === "rejected" && rejectionReason && (
                            <div className="mt-1 text-xs text-red-500">Reason: {rejectionReason}</div>
                        )}
                    </div>
                );
            },
        },
        {
            title: "Action",
            dataIndex: "action",
            width: 200,
            render: (_: string, tournament: Tournament) => {
                if (!user) {
                    return (
                        <Button type="primary" onClick={() => handleRegister(tournament.id ?? "")}>
                            Register
                        </Button>
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
                        <Button
                            type="primary"
                            onClick={() => navigate(`/tournaments/${tournament.id}/register/${user.global_id}/view`)}
                            loading={loading}
                        >
                            <IconEye /> View Registration
                        </Button>
                    );
                }
                if (!tournament.registration_start_date || !tournament.registration_end_date) {
                    return;
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
                    <Popover
                        content={
                            <span>
                                <p>This tournament has ended registration.</p>
                            </span>
                        }
                    >
                        <Button type="primary" disabled>
                            Register
                        </Button>
                    </Popover>
                );
            },
        },
    ];

    const loadTournamentEvents = async (tournamentId: string) => {
        setEventsLoading(true);
        try {
            const events = await fetchTournamentEvents(tournamentId);
            setSelectedTournamentEvents(events);
            form.setFieldValue("events", events);
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
            const sanitizedEvents: TournamentEvent[] = [];

            for (const rawEvent of rawEvents) {
                const {__prevType: _ignored, age_brackets, id, type, codes, teamSize} = rawEvent;
                if (!isTournamentEventType(type)) {
                    continue;
                }

                const normalizedCodes = (codes ?? []).filter(isEventCode);
                if (normalizedCodes.length === 0) {
                    continue;
                }

                // Preserve existing event ID, don't generate new one
                const sanitizedEvent: TournamentEvent = {
                    id: id || crypto.randomUUID(), // Use existing ID or generate only if truly missing
                    type,
                    codes: normalizedCodes,
                    age_brackets: cloneAgeBrackets(age_brackets ?? DEFAULT_AGE_BRACKET),
                };

                if (typeof teamSize === "number") {
                    sanitizedEvent.teamSize = teamSize;
                }

                sanitizedEvents.push(sanitizedEvent);
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
                agendaUrl = await uploadFile(agendaFile, `agendas/${selectedTournament.id}`);
            }
            if (logoFile instanceof File) {
                logoUrl = await uploadFile(logoFile, `logos/${selectedTournament.id}`);
            }

            await saveTournamentEvents(selectedTournament.id, sanitizedEvents);
            const persistedEvents = sanitizedEvents.map((event) => cloneEvent(event));
            setSelectedTournamentEvents(persistedEvents);
            form.setFieldValue("events", persistedEvents);

            updateTournament(user, selectedTournament.id, {
                name: values.name,
                start_date: startDate,
                end_date: endDate,
                country: values.country,
                venue: values.venue,
                address: values.address,
                registration_start_date: registrationStartDate,
                registration_end_date: registrationEndDate,
                max_participants: values.max_participants,
                status: values.status,
                editor: values.editor ?? null,
                recorder: values.recorder ?? null,
                description: values.description ?? null,
                registration_fee: values.registration_fee,
                member_registration_fee: values.member_registration_fee,
                agenda: agendaUrl,
                logo: logoUrl,
            });
            setEditModalVisible(false);
            await fetchTournaments();

            Message.success("Tournament updated successfully!");
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
        setSelectedTournament(tournament);
        setViewModalVisible(true);
        setTournamentData([
            {
                label: "Registration Price",
                value: <div>RM{tournament?.registration_fee}</div>,
            },
            {
                label: "Member Registration Price",
                value: <div>RM{tournament?.member_registration_fee}</div>,
            },
            {
                label: "Location",
                value: (
                    <Link
                        onClick={() =>
                            window.open(
                                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tournament?.address ?? "")}`,
                                "_blank",
                            )
                        }
                        hoverable={false}
                    >
                        {tournament?.address} ({tournament?.country?.join(" / ")}) <IconLaunch />
                    </Link>
                ),
            },
            {
                label: "Venue",
                value: <div>{tournament?.venue}</div>,
            },
            {
                label: "Date",
                value: (
                    <div>
                        {formatDate(tournament?.start_date)} - {formatDate(tournament?.end_date)}
                    </div>
                ),
            },
            {
                label: "Max Participants",
                value: <div>{tournament?.max_participants === 0 ? "No Limit" : tournament?.max_participants}</div>,
            },
            {
                label: "Registration is open until",
                value: <div>{formatDate(tournament?.registration_end_date)}</div>,
            },
            {
                label: "Description",
                value: (
                    <Button onClick={() => setDescriptionModalVisible(true)} type="text">
                        <IconExclamationCircle />
                        view description
                    </Button>
                ),
            },
            {
                label: "Agenda",
                value: tournament?.agenda ? (
                    <Button type="text" onClick={() => window.open(`${tournament?.agenda}`, "_blank")}>
                        <IconCalendar /> View Agenda
                    </Button>
                ) : (
                    "-"
                ),
            },
        ]);
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
            <div className="relative w-full flex items-center">
                <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl font-semibold">Tournament Management</h1>
                <div className="ml-auto">
                    {user?.roles?.edit_tournament && (
                        <a href="/tournaments/create" target="_blank" rel="noopener noreferrer">
                            <Button type="primary">Create Tournament</Button>
                        </a>
                    )}
                </div>
            </div>

            <Tabs activeTab={activeTab} onChange={setActiveTab} type="capsule" className={`w-full`}>
                <TabPane key="current" title="Current Tournaments">
                    <Table
                        rowKey="id"
                        columns={columns.filter((e): e is TableColumnProps<Tournament> => !!e)}
                        data={currentTournaments}
                        pagination={{pageSize: 10}}
                        className="my-4"
                        loading={loading}
                    />
                </TabPane>
                <TabPane key="history" title="Tournament History">
                    <Table
                        rowKey="id"
                        columns={columns.filter((e): e is TableColumnProps<Tournament> => !!e)}
                        data={historyTournaments}
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
                className={`my-8 w-full md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                {selectedTournament && (
                    <Spin loading={eventsLoading} block>
                        <Form form={form} layout="horizontal" onSubmit={handleSubmit} requiredSymbol={false}>
                            <Form.Item label="Tournament Name" field="name" rules={[{required: true}]}>
                                <Input placeholder="Enter tournament name" />
                            </Form.Item>

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
                                <Input placeholder="Enter venue name" />
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
                                    onChange={(val) => form.setFieldValue("address", val)}
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

                            <Modal
                                title="Edit Age Brackets"
                                visible={ageBracketModalVisible}
                                onCancel={() => setAgeBracketModalVisible(false)}
                                onOk={handleSaveAgeBrackets}
                                className={`w-full md:max-w-[80vw] lg:max-w-[60vw]`}
                            >
                                <Form.List field="age_brackets_modal">
                                    {(fields, {add, remove}) => {
                                        return (
                                            <>
                                                {ageBrackets.map((bracket, id) => {
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
                                                        <div key={`bracket-${bracket.name}`} className="border p-4 mb-4 rounded">
                                                            <div className="flex gap-4 mb-4 w-full">
                                                                <Form.Item
                                                                    label="Bracket Name"
                                                                    required
                                                                    validateStatus={!bracket.name ? "error" : undefined}
                                                                    help={!bracket.name ? "Please enter bracket name" : undefined}
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
                                                                    <Button status="danger" onClick={makeHandleDeleteBracket(id)}>
                                                                        <IconDelete />
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                            {/* Final Criteria for this age bracket */}
                                                            <div className="mt-4">
                                                                <h4 className="text-sm font-medium mb-2">
                                                                    Final Criteria for {bracket.name}
                                                                </h4>
                                                                {bracket.final_criteria?.map((criteria, criteriaIndex) => (
                                                                    <div
                                                                        key={criteria.classification}
                                                                        className="flex gap-2 mb-2"
                                                                    >
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
                                                                                    targetBracket.final_criteria[criteriaIndex];
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
                                                                            <Select.Option value="prelim">Prelim</Select.Option>
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
                                                                                    targetBracket.final_criteria[criteriaIndex];
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
                                                                ))}
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
                                                                        });
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
                                                            },
                                                        ])
                                                    }
                                                >
                                                    <IconPlus /> Add Bracket
                                                </Button>
                                            </>
                                        );
                                    }}
                                </Form.List>
                            </Modal>

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
                            <Form.Item label="Tournament Logo" field="logo" extra="PNG or JPG file" rules={[{required: false}]}>
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

                            <Form.Item className={`w-full`} wrapperCol={{span: 24}}>
                                <Button type="primary" htmlType="submit" loading={loading} className={`w-full`}>
                                    {loading ? <Spin /> : "Save Changes"}
                                </Button>
                            </Form.Item>
                        </Form>
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
