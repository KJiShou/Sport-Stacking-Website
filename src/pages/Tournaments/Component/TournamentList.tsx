import LoginForm from "@/components/common/Login";
import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Tournament} from "@/schema"; // 就是你那个 TournamentSchema infer出来的type
import {countries} from "@/schema/Country";
import {deleteTournamentById, fetchTournamentsByType, updateTournament} from "@/services/firebase/tournamentsService";
import {
    Button,
    Cascader,
    DatePicker,
    Dropdown,
    Form,
    Input,
    InputNumber,
    Message,
    Modal,
    Popover,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
    Tooltip,
    Upload,
    Descriptions,
    Image,
    Link,
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
} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";
import {type ReactNode, useEffect, useState} from "react";

import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {uploadFile} from "@/services/firebase/storageService";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import MDEditor from "@uiw/react-md-editor";
import {useNavigate} from "react-router-dom";
import EventFields from "./EventField";
import FinalCategoriesFields from "./FinalCategoriesFields";
import FinalCriteriaFields from "./FinalCriteriaFields";
import LocationPicker, {isValidCountryPath} from "./LocationPicker";
import {useAgeBracketEditor} from "./useAgeBracketEditor";
import {useTournamentFormPrefill} from "./useTournamentFormPrefill";
import type {UploadItem} from "@arco-design/web-react/es/Upload";
import {set} from "zod";
import Title from "@arco-design/web-react/es/Typography/title";
import {formatDate} from "@/utils/Date/formatDate";

type TournamentFormData = Tournament & {
    date_range: [Timestamp | Date, Timestamp | Date];
    registration_date_range: [Timestamp | Date, Timestamp | Date];
};

interface TournamentListProps {
    type: "current" | "history";
}

