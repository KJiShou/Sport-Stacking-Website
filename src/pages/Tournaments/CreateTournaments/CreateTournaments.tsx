import {DEFAULT_AGE_BRACKET, DEFAULT_EVENTS} from "@/constants/tournamentDefaults";
import {useAuthContext} from "@/context/AuthContext";
import {useSmartDateHandlers} from "@/hooks/DateHandler/useSmartDateHandlers";
import type {AgeBracket, Tournament} from "@/schema";
import {countries} from "@/schema/Country";
import type {FinalCriterion} from "@/schema/TournamentSchema";
import {uploadFile} from "@/services/firebase/storageService";
import {createTournament, updateTournament} from "@/services/firebase/tournamentsService";
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
    Upload,
} from "@arco-design/web-react";
import {IconDelete, IconExclamationCircle, IconPlus, IconUndo} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import dayjs from "dayjs";
import type {Timestamp} from "firebase/firestore";
import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";
import AgeBracketModal from "../Component/AgeBracketModal";
import EventFields from "../Component/EventField";

import LocationPicker, {isValidCountryPath} from "../Component/LocationPicker";
import {useAgeBracketEditor} from "../Component/useAgeBracketEditor";

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
    const [loading, setLoading] = useState(false);

    const validateAgeBrackets = (brackets: AgeBracket[]) => {
        const errors: string[] = [];

        brackets.forEach((bracket, index) => {
            // Check if bracket has at least one final criteria
            if (!bracket.final_criteria || bracket.final_criteria.length === 0) {
                errors.push(`Age bracket "${bracket.name || `Bracket ${index + 1}`}" must have at least one final criteria`);
                return;
            }

            // Check for duplicate classifications within the same bracket
            const classifications = bracket.final_criteria.map((criteria: FinalCriterion) => criteria.classification);
            const duplicates = classifications.filter((classification, idx) => classifications.indexOf(classification) !== idx);

            if (duplicates.length > 0) {
                const uniqueDuplicates = [...new Set(duplicates)];
                errors.push(
                    `Age bracket "${bracket.name || `Bracket ${index + 1}`}" has duplicate classifications: ${uniqueDuplicates.join(", ")}`,
                );
            }
        });

        return errors;
    };

    const handleSubmit = async (values: TournamentFormData) => {
        setLoading(true);

        try {
            if (!user) return;

            const countryPath = values.country ?? [];
            if (!isValidCountryPath(countryPath)) {
                Message.error("Selected address does not match a valid country/state option. Please adjust manually.");
                setLoading(false);
                return;
            }

            const fullEvents: Tournament["events"] = form.getFieldValue("events");

            const agendaFile = form.getFieldValue("agenda");
            const logoFile = form.getFieldValue("logo");

            let agendaUrl = "";
            let logoUrl = "";

            const tournamentId = await createTournament(user, {
                name: values.name,
                start_date: values.date_range[0],
                end_date: values.date_range[1],
                country: values.country,
                venue: values.venue,
                address: values.address,
                registration_start_date: values.registration_date_range[0],
                registration_end_date: values.registration_date_range[1],
                max_participants: values.max_participants,
                events: fullEvents,
                description: values.description,
                editor: values.editor ?? null,
                recorder: values.recorder ?? null,
                status: "Up Coming",
                registration_fee: values.registration_fee,
                member_registration_fee: values.member_registration_fee,
            });

            if (agendaFile instanceof File) {
                agendaUrl = await uploadFile(agendaFile, `agendas/${tournamentId}`);
            }

            if (logoFile instanceof File) {
                logoUrl = await uploadFile(logoFile, `logos/${tournamentId}`);
            }

            await updateTournament(user, tournamentId, {
                agenda: agendaUrl || null,
                logo: logoUrl || null,
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
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
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
                        max_participants: 0,
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
                    <Form.Item label="Registration Fee" field="registration_fee" rules={[{required: true}]}>
                        <InputNumber min={0} placeholder="please enter..." />
                    </Form.Item>
                    <Form.Item label="Member Registration Fee" field="member_registration_fee" rules={[{required: true}]}>
                        <InputNumber min={0} placeholder="please enter..." />
                    </Form.Item>

                    <Form.Item
                        label="Registration Price"
                        field="registration_price"
                        rules={[{required: true, message: "Please input registration price"}]}
                    >
                        <InputNumber min={0} style={{width: "100%"}} placeholder="Enter registration price" />
                    </Form.Item>

                    <Form.Item
                        label="Member Registration Price"
                        field="member_registration_price"
                        rules={[{required: true, message: "Please input member registration price"}]}
                    >
                        <InputNumber min={0} style={{width: "100%"}} placeholder="Enter member registration price" />
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
                                        onClick={() => {
                                            // Get the current event to determine the type
                                            const currentEvents = form.getFieldValue("events") || [];
                                            const defaultType = "Individual"; // fallback
                                            const predefinedCriteria = getPredefinedFinalCriteria(defaultType);

                                            add({
                                                code: "",
                                                type: "",
                                                age_brackets: DEFAULT_AGE_BRACKET,
                                            });
                                        }}
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

                                            const isMaxError = bracket.max_age === null || bracket.max_age < bracket.min_age;

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

                                                    {/* Final Criteria for this age bracket */}
                                                    <div className="mt-4">
                                                        <h4 className="text-sm font-medium mb-2">
                                                            Final Criteria for {bracket.name}
                                                        </h4>
                                                        {bracket.final_criteria?.map((criteria, criteriaIndex) => (
                                                            <div key={criteria.classification} className="flex gap-2 mb-2">
                                                                <Select
                                                                    value={criteria.classification}
                                                                    placeholder="Classification"
                                                                    onChange={(value) => {
                                                                        const updated = [...ageBrackets];
                                                                        if (!updated[id].final_criteria) {
                                                                            updated[id].final_criteria = [];
                                                                        }
                                                                        updated[id].final_criteria![
                                                                            criteriaIndex
                                                                        ].classification = value;
                                                                        setAgeBrackets(updated);
                                                                    }}
                                                                    style={{width: 150}}
                                                                >
                                                                    <Select.Option value="advance">Advanced</Select.Option>
                                                                    <Select.Option value="intermediate">
                                                                        Intermediate
                                                                    </Select.Option>
                                                                    <Select.Option value="beginner">Beginner</Select.Option>
                                                                </Select>
                                                                <InputNumber
                                                                    value={criteria.number}
                                                                    placeholder="Number"
                                                                    min={0}
                                                                    onChange={(value) => {
                                                                        const updated = [...ageBrackets];
                                                                        if (!updated[id].final_criteria) {
                                                                            updated[id].final_criteria = [];
                                                                        }
                                                                        updated[id].final_criteria![criteriaIndex].number =
                                                                            value ?? 0;
                                                                        setAgeBrackets(updated);
                                                                    }}
                                                                    style={{width: 100}}
                                                                />
                                                                <Button
                                                                    status="danger"
                                                                    onClick={() => {
                                                                        const updated = [...ageBrackets];
                                                                        updated[id].final_criteria?.splice(criteriaIndex, 1);
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
                                                                if (!updated[id].final_criteria) {
                                                                    updated[id].final_criteria = [];
                                                                }
                                                                updated[id].final_criteria!.push({
                                                                    classification: "intermediate",
                                                                    number: 10,
                                                                });
                                                                setAgeBrackets(updated);
                                                            }}
                                                            disabled={(bracket.final_criteria?.length ?? 0) >= 3}
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
                    <Form.Item label="Agenda (PDF)" field="agenda" extra="Only PDF file allowed" rules={[{required: false}]}>
                        <Upload
                            accept=".pdf"
                            limit={1}
                            onChange={(fileList) => {
                                const rawFile = fileList?.[0]?.originFile || null;
                                form.setFieldValue("agenda", rawFile);
                            }}
                            showUploadList
                        />
                    </Form.Item>

                    {/* Logo Upload (Image) */}
                    <Form.Item label="Tournament Logo" field="logo" extra="PNG or JPG file" rules={[{required: false}]}>
                        <Upload
                            accept="image/png,image/jpeg"
                            limit={1}
                            onChange={(fileList) => form.setFieldValue("logo", fileList[0]?.originFile || null)}
                            showUploadList
                            listType="picture-card"
                            imagePreview
                        />
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
