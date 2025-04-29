import { db } from "../../../services/firebase/config"; // 你的 firebase 配置文件
import { collection, getDocs, query, where, orderBy, Timestamp, updateDoc, doc } from "firebase/firestore";
import {
    Button,
    Card,
    Cascader,
    DatePicker,
    Form,
    Input,
    InputNumber,
    Message,
    Modal,
    Select,
    Table,
    Tag,
    Typography,
} from "@arco-design/web-react";
import { useEffect, useState } from "react";
import type { Competition } from "../../../schema"; // 就是你那个 CompetitionSchema infer出来的type
import { useAuthContext } from "../../../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { IconDelete, IconEdit, IconPlus } from "@arco-design/web-react/icon";
import { countries } from "../../../schema/Country";
import dayjs, { type Dayjs } from "dayjs";
import { fetchCompetitionsByType, updateCompetition } from "../../../services/firebase/competitionsService";
import { reload } from "firebase/auth";

const { Title, Paragraph } = Typography;
type CompetitionFormData = Competition & {
    date_range: [Timestamp | Date, Timestamp | Date];
    registration_date_range: [Timestamp | Date, Timestamp | Date];
};

interface CompetitionListProps {
    type: "current" | "history";
}

export default function CompetitionList({ type }: CompetitionListProps) {
    const [competitions, setCompetitions] = useState<Competition[]>([]);
    const [loading, setLoading] = useState(true);
    const { user } = useAuthContext();
    const navigate = useNavigate();

    const [editModalVisible, setEditModalVisible] = useState(false);
    const [selectedCompetition, setSelectedCompetition] = useState<Competition | null>(null);

    const { RangePicker } = DatePicker;
    const [form] = Form.useForm();

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
                age_brackets: selectedCompetition.age_brackets,
                events: selectedCompetition.events,
                final_criteria: selectedCompetition.final_criteria,
                final_categories: selectedCompetition.final_categories,
            });
        }
    }, [selectedCompetition, form]);

    const handleCompetitionDateChange = (_: string[], dates: Dayjs[]) => {
        if (!dates || dates.length !== 2) return;

        const [startDate, endDate] = dates;

        const today = dayjs();
        const competitionStart = startDate;

        // 👉 先智能修正 start/end 时间
        const fixedStart =
            startDate.hour() === 0 && startDate.minute() === 0 && startDate.second() === 0
                ? startDate.hour(8).minute(0).second(0)
                : startDate;

        const fixedEnd =
            endDate.hour() === 0 && endDate.minute() === 0 && endDate.second() === 0
                ? endDate.hour(18).minute(0).second(0)
                : endDate;

        const oneMonthBefore = fixedStart.subtract(1, "month");
        const oneWeekBefore = fixedEnd.subtract(7, "day");

        const registrationStart = oneMonthBefore.isBefore(today) ? today : oneMonthBefore;
        const registrationEnd = oneWeekBefore;

        form.setFieldValue("date_range", [fixedStart.toDate(), fixedEnd.toDate()]);

        // 👉 只有当 registration_date_range 还没选过的时候才自动 set
        const currentRegistration = form.getFieldValue("registration_date_range");
        if (!currentRegistration || currentRegistration.length !== 2) {
            form.setFieldValue("registration_date_range", [registrationStart.toDate(), registrationEnd.toDate()]);
        }
    };

    const handleRangeChangeSmart = (fieldName: string) => (_: string[], dates: Dayjs[]) => {
        if (!dates || dates.length !== 2) return;

        const [start, end] = dates;

        const fixedStart =
            start.hour() === 0 && start.minute() === 0 && start.second() === 0 ? start.hour(8).minute(0).second(0) : start;

        const fixedEnd = end.hour() === 0 && end.minute() === 0 && end.second() === 0 ? end.hour(18).minute(0).second(0) : end;

        form.setFieldValue(fieldName, [fixedStart.toDate(), fixedEnd.toDate()]);
    };

    const handleSubmit = async (values: CompetitionFormData) => {
        if (!selectedCompetition?.id) return;
        setLoading(true);

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

        try {
            if (!user) return;
            updateCompetition(user, selectedCompetition.id, {
                name: values.name,
                start_date: startDate,
                end_date: endDate,
                country: values.country,
                address: values.address,
                registration_start_date: registrationStartDate,
                registration_end_date: registrationEndDate,
                max_participants: values.max_participants,
                age_brackets: values.age_brackets,
                events: values.events,
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
        window.open(`/tournaments/${competitionId}/register`, "_blank");
    };

    useEffect(() => {
        fetchCompetitions();
    }, [type]);

    const columns = [
        {
            title: "Name",
            dataIndex: "name",
            width: 200,
        },
        {
            title: "Country / State",
            dataIndex: "country",
            width: 200,
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
        {
            title: "End Date",
            dataIndex: "end_date",
            width: 200,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        {
            title: "Status",
            dataIndex: "status",
            width: 200,
            render: (status: string) => {
                const color =
                    status === "Up Coming"
                        ? "blue"
                        : status === "On Going"
                            ? "green"
                            : status === "Close Registration"
                                ? "red"
                                : "gray";
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
                columns={columns}
                data={competitions}
                pagination={{ pageSize: 10 }}
                className="my-4"
                loading={loading}
            />

            <Modal
                title="Edit Competition"
                visible={editModalVisible}
                onCancel={() => setEditModalVisible(false)}
                footer={null}
                className={`my-8`}
            >
                {selectedCompetition && (
                    <Form form={form} layout="vertical" onSubmit={handleSubmit} requiredSymbol={false}>
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

                        <Form.Item label="Country / State" field="country" rules={[{ required: true }]}>
                            <Cascader options={countries} placeholder="Select country/state" />
                        </Form.Item>

                        <Form.Item label="Address" field="address" rules={[{ required: true }]}>
                            <Input placeholder="Enter address" />
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

                        <Form.Item label="Events" className={`flex flex-col gap-4`}>
                            <Form.List field="events">
                                {(fields, { add, remove }) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className="flex gap-4 items-center mb-4">
                                                {/* Event Code 选择 */}
                                                <Form.Item
                                                    field={`events.${index}.code`}
                                                    rules={[{ required: true, message: "Please select event code" }]}
                                                    className={`w-80`}
                                                >
                                                    <Select placeholder="Select Code">
                                                        <Select.Option value="3-3-3">3-3-3</Select.Option>
                                                        <Select.Option value="3-6-3">3-6-3</Select.Option>
                                                        <Select.Option value="cycle">Cycle</Select.Option>
                                                    </Select>
                                                </Form.Item>

                                                {/* Type 选择 */}
                                                <Form.Item
                                                    field={`events.${index}.type`}
                                                    rules={[{ required: true, message: "Please select type" }]}
                                                    className={`w-80`}
                                                >
                                                    <Select placeholder="Select Type">
                                                        <Select.Option value="individual">Individual</Select.Option>
                                                        <Select.Option value="team">Team</Select.Option>
                                                    </Select>
                                                </Form.Item>

                                                <Button status="danger" onClick={() => remove(index)} className={`mb-8`}>
                                                    <IconDelete />
                                                </Button>
                                            </div>
                                        ))}

                                        {/* 新增一项 Event */}
                                        <Button type={`text`} onClick={() => add({ code: "", type: "" })}>
                                            <IconPlus /> Add Event
                                        </Button>
                                    </>
                                )}
                            </Form.List>
                        </Form.Item>

                        <Form.Item label="Age Brackets">
                            <Form.List field="age_brackets">
                                {(fields, { add, remove }) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className="flex gap-2 items-center mb-4">
                                                <Form.Item
                                                    field={`age_brackets.${index}.name`}
                                                    rules={[{ required: true }]}
                                                    className={`w-80`}
                                                >
                                                    <Input placeholder="Bracket Name" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`age_brackets.${index}.min_age`}
                                                    rules={[{ required: true }]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="Min Age" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`age_brackets.${index}.max_age`}
                                                    rules={[{ required: true }]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="Max Age" />
                                                </Form.Item>
                                                <Button status="danger" onClick={() => remove(index)} className={`mb-8`}>
                                                    <IconDelete />
                                                </Button>
                                            </div>
                                        ))}
                                        <Button type={`text`} onClick={() => add()}>
                                            <IconPlus /> Add Age Bracket
                                        </Button>
                                    </>
                                )}
                            </Form.List>
                        </Form.Item>
                        <Form.Item label="Final Criteria">
                            <Form.List field="final_criteria">
                                {(fields, { add, remove }) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className="flex gap-4 items-center mb-4">
                                                <Form.Item
                                                    field={`final_criteria.${index}.type`}
                                                    rules={[{ required: true, message: "Please select type" }]}
                                                    className={`w-80`}
                                                >
                                                    <Select placeholder="Select Type">
                                                        <Select.Option value="individual">Individual</Select.Option>
                                                        <Select.Option value="team">Team</Select.Option>
                                                    </Select>
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_criteria.${index}.number`}
                                                    rules={[{ required: true }]}
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
                                {(fields, { add, remove }) => (
                                    <>
                                        {fields.map((field, index) => (
                                            <div key={field.key} className="flex gap-4 items-center mb-4">
                                                <Form.Item
                                                    field={`final_categories.${index}.name`}
                                                    rules={[{ required: true }]}
                                                    className={`w-80`}
                                                >
                                                    <Input placeholder="Category Name" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_categories.${index}.start`}
                                                    rules={[{ required: true }]}
                                                    className={`w-80`}
                                                >
                                                    <InputNumber placeholder="Start Rank" />
                                                </Form.Item>
                                                <Form.Item
                                                    field={`final_categories.${index}.end`}
                                                    rules={[{ required: true }]}
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