export default function TournamentList({type}: Readonly<TournamentListProps>) {
    const {user} = useAuthContext();
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

    useTournamentFormPrefill(form);
    const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);

    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [tournamentData, setTournamentData] = useState<{label?: ReactNode; value?: ReactNode}[]>([]);

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [loginModalVisible, setLoginModalVisible] = useState(false);
    const [viewModalVisible, setViewModalVisible] = useState(false);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);

    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);

    const [loading, setLoading] = useState(true);

    const [agendaUploadList, setAgendaUploadList] = useState<UploadItem[]>([]);
    const [logoUploadList, setLogoUploadList] = useState<UploadItem[]>([]);

    function hasRegistered(user: FirestoreUser, tournamentId: string): boolean {
        return (user.registration_records ?? []).some((record) => record.tournament_id === tournamentId);
    }

    const columns: (TableColumnProps<(typeof tournaments)[number]> | false)[] = [
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
            render: (status: string) => {
                let color: string | undefined;
                if (status === "Up Coming") {
                    color = "blue";
                } else if (status === "On Going") {
                    color = "green";
                } else if (status === "Close Registration") {
                    color = "red";
                } else if (status === "End") {
                    color = "gray";
                } else {
                    color = undefined;
                }
                return <Tag color={color}>{status}</Tag>;
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

                if (user?.roles?.edit_tournament || user?.global_id === tournament?.editor) {
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
                                        onClick={async () => navigate(`/tournaments/${tournament.id}/registrations`)}
                                    >
                                        <IconEye /> View Registration List
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
                                onClick: () => navigate(``),
                            }}
                        >
                            <IconPlayArrow />
                            Start
                        </Dropdown.Button>
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

    const fetchTournaments = async () => {
        setLoading(true);

        try {
            const list = await fetchTournamentsByType(type);

            setTournaments(list);
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

            const fullEvents: Tournament["events"] = form.getFieldValue("events");

            const agendaFile = form.getFieldValue("agenda");
            const logoFile = form.getFieldValue("logo");

            let agendaUrl = selectedTournament?.agenda ?? "";
            let logoUrl = selectedTournament?.logo ?? "";

            // 只有是 File 的才上传
            if (agendaFile instanceof File) {
                agendaUrl = await uploadFile(agendaFile, `agendas/${selectedTournament.id}`);
            }
            if (logoFile instanceof File) {
                logoUrl = await uploadFile(logoFile, `logos/${selectedTournament.id}`);
            }
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
                events: fullEvents,
                final_criteria: values.final_criteria,
                final_categories: values.final_categories,
                status: values.status,
                participants: selectedTournament.participants,
                editor: values.editor,
                recorder: values.recorder,
                description: values.description ?? null,
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
    };

    const handleView = (tournament: Tournament) => {
        setSelectedTournament(tournament);
        setViewModalVisible(true);
        setTournamentData([
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
        // Open the registration page in a new tab
        window.open(`/tournaments/${tournamentId}/register`, "_blank");
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
                events: selectedTournament.events,
                final_criteria: selectedTournament.final_criteria,
                final_categories: selectedTournament.final_categories,
                description: selectedTournament.description ?? "",
                agenda: selectedTournament.agenda ?? null,
                logo: selectedTournament.logo ?? null,
            });
        }
    }, [selectedTournament, form]);

    useEffect(() => {
        fetchTournaments();
    }, [type]);

    return (
        <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
            <div className="relative w-full flex items-center">
                <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl font-semibold">
                    {type === "current" ? "Current Tournaments" : "Tournaments History"}
                </h1>
                <div className="ml-auto">
                    <div className="ml-auto">
                        {user?.roles?.edit_tournament && (
                            <a href="/tournaments/create" target="_blank" rel="noopener noreferrer">
                                <Button type="primary">Create Tournament</Button>
                            </a>
                        )}
                    </div>
                </div>
            </div>

            {/* 表格 */}
            <Table
                rowKey="id"
                columns={columns.filter((e): e is TableColumnProps<(typeof tournaments)[number]> => !!e)}
                data={tournaments}
                pagination={{pageSize: 10}}
                className="my-4"
                loading={loading}
            />

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
                                        Message.warning("This location is not in the selectable list. Please choose manually.");
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
                            label="Editor ID"
                            field="editor"
                            rules={[{required: true, message: "Please input editor global ID"}]}
                        >
                            <Input placeholder="Enter editor global ID" />
                        </Form.Item>

                        <Form.Item
                            label="Recorder ID"
                            field="recorder"
                            rules={[{required: true, message: "Please input recorder global ID"}]}
                        >
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
                                                    code: "",
                                                    type: "",
                                                    age_brackets: [
                                                        {
                                                            name: "Under 10",
                                                            min_age: 0,
                                                            max_age: 9,
                                                        },
                                                        {
                                                            name: "10 and Above",
                                                            min_age: 10,
                                                            max_age: 99,
                                                        },
                                                    ],
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
                                            {ageBrackets.map((bracket, index) => {
                                                const isMinError = bracket.min_age === null || bracket.min_age > bracket.max_age;

                                                let minAgeHelp: string | undefined;
                                                if (bracket.min_age === null) {
                                                    minAgeHelp = "Enter min age";
                                                } else if (bracket.min_age > bracket.max_age) {
                                                    minAgeHelp = "Min age > Max age";
                                                }

                                                // 2）再计算 Max Age 的校验状态和提示文字
                                                const isMaxError = bracket.max_age === null || bracket.max_age < bracket.min_age;

                                                let maxAgeHelp: string | undefined;
                                                if (bracket.max_age === null) {
                                                    maxAgeHelp = "Enter max age";
                                                } else if (bracket.max_age < bracket.min_age) {
                                                    maxAgeHelp = "Max age < Min age";
                                                }
                                                return (
                                                    <div
                                                        key={`bracket-${bracket.name}`}
                                                        className="flex gap-4 mb-4 w-full justify-center"
                                                    >
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
                                                                    updated[index].name = v;
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
                                                                    updated[index].min_age = v ?? 0;
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
                                                                    updated[index].max_age = v ?? 0;
                                                                    setAgeBrackets(updated);
                                                                }}
                                                                placeholder="Max Age"
                                                            />
                                                        </Form.Item>
                                                        <div className="flex items-end pb-8">
                                                            <Button status="danger" onClick={makeHandleDeleteBracket(index)}>
                                                                <IconDelete />
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

                        <Form.Item label="Final Criteria">
                            <Form.List field="final_criteria">
                                {(fields, {add, remove}) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <FinalCriteriaFields key={field.key} index={index} onRemove={remove} />
                                        ))}
                                        <Button type={`text`} onClick={() => add()}>
                                            <IconPlus /> Add Final Criteria
                                        </Button>
                                    </>
                                )}
                            </Form.List>
                        </Form.Item>
                        <Form.Item label="Final Categories">
                            <Form.List field="final_categories">
                                {(fields, {add, remove}) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <FinalCategoriesFields key={field.key} index={index} onRemove={remove} />
                                        ))}
                                        <Button type={`text`} onClick={() => add()}>
                                            <IconPlus /> Add Final Category
                                        </Button>
                                    </>
                                )}
                            </Form.List>
                        </Form.Item>

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
                        <Form.Item label="Agenda (PDF)" field="agenda" extra="Only PDF file allowed" rules={[{required: false}]}>
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
