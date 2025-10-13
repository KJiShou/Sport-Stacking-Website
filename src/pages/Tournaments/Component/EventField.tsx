import {Button, Card, Form, Select, Typography} from "@arco-design/web-react";
import {IconDelete, IconEdit} from "@arco-design/web-react/icon";

const {Title} = Typography;

interface EventFieldProps {
    index: number;
    onEditAgeBrackets: (index: number) => void;
    onRemove: (index: number) => void;
}

const EVENT_TYPES = {
    Individual: ["3-3-3", "3-6-3", "Cycle"],
    Double: ["Cycle"],
    "Team Relay": ["3-6-3", "Cycle"],
    "Parent & Child": ["Cycle"],
    "Special Need": ["3-3-3", "3-6-3", "Cycle"],
};

export default function EventFields({index, onEditAgeBrackets, onRemove}: EventFieldProps) {
    return (
        <Card className="mb-4">
            <div className="space-y-4">
                <div className="flex items-center gap-4">
                    <div className="flex-1">
                        <Title heading={6} className="mb-2">
                            Event Type
                        </Title>
                        <Form.Item field={`events.${index}.type`} rules={[{required: true}]}>
                            <Select placeholder="Select Event Type" className="w-full">
                                <Select.Option value="Individual">Individual</Select.Option>
                                <Select.Option value="Double">Double</Select.Option>
                                <Select.Option value="Team Relay">Team Relay</Select.Option>
                                <Select.Option value="Parent & Child">Parent & Child</Select.Option>
                                <Select.Option value="Special Need">Special Need</Select.Option>
                            </Select>
                        </Form.Item>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Button type="primary" onClick={() => onEditAgeBrackets(index)}>
                            <IconEdit /> Age Brackets
                        </Button>
                        <Button status="danger" onClick={() => onRemove(index)}>
                            <IconDelete />
                        </Button>
                    </div>
                </div>

                <Form.Item
                    shouldUpdate={(prev, next) => {
                        // Check if event type changed
                        if (prev.events?.[index]?.type !== next.events?.[index]?.type) {
                            return true;
                        }
                        return false;
                    }}
                >
                    {(_, form) => {
                        const eventType = form.getFieldValue(`events.${index}.type`);
                        const prevEventType = form.getFieldValue(`events.${index}.__prevType`);
                        const availableCodes = eventType ? EVENT_TYPES[eventType as keyof typeof EVENT_TYPES] || [] : [];

                        // Clear codes if event type changed
                        if (eventType && eventType !== prevEventType) {
                            const currentCodes = form.getFieldValue(`events.${index}.codes`) || [];
                            const validCodes = currentCodes.filter((code: string) => availableCodes.includes(code));
                            if (validCodes.length !== currentCodes.length) {
                                form.setFieldValue(`events.${index}.codes`, validCodes);
                            }
                            form.setFieldValue(`events.${index}.__prevType`, eventType);
                        }

                        return eventType ? (
                            <>
                                <div>
                                    <Title heading={6} className="mb-2">
                                        Select Event Codes
                                    </Title>
                                    <Form.Item field={`events.${index}.codes`} rules={[{required: true}]}>
                                        <Select placeholder="Select one or more event codes" mode="multiple" className="w-full">
                                            {availableCodes.map((code) => (
                                                <Select.Option key={code} value={code}>
                                                    {code}
                                                </Select.Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </div>

                                <div className="mt-4 p-4 bg-gray-50 rounded">
                                    <Title heading={6} className="mb-2">
                                        Available Events for {eventType}:
                                    </Title>
                                    <div className="flex flex-wrap gap-2">
                                        {availableCodes.map((code) => (
                                            <span key={code} className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-sm">
                                                {code}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </>
                        ) : null;
                    }}
                </Form.Item>
            </div>
        </Card>
    );
}
