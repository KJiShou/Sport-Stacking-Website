import {Button, Checkbox, Form, Select} from "@arco-design/web-react";
import {IconDelete, IconEdit} from "@arco-design/web-react/icon";
import React from "react";

interface EventFieldProps {
    index: number;
    onEditAgeBrackets: (index: number) => void;
    onRemove: (index: number) => void;
}

export default function EventFields({index, onEditAgeBrackets, onRemove}: EventFieldProps) {
    return (
        <div className="flex items-center gap-2 mb-4">
            <Form.Item field={`events.${index}.code`} className="w-1/4" rules={[{required: true}]}>
                <Select placeholder="Code">
                    <Select.Option value="3-3-3">3-3-3</Select.Option>
                    <Select.Option value="3-6-3">3-6-3</Select.Option>
                    <Select.Option value="Cycle">Cycle</Select.Option>
                </Select>
            </Form.Item>
            <Form.Item field={`events.${index}.type`} className="w-1/4" rules={[{required: true}]}>
                <Select placeholder="Type">
                    <Select.Option value="Individual">Individual</Select.Option>
                    <Select.Option value="Team Relay">Team Relay</Select.Option>
                    <Select.Option value="Double">Double</Select.Option>
                    <Select.Option value="Parent_&_Child">Parent & Child</Select.Option>
                </Select>
            </Form.Item>
            <Button type="primary" className="mb-8" onClick={() => onEditAgeBrackets(index)}>
                <IconEdit /> Age Brackets
            </Button>
            <Button status="danger" onClick={() => onRemove(index)} className="mb-8">
                <IconDelete />
            </Button>
        </div>
    );
}
