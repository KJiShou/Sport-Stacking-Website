// components/FinalCriteriaFields.tsx
import type {FinalCriteriaFieldsProps} from "@/schema";
import {Button, Form, InputNumber, Select} from "@arco-design/web-react";
import {IconDelete} from "@arco-design/web-react/icon";

export default function FinalCriteriaFields({index, onRemove}: FinalCriteriaFieldsProps) {
    return (
        <div className="flex gap-4 items-center mb-4">
            <Form.Item
                field={`final_criteria.${index}.type`}
                rules={[{required: true, message: "Please select type"}]}
                className="w-80"
            >
                <Select placeholder="Select Type">
                    <Select.Option value="Individual">Individual</Select.Option>
                    <Select.Option value="Team">Team</Select.Option>
                </Select>
            </Form.Item>
            <Form.Item field={`final_criteria.${index}.number`} rules={[{required: true}]} className="w-80">
                <InputNumber placeholder="Top N" />
            </Form.Item>
            <Button status="danger" onClick={() => onRemove(index)} className="mb-8">
                <IconDelete />
            </Button>
        </div>
    );
}
