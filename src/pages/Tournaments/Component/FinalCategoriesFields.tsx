// components/FinalCategoriesFields.tsx
import {Button, Form, Input, InputNumber} from "@arco-design/web-react";
import {IconDelete} from "@arco-design/web-react/icon";

interface Props {
    index: number;
    onRemove: (index: number) => void;
}

export default function FinalCategoriesFields({index, onRemove}: Props) {
    return (
        <div className="flex gap-4 items-center mb-4">
            <Form.Item field={`final_categories.${index}.name`} rules={[{required: true}]} className="w-80">
                <Input placeholder="Category Name" />
            </Form.Item>
            <Form.Item field={`final_categories.${index}.start`} rules={[{required: true}]} className="w-80">
                <InputNumber placeholder="Start Rank" />
            </Form.Item>
            <Form.Item field={`final_categories.${index}.end`} rules={[{required: true}]} className="w-80">
                <InputNumber placeholder="End Rank" />
            </Form.Item>
            <Button status="danger" onClick={() => onRemove(index)} className="mb-8">
                <IconDelete />
            </Button>
        </div>
    );
}
