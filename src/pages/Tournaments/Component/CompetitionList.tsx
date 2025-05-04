import {Timestamp} from "firebase/firestore";
import {
    Button,
    Cascader,
    DatePicker,
    Form,
    Input,
    InputNumber,
    Message,
    Modal,
    Select,
    Table,
    type TableColumnProps,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {useEffect, useState} from "react";
import type {AgeBracket, Competition} from "../../../schema"; // 就是你那个 CompetitionSchema infer出来的type
import {useAuthContext} from "../../../context/AuthContext";
import {IconDelete, IconEdit, IconPlus} from "@arco-design/web-react/icon";
import {countries} from "../../../schema/Country";
import dayjs, {type Dayjs} from "dayjs";
import {fetchCompetitionsByType, updateCompetition} from "../../../services/firebase/competitionsService";
import LoginForm from "../../../components/common/Login";

import {useDeviceBreakpoint} from "../../../utils/DeviceInspector";
import {DeviceBreakpoint} from "../../../hooks/DeviceInspector/deviceStore";
import {useSmartDateHandlers} from "../../../hooks/DateHandler/useSmartDateHandlers";
import AgeBracketModal from "./AgeBracketModal";
import EventFields from "./EventField";

const {Title, Paragraph} = Typography;
type CompetitionFormData = Competition & {
    date_range: [Timestamp | Date, Timestamp | Date];
    registration_date_range: [Timestamp | Date, Timestamp | Date];
};

interface CompetitionListProps {
    type: "current" | "history";
}

export default function CompetitionList({type}: Readonly<CompetitionListProps>) {
    const {user} = useAuthContext();
    const [form] = Form.useForm();
    const deviceBreakpoint = useDeviceBreakpoint();
    const {handleCompetitionDateChange, handleRangeChangeSmart} = useSmartDateHandlers(form);

    const {RangePicker} = DatePicker;

    const [competitions, setCompetitions] = useState<Competition[]>([]);
    const [selectedCompetition, setSelectedCompetition] = useState<Competition | null>(null);

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [loginModalVisible, setLoginModalVisible] = useState(false);

    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
    const [ageBrackets, setAgeBrackets] = useState<AgeBracket[]>([]);
    const [ageBracketModalVisible, setAgeBracketModalVisible] = useState(false);

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
            width: 150,
            render: (_: string, competition: Competition) =>
                user?.roles?.edit_competition ? (
                    <Button type="primary" size="mini" onClick={() => handleEdit(competition)}>
                        <IconEdit />
                        Edit
                    </Button>
                ) : (
                    <Button type="primary" size="mini" onClick={() => handleRegister(competition.id ?? "")}>
                        Register
                    </Button>
                ),
        },
    ];

    const handleEditAgeBrackets = (index: number) => {
        const currentEvents = form.getFieldValue("events") ?? [];
        setEditingEventIndex(index);
        setAgeBrackets(currentEvents[index]?.age_brackets ?? []);
        setAgeBracketModalVisible(true);
    };

    const handleSaveAgeBrackets = () => {
        if (editingEventIndex === null) return;

        // 检查是否所有字段填写完整
        for (const [i, bracket] of ageBrackets.entries()) {
            if (!bracket.name || bracket.min_age === null || bracket.max_age === null || bracket.min_age > bracket.max_age) {
                Message.error(`Please fill in all fields correctly for bracket ${i + 1}.`);
                return;
            }
        }

        // 检查是否有年龄重叠
        const usedAges = new Set<number>();
        for (const bracket of ageBrackets) {
            for (let age = bracket.min_age; age <= bracket.max_age; age++) {
                if (usedAges.has(age)) {
                    Message.error(`Age conflict detected: Age ${age} appears in multiple brackets.`);
                    return;
                }
                usedAges.add(age);
            }
        }

        const currentEvents = [...(form.getFieldValue("events") ?? [])];
        currentEvents[editingEventIndex].age_brackets = ageBrackets;
        form.setFieldValue("events", currentEvents);
        setAgeBracketModalVisible(false);
        setEditingEventIndex(null);
    };

    const makeHandleDeleteBracket = (idx: number) => {
        return () => {
            setAgeBrackets((prev) => prev.filter((_, i) => i !== idx));
        };
    };

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
                title="Edit Competition"
                visible={editModalVisible}
                onCancel={() => setEditModalVisible(false)}
                footer={null}
                className={`my-8`}
            >
                {selectedCompetition && (
                    <Form form={form} layout="vertical" onSubmit={handleSubmit} requiredSymbol={false}>
                        <Form.Item label="Competition Name" field="name" rules={[{required: true}]}>
                            <Input placeholder="Enter competition name" />
                        </Form.Item>

                        <Form.Item label="Competition Date Range" field="date_range" rules={[{required: true}]}>
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
                                onChange={handleCompetitionDateChange}
                            />
                        </Form.Item>

                        <Form.Item label="Country / State" field="country" rules={[{required: true}]}>
                            <Cascader options={countries} placeholder="Select country/state" />
                        </Form.Item>

                        <Form.Item label="Address" field="address" rules={[{required: true}]}>
                            <Input placeholder="Enter address" />
                        </Form.Item>

                        <Form.Item
                            label="Registration Date Range"
                            field="registration_date_range"
                            rules={[{required: true, message: "Please input registration date"}]}
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

                        <Form.Item label="Maximum Participants" field="max_participants">
                            <InputNumber min={1} style={{width: "100%"}} placeholder="Enter max number" />
                        </Form.Item>

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
                                    <Button type="text" onClick={() => add({code: "", type: "", age_brackets: []})}>
                                        <IconPlus /> Add Event
                                    </Button>
                                </>
                            )}
                        </Form.List>

                        <AgeBracketModal
                            visible={ageBracketModalVisible}
                            brackets={ageBrackets}
                            onChange={setAgeBrackets}
                            onDeleteBracket={makeHandleDeleteBracket}
                            onCancel={() => setAgeBracketModalVisible(false)}
                            onSave={handleSaveAgeBrackets}
                        />

                        <Form.Item label="Final Criteria">
                            <Form.List field="final_criteria">
                                {(fields, {add, remove}) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className="flex gap-4 items-center mb-4">
                                                <Form.Item
                                                    field={`final_criteria.${index}.type`}
                                                    rules={[{required: true, message: "Please select type"}]}
                                                    className={`w-80`}
                                                >
                                                    <Select placeholder="Select Type">
                                                        <Select.Option value="individual">Individual</Select.Option>
                                                        <Select.Option value="team">Team</Select.Option>
                                                    </Select>
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_criteria.${index}.number`}
                                                    rules={[{required: true}]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="Top N" />
                                                </Form.Item>
                                                <Button status="danger" onClick={() => remove(index)} className={`mb-8`}>
                                                    <IconDelete />
                                                </Button>
                                            </div>
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
                                            <div key={field.key} className="flex gap-4 items-center mb-4">
                                                <Form.Item
                                                    field={`final_categories.${index}.name`}
                                                    rules={[{required: true}]}
                                                    className={`w-80`}
                                                >
                                                    <Input placeholder="Category Name" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_categories.${index}.start`}
                                                    rules={[{required: true}]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="Start Rank" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_categories.${index}.end`}
                                                    rules={[{required: true}]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="End Rank" />
                                                </Form.Item>
                                                <Button status="danger" onClick={() => remove(index)} className={`mb-8`}>
                                                    <IconDelete />
                                                </Button>
                                            </div>
                                        ))}
                                        <Button type={`text`} onClick={() => add()}>
                                            <IconPlus /> Add Final Category
                                        </Button>
                                    </>
                                )}
                            </Form.List>
                        </Form.Item>

                        <Form.Item>
                            <Button type="primary" htmlType="submit" loading={loading} long>
                                Save Changes
                            </Button>
                        </Form.Item>
                    </Form>
                )}
            </Modal>
        </div>
    );
}
