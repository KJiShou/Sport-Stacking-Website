import {
    Button,
    Cascader,
    DatePicker,
    Dropdown,
    Form,
    Grid,
    Input,
    InputNumber,
    Message,
    Modal,
    Popconfirm,
    Popover,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
    Typography,
} from "@arco-design/web-react";
import { IconArrowFall, IconArrowRise, IconDelete, IconEdit, IconMore, IconPlayArrow, IconPlus } from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import { Timestamp } from "firebase/firestore";
import { useEffect, useState } from "react";
import LoginForm from "@/components/common/Login";
import { useAuthContext } from "@/context/AuthContext";
import type { Competition } from "@/schema"; // 就是你那个 CompetitionSchema infer出来的type
import { countries } from "@/schema/Country";
import { deleteCompetitionById, fetchCompetitionsByType, updateCompetition } from "@/services/firebase/competitionsService";

import { useSmartDateHandlers } from "@/hooks/DateHandler/useSmartDateHandlers";
import { DeviceBreakpoint } from "@/hooks/DeviceInspector/deviceStore";
import { useDeviceBreakpoint } from "@/utils/DeviceInspector";
import AgeBracketModal from "./AgeBracketModal";
import EventFields from "./EventField";
import FinalCategoriesFields from "./FinalCategoriesFields";
import FinalCriteriaFields from "./FinalCriteriaFields";
import { useAgeBracketEditor } from "./useAgeBracketEditor";
import { useCompetitionFormPrefill } from "./useCompetitionFormPrefill";
import LocationPicker, { isValidCountryPath } from "./LocationPicker";
import { useNavigate } from "react-router-dom";

type CompetitionFormData = Competition & {
    date_range: [Timestamp | Date, Timestamp | Date];
    registration_date_range: [Timestamp | Date, Timestamp | Date];
};

interface CompetitionListProps {
    type: "current" | "history";
}

