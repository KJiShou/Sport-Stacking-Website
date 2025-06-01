import type {Timestamp} from "firebase/firestore";
import {useState} from "react";
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
    Tooltip,
    Typography,
} from "@arco-design/web-react";
import dayjs from "dayjs";
import type {Tournament} from "@/schema";
import {IconDelete, IconExclamationCircle, IconPlus, IconUndo} from "@arco-design/web-react/icon";
import {useNavigate} from "react-router-dom";
import {countries} from "@/schema/Country";
import {createTournament} from "@/services/firebase/tournamentsService";
import {useAuthContext} from "@/context/AuthContext";
import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import AgeBracketModal from "../Component/AgeBracketModal";
import EventFields from "../Component/EventField";
import FinalCriteriaFields from "../Component/FinalCriteriaFields";
import FinalCategoriesFields from "../Component/FinalCategoriesFields";
import {DEFAULT_EVENTS, DEFAULT_FINAL_CRITERIA, DEFAULT_FINAL_CATEGORIES} from "@/constants/tournamentDefaults";
import {useTournamentFormPrefill} from "../Component/useTournamentFormPrefill";
import {useAgeBracketEditor} from "../Component/useAgeBracketEditor";
import LocationPicker, {isValidCountryPath} from "../Component/LocationPicker";

type TournamentFormData = Tournament & {
    date_range: [Timestamp, Timestamp];
    registration_date_range: [Timestamp, Timestamp];
};

const {Title} = Typography;
const {RangePicker} = DatePicker;

export default function CreateTournamentPage() {
    const [form] = Form.useForm();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const {handleTournamentDateChange, handleRangeChangeSmart} = useSmartDateHandlers(form);
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

    const [loading, setLoading] = useState(false);

    const handleSubmit = async (values: TournamentFormData) => {
        setLoading(true);

        try {
            if (!user) return;

            const countryPath = values.country;
            if (!isValidCountryPath(countryPath)) {
                Message.error("Selected address does not match a valid country/state option. Please adjust manually.");
                setLoading(false);
                return;
            }

            const fullEvents: Tournament["events"] = form.getFieldValue("events");
            await createTournament(user, {
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
            Message.success("Tournament created successfully!");

            setTimeout(() => {
                window.close();
            }, 1000);
        } catch (error) {
            console.error(error);
            Message.error("Failed to create tournament.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <Button type="outline" onClick={() => navigate("/tournaments?type=current")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={3} className="text-center mb-6">
                    Create New Tournament
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
                    {/* Tournament Name */}
                    <Form.Item label="Tournament Name" field="name" rules={[{required: true, message: "Please input name"}]}>
                        <Input placeholder="Enter tournament name" />
                    </Form.Item>

                    {/* Tournament Date Range */}
                    <Form.Item
                        label="Tournament Date Range"
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
                            onChange={handleTournamentDateChange}
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
                            onChange={(val) => {
                                form.setFieldValue("country", val);
                            }}
                            options={countries}
                            placeholder="Please select location"
                            expandTrigger="hover"
                        />
                    </Form.Item>
                    {/* Venue */}
                    <Form.Item label="Venue" field="venue" rules={[{required: true, message: "Please input venue"}]}>
                        <Input placeholder="Enter venue name" />
                    </Form.Item>

                    {/* Address */}
                    <Form.Item label="Address" field="address" rules={[{required: true, message: "Please input address"}]}>
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
                        label={
                            <div>
                                Team Member
                                <Tooltip content="0 as no limit">
                                    <IconExclamationCircle style={{margin: "0 8px", color: "rgb(var(--arcoblue-6))"}} />
                                </Tooltip>
                            </div>
                        }
                        field="max_participants"
                        rules={[{required: true, message: "Please input maximum participants"}]}
                    >
                        <InputNumber min={0} style={{width: "100%"}} placeholder="Enter max number of participants" />
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
                                                    {name: "Under 10", min_age: 0, max_age: 9},
                                                    {name: "10 and Above", min_age: 10, max_age: 99},
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

                    {/* Age Bracket Modal */}
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
                                                <div key={`bracket-${id}`} className="flex gap-4 mb-4 w-full">
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
                            Create Tournament
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    );
}
