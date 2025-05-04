import type {Timestamp} from "firebase/firestore";
import {useState} from "react";
import {Button, Cascader, DatePicker, Form, Input, InputNumber, Message, Modal, Select, Typography} from "@arco-design/web-react";
import dayjs from "dayjs";
import type {Competition} from "@/schema";
import {IconPlus, IconUndo} from "@arco-design/web-react/icon";
import {useNavigate} from "react-router-dom";
import {countries} from "@/schema/Country";
import {createCompetition} from "@/services/firebase/competitionsService";
import {useAuthContext} from "@/context/AuthContext";
import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import AgeBracketModal from "../Component/AgeBracketModal";
import EventFields from "../Component/EventField";
import FinalCriteriaFields from "../Component/FinalCriteriaFields";
import FinalCategoriesFields from "../Component/FinalCategoriesFields";
import {DEFAULT_EVENTS, DEFAULT_FINAL_CRITERIA, DEFAULT_FINAL_CATEGORIES} from "@/constants/competitionDefaults";
import {useCompetitionFormPrefill} from "../Component/useCompetitionFormPrefill";
import {useAgeBracketEditor} from "../Component/useAgeBracketEditor";

type CompetitionFormData = Competition & {
    date_range: [Timestamp, Timestamp];
    registration_date_range: [Timestamp, Timestamp];
};

const {Title} = Typography;
const {RangePicker} = DatePicker;

export default function CreateCompetitionPage() {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const {handleCompetitionDateChange, handleRangeChangeSmart} = useSmartDateHandlers(form);
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

    const [loading, setLoading] = useState(false);
    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);

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
                    </Form.Item>

                    {/* Age Bracket Modal */}
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
