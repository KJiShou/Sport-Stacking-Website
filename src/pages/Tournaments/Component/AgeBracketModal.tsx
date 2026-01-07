import type {AgeBracketModalProps} from "@/schema";
// src/components/tournament/AgeBracketModal.tsx
import {Button, Form, Input, InputNumber, Modal} from "@arco-design/web-react";
import {IconDelete, IconPlus} from "@arco-design/web-react/icon";
import {useEffect, useState} from "react";

export default function AgeBracketModal({visible, brackets, onChange, onCancel, onSave, onDeleteBracket}: AgeBracketModalProps) {
    // Ensure each rendered bracket has a stable key across edits to prevent input focus jumps
    const [tempKeys, setTempKeys] = useState<string[]>([]);

    useEffect(() => {
        setTempKeys((prev) => {
            const next = [...prev];
            while (next.length < brackets.length) {
                next.push(crypto.randomUUID());
            }
            return next.slice(0, brackets.length);
        });
    }, [brackets.length]);

    const updateBracketAtIndex = (index: number, updater: (current: (typeof brackets)[number]) => (typeof brackets)[number]) => {
        const updated = [...brackets];
        updated[index] = updater(updated[index]);
        onChange(updated);
    };

    return (
        <Modal title="Edit Age Brackets" visible={visible} onCancel={onCancel} onOk={onSave}>
            <Form.List field="age_brackets_modal">
                {(fields, {add}) => (
                    <>
                        {brackets.map((bracket, index) => {
                            const bracketKey = (bracket as {_id?: string})._id ?? tempKeys[index] ?? `${index}`;
                            const isMinError = bracket.min_age === null || bracket.min_age > bracket.max_age;
                            const isMaxError = bracket.max_age === null || bracket.max_age < bracket.min_age;

                            return (
                                <div key={bracketKey} className="flex gap-4 mb-4 w-full">
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
                                                updateBracketAtIndex(index, (current) => ({...current, name: v}));
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
                                                updateBracketAtIndex(index, (current) => ({...current, min_age: v ?? 0}));
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
                                                updateBracketAtIndex(index, (current) => ({...current, max_age: v ?? 0}));
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
                        <Button
                            type="text"
                            onClick={() =>
                                onChange([
                                    ...brackets,
                                    {
                                        name: "",
                                        min_age: 0,
                                        max_age: 0,
                                        number_of_participants: 0,
                                        _id: crypto.randomUUID(),
                                    } as (typeof brackets)[number],
                                ])
                            }
                        >
                            <IconPlus /> Add Bracket
                        </Button>
                    </>
                )}
            </Form.List>
        </Modal>
    );
}