export default function CompetitionList({ type }: Readonly<CompetitionListProps>) {
    const { user } = useAuthContext();
    const [form] = Form.useForm();
    const navigate = useNavigate();

    const deviceBreakpoint = useDeviceBreakpoint();

    const { handleCompetitionDateChange, handleRangeChangeSmart } = useSmartDateHandlers(form);

    const { RangePicker } = DatePicker;

    const {
        ageBracketModalVisible,
        ageBrackets,
        setAgeBrackets,
        handleEditAgeBrackets,
        handleSaveAgeBrackets,
        makeHandleDeleteBracket,
        setAgeBracketModalVisible,
    } = useAgeBracketEditor(form);

    useCompetitionFormPrefill(form);
    const [selectedCompetition, setSelectedCompetition] = useState<Competition | null>(null);

    const [competitions, setCompetitions] = useState<Competition[]>([]);

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [loginModalVisible, setLoginModalVisible] = useState(false);

    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);

    const [loading, setLoading] = useState(true);

    const columns: (TableColumnProps<(typeof competitions)[number]> | false)[] = [
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
            render: (_: string, competition: Competition) =>
                user?.roles?.edit_competition ? (
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
                                    onClick={async () => handleEdit(competition)}
                                >
                                    <IconEdit /> Edit
                                </Button>
                                <Button
                                    type="text"
                                    status="danger"
                                    loading={loading}
                                    className={`text-left`}
                                    onClick={async () => handleDelete(competition)}
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
                ) : competition.registration_end_date > Timestamp.now() ? (
                    <Button type="primary" onClick={() => handleRegister(competition.id ?? "")}>
                        Register
                    </Button>
                ) : (
                    <Popover
                        content={
                            <span>
                                <p>This competition has end registration date.</p>
                            </span>
                        }
                    >
                        <Button type="primary" disabled>
                            Register
                        </Button>
                    </Popover>
                ),
        },
    ];

    const fetchCompetitions = async () => {
        setLoading(true);

        try {
            const list = await fetchCompetitionsByType(type);

            setCompetitions(list);
        } catch (error) {
            console.error("Failed to fetch competitions:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (values: CompetitionFormData) => {
        if (!selectedCompetition?.id) return;
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

            const fullEvents: Competition["events"] = form.getFieldValue("events");
            updateCompetition(user, selectedCompetition.id, {
                name: values.name,
                start_date: startDate,
                end_date: endDate,
                country: values.country,
                address: values.address,
                registration_start_date: registrationStartDate,
                registration_end_date: registrationEndDate,
                max_participants: values.max_participants,
                events: fullEvents,
                final_criteria: values.final_criteria,
                final_categories: values.final_categories,
                status: values.status,
                participants: selectedCompetition.participants,
            });
            setEditModalVisible(false);
            await fetchCompetitions();

            Message.success("Competition updated successfully!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to update competition.");
        } finally {
            setLoading(false);
        }
    };
    const handleEdit = (competition: Competition) => {
        setSelectedCompetition(competition);
        setEditModalVisible(true);
    };

    const handleDelete = async (competition: Competition) => {
        Modal.confirm({
            title: "Delete Confirmation",
            content: `Are you sure you want to delete the competition "${competition.name}"?`,
            okText: "Yes",
            cancelText: "Cancel",
            onOk: async () => {
                try {
                    setLoading(true);
                    if (!user) {
                        Message.error("You must be logged in to delete a competition.");
                        return;
                    }
                    await deleteCompetitionById(user, competition?.id ?? "");
                    Message.success("Competition deleted successfully.");
                    await fetchCompetitions();
                } catch (error) {
                    Message.error("Failed to delete competition.");
                    console.error(error);
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleRegister = (competitionId: string) => {
        if (!user) {
            setLoginModalVisible(true);
            return;
        }
        if (!competitionId) {
            Message.error("Invalid competition ID.");
            return;
        }
        // Open the registration page in a new tab
        window.open(`/tournaments/${competitionId}/register`, "_blank");
    };

    useEffect(() => {
        if (selectedCompetition) {
            form.setFieldsValue({
                name: selectedCompetition.name,
                country: selectedCompetition.country,
                address: selectedCompetition.address,
                max_participants: selectedCompetition.max_participants,
                date_range: [
                    selectedCompetition.start_date instanceof Timestamp
                        ? dayjs(selectedCompetition.start_date.toDate())
                        : dayjs(selectedCompetition.start_date),
                    selectedCompetition.end_date instanceof Timestamp
                        ? dayjs(selectedCompetition.end_date.toDate())
                        : dayjs(selectedCompetition.end_date),
                ],
                registration_date_range: [
                    selectedCompetition.registration_start_date instanceof Timestamp
                        ? dayjs(selectedCompetition.registration_start_date.toDate())
                        : dayjs(selectedCompetition.registration_start_date),
                    selectedCompetition.registration_end_date instanceof Timestamp
                        ? dayjs(selectedCompetition.registration_end_date.toDate())
                        : dayjs(selectedCompetition.registration_end_date),
                ],
                events: selectedCompetition.events,
                final_criteria: selectedCompetition.final_criteria,
                final_categories: selectedCompetition.final_categories,
            });
        }
    }, [selectedCompetition, form]);

    useEffect(() => {
        fetchCompetitions();
    }, [type]);

    return (
        <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
            <div className="relative w-full flex items-center">
                <h1 className="absolute left-1/2 transform -translate-x-1/2 text-4xl font-semibold">
                    {type === "current" ? "Current Competitions" : "Competition History"}
                </h1>
                <div className="ml-auto">
                    <div className="ml-auto">
                        {user?.roles?.edit_competition && (
                            <a href="/tournaments/create" target="_blank" rel="noopener noreferrer">
                                <Button type="primary">Create Competition</Button>
                            </a>
                        )}
                    </div>
                </div>
            </div>

            {/* 表格 */}
            <Table
                rowKey="id"
                columns={columns.filter((e) => !!e)}
                data={competitions}
                pagination={{ pageSize: 10 }}
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
                title="Edit Competition"
                visible={editModalVisible}
                onCancel={() => setEditModalVisible(false)}
                footer={null}
                className={`my-8 w-full md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                {selectedCompetition && (
                    <Form form={form} layout="horizontal" onSubmit={handleSubmit} requiredSymbol={false}>
                        <Form.Item label="Competition Name" field="name" rules={[{ required: true }]}>
                            <Input placeholder="Enter competition name" />
                        </Form.Item>

                        <Form.Item label="Competition Date Range" field="date_range" rules={[{ required: true }]}>
                            <RangePicker
                                showTime={{
                                    defaultValue: ["08:00", "18:00"],
                                    format: "HH:mm",
                                }}
                                style={{ width: "100%" }}
                                disabledDate={(current) => {
                                    const today = dayjs();
                                    return current?.isBefore(today.add(7, "day"), "day");
                                }}
                                onChange={handleCompetitionDateChange}
                            />
                        </Form.Item>

                        <Form.Item
                            label="Country / State"
                            field="country"
                            rules={[{ required: true, message: "Please select a country/region" }]}
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

                        {/* Address */}
                        <Form.Item label="Address" field="address" rules={[{ required: true, message: "Please input address" }]}>
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
                            rules={[{ required: true, message: "Please input registration date" }]}
                        >
                            <RangePicker
                                showTime={{
                                    defaultValue: [dayjs("08:00", "HH:mm"), dayjs("18:00", "HH:mm")],
                                    format: "HH:mm",
                                }}
                                style={{ width: "100%" }}
                                disabledDate={(current) => current?.isBefore(dayjs(), "day")}
                                onChange={handleRangeChangeSmart("registration_date_range")}
                            />
                        </Form.Item>

                        <Form.Item label="Maximum Participants" field="max_participants">
                            <InputNumber min={1} style={{ width: "100%" }} placeholder="Enter max number" />
                        </Form.Item>
                        <Form.Item label="Events">
                            <Form.List field="events">
                                {(fields, { add, remove }) => (
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
                                                        { name: "Under 10", min_age: 0, max_age: 9 },
                                                        { name: "10 and Above", min_age: 10, max_age: 99 },
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
                                {(fields, { add, remove }) => {
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
                                                    <div key={`bracket-${index}`} className="flex gap-4 mb-4 w-full">
                                                        <Form.Item
                                                            label="Bracket Name"
                                                            required
                                                            validateStatus={!bracket.name ? "error" : undefined}
                                                            help={!bracket.name ? "Please enter bracket name" : undefined}
                                                            className="w-1/3"
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
                                                    setAgeBrackets([...ageBrackets, { name: "", min_age: 0, max_age: 0 }])
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
                                {(fields, { add, remove }) => (
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
                                {(fields, { add, remove }) => (
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

                        <Form.Item className={`w-full`} wrapperCol={{ span: 24 }}>
                            <Button type="primary" htmlType="submit" loading={loading} className={`w-full`}>
                                {loading ? <Spin /> : "Save Changes"}
                            </Button>
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </div>
    );
}
