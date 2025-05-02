import type {Timestamp} from "firebase/firestore";
import {useState} from "react";
import {Button, Cascader, DatePicker, Form, Input, InputNumber, Message, Modal, Select, Typography} from "@arco-design/web-react";
import dayjs, {type Dayjs} from "dayjs";
import type {Competition, AgeBracket} from "../../../schema";
import {IconDelete, IconEdit, IconPlus, IconUndo} from "@arco-design/web-react/icon";
import {useNavigate} from "react-router-dom";
import {countries} from "../../../schema/Country";
import {createCompetition} from "../../../services/firebase/competitionsService";
import {useAuthContext} from "../../../context/AuthContext";

type CompetitionFormData = Competition & {
    date_range: [Timestamp, Timestamp];
    registration_date_range: [Timestamp, Timestamp];
};

const {Title} = Typography;
const {RangePicker} = DatePicker;
const DEFAULT_EVENTS: Competition["events"] = [
    {
        code: "3-3-3",
        type: "individual",
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
    },
    {
        code: "3-6-3",
        type: "individual",
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
    },
    {
        code: "cycle",
        type: "individual",
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
    },
];

const DEFAULT_FINAL_CRITERIA: Competition["final_criteria"] = [
    {
        type: "individual",
        number: 8,
    },
];

const DEFAULT_FINAL_CATEGORIES: Competition["final_categories"] = [
    {
        name: "Gold Final",
        start: 1,
        end: 4,
    },
    {
        name: "Silver Final",
        start: 5,
        end: 8,
    },
];

export default function CreateCompetitionPage() {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const {user} = useAuthContext();

    const [ageBracketModalVisible, setAgeBracketModalVisible] = useState(false);
    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
    const [ageBrackets, setAgeBrackets] = useState<AgeBracket[]>([]);

    const handleEditAgeBrackets = (index: number) => {
        const currentEvents = form.getFieldValue("events") ?? [];
        setEditingEventIndex(index);
        setAgeBrackets(currentEvents[index]?.age_brackets ?? []);
        setAgeBracketModalVisible(true);
    };

    const makeHandleDeleteBracket = (idx: number) => {
        return () => {
            setAgeBrackets((prev) => prev.filter((_, i) => i !== idx));
        };
    };

    const handleSaveAgeBrackets = () => {
        if (editingEventIndex === null) {
            Message.error("No event selected");
            return;
        }

        for (const [i, bracket] of ageBrackets.entries()) {
            if (!bracket.name || bracket.min_age === null || bracket.max_age === null || bracket.min_age > bracket.max_age) {
                Message.error(`Please fill in all fields correctly for bracket ${i + 1}.`);
                return;
            }
        }

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

    const handleCompetitionDateChange = (_: string[], dates: Dayjs[]) => {
        if (!dates || dates.length !== 2) return;

        const [startDate, endDate] = dates;

        const today = dayjs();

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
        setLoading(true);

        try {
            if (!user) return;

            const fullEvents: Competition["events"] = form.getFieldValue("events");
            await createCompetition(user, {
                name: values.name,
                start_date: values.date_range[0],
                end_date: values.date_range[1],
                country: values.country,
                address: values.address,
                registration_start_date: values.registration_date_range[0],
                registration_end_date: values.registration_date_range[1],
                max_participants: values.max_participants,
                events: fullEvents,
                final_criteria: values.final_criteria,
                final_categories: values.final_categories,
                status: "Up Coming",
            });
            Message.success("Competition created successfully!");

            setTimeout(() => {
                window.close();
            }, 1000);
        } catch (error) {
            console.error(error);
            Message.error("Failed to create competition.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={3} className="text-center mb-6">
                    Create New Competition
                </Title>

                <Form
                    form={form}
                    layout="vertical"
                    onSubmit={handleSubmit}
                    initialValues={{
                        events: DEFAULT_EVENTS,
                        final_criteria: DEFAULT_FINAL_CRITERIA,
                        final_categories: DEFAULT_FINAL_CATEGORIES,
                        max_participants: 100,
                    }}
                    requiredSymbol={false}
                >
                    {/* Competition Name */}
                    <Form.Item label="Competition Name" field="name" rules={[{required: true, message: "Please input name"}]}>
                        <Input placeholder="Enter competition name" />
                    </Form.Item>

                    {/* Competition Date Range */}
                    <Form.Item
                        label="Competition Date Range"
                        field="date_range"
                        rules={[{required: true, message: "Please select date range"}]}
                    >
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

                    <Form.Item
                        label="Country / State"
                        field="country"
                        rules={[{required: true, message: "Please select a country/region"}]}
                    >
                        <Cascader
                            showSearch
                            changeOnSelect
                            allowClear
                            filterOption={(input, node) => {
                                return node.label.toLowerCase().includes(input.toLowerCase());
                            }}
                            options={countries}
                            placeholder="Please select location"
                            expandTrigger="hover"
                        />
                    </Form.Item>

                    {/* Address */}
                    <Form.Item label="Address" field="address" rules={[{required: true, message: "Please input address"}]}>
                        <Input placeholder="Enter address" />
                    </Form.Item>

                    {/* Registration Date Range */}
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

                    {/* Max Participants */}
                    <Form.Item
                        label="Maximum Participants"
                        field="max_participants"
                        rules={[{required: true, message: "Please input maximum participants"}]}
                    >
                        <InputNumber min={1} style={{width: "100%"}} placeholder="Enter max number of participants" />
                    </Form.Item>

                    <Form.Item label="Events">
                        <Form.List field="events">
                            {(fields, {add, remove}) => (
                                <>
                                    {fields.map((field, index) => (
                                        <div key={field.key} className="flex items-center gap-2 mb-4">
                                            <Form.Item
                                                field={`events.${index}.code`}
                                                className="w-1/4"
                                                rules={[{required: true}]}
                                            >
                                                <Select placeholder="Code">
                                                    <Select.Option value="3-3-3">3-3-3</Select.Option>
                                                    <Select.Option value="3-6-3">3-6-3</Select.Option>
                                                    <Select.Option value="cycle">Cycle</Select.Option>
                                                </Select>
                                            </Form.Item>
                                            <Form.Item
                                                field={`events.${index}.type`}
                                                className="w-1/4"
                                                rules={[{required: true}]}
                                            >
                                                <Select placeholder="Type">
                                                    <Select.Option value="individual">Individual</Select.Option>
                                                    <Select.Option value="team">Team</Select.Option>
                                                </Select>
                                            </Form.Item>
                                            <Button
                                                type="primary"
                                                className={`mb-8`}
                                                onClick={() => handleEditAgeBrackets(index)}
                                            >
                                                <IconEdit /> Age Brackets
                                            </Button>
                                            <Button status="danger" onClick={() => remove(index)} className={`mb-8`}>
                                                <IconDelete />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button type="text" onClick={() => add({code: "", type: "", age_brackets: []})}>
                                        <IconPlus /> Add Event
                                    </Button>
                                </>
                            )}
                        </Form.List>
                    </Form.Item>

                    {/* Age Bracket Modal */}
                    <Modal
                        title="Edit Age Brackets"
                        visible={ageBracketModalVisible}
                        onCancel={() => setAgeBracketModalVisible(false)}
                        onOk={handleSaveAgeBrackets}
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
                                                <div key={bracket.name} className="flex gap-4 mb-4 w-full">
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
                                            onClick={() => setAgeBrackets([...ageBrackets, {name: "", min_age: 0, max_age: 0}])}
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

                    {/* Submit Button */}
                    <Form.Item>
                        <Button type="primary" htmlType="submit" loading={loading} long>
                            Create Competition
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    );
}
