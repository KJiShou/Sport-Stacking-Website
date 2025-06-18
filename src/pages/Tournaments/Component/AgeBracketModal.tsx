import type {AgeBracket} from "@/schema";
// src/components/tournament/AgeBracketModal.tsx
import {Button, Form, Input, InputNumber, Modal} from "@arco-design/web-react";
import {IconDelete, IconPlus} from "@arco-design/web-react/icon";

interface AgeBracketModalProps {
    visible: boolean;
    brackets: AgeBracket[];
    onChange: (brackets: AgeBracket[]) => void;
    onCancel: () => void;
    onSave: () => void;
    onDeleteBracket: (index: number) => void;
}

export default function AgeBracketModal({visible, brackets, onChange, onCancel, onSave, onDeleteBracket}: AgeBracketModalProps) {
    return (
        <Modal title="Edit Age Brackets" visible={visible} onCancel={onCancel} onOk={onSave}>
            <Form.List field="age_brackets_modal">
                {(fields, {add}) => (
                    <>
                        {brackets.map((bracket, index) => {
                            const isMinError = bracket.min_age === null || bracket.min_age > bracket.max_age;
                            const isMaxError = bracket.max_age === null || bracket.max_age < bracket.min_age;

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
                                                const updated = [...brackets];
                                                updated[index].name = v;
                                                onChange(updated);
                                            }}
                                            placeholder="Bracket Name"
                                        />
                                    </Form.Item>
                                    <Form.Item
                                        label="Min Age"
                                        required
                                        validateStatus={isMinError ? "error" : undefined}
                                        help={isMinError ? "Enter valid min age" : undefined}
                                        className="w-1/4"
                                    >
                                        <InputNumber
                                            value={bracket.min_age}
                                            min={0}
                                            onChange={(v) => {
                                                const updated = [...brackets];
                                                updated[index].min_age = v ?? 0;
                                                onChange(updated);
                                            }}
                                            placeholder="Min Age"
                                        />
                                    </Form.Item>
                                    <Form.Item
                                        label="Max Age"
                                        required
                                        validateStatus={isMaxError ? "error" : undefined}
                                        help={isMaxError ? "Enter valid max age" : undefined}
                                        className="w-1/4"
                                    >
                                        <InputNumber
                                            value={bracket.max_age}
                                            min={0}
                                            onChange={(v) => {
                                                const updated = [...brackets];
                                                updated[index].max_age = v ?? 0;
                                                onChange(updated);
                                            }}
                                            placeholder="Max Age"
                                        />
                                    </Form.Item>
                                    <div className="flex items-end pb-8">
                                        <Button status="danger" onClick={() => onDeleteBracket(index)}>
                                            <IconDelete />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                        <Button type="text" onClick={() => onChange([...brackets, {name: "", min_age: 0, max_age: 0}])}>
                            <IconPlus /> Add Bracket
                        </Button>
                    </>
                )}
            </Form.List>
        </Modal>
    );
}
