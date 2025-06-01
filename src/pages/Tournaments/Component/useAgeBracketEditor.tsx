import { type FormInstance, Message } from "@arco-design/web-react";
import type { AgeBracket } from "@/schema";
import { validateAgeBrackets } from "@/utils/validation/validateAgeBrackets";
import { useState } from "react";

export function useAgeBracketEditor(form: FormInstance, onBracketsSaved?: (brackets: AgeBracket[], index: number) => void) {
    const [ageBracketModalVisible, setAgeBracketModalVisible] = useState(false);
    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
    const [ageBrackets, setAgeBrackets] = useState<AgeBracket[]>([]);

    const handleEditAgeBrackets = (index: number) => {
        const currentEvents = form.getFieldValue("events") ?? [];
        setEditingEventIndex(index);
        setAgeBrackets(currentEvents[index]?.age_brackets ?? []);
        setAgeBracketModalVisible(true);
    };

    const makeHandleDeleteBracket = (idx: number) => () => {
        setAgeBrackets((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleSaveAgeBrackets = () => {
        if (editingEventIndex === null) {
            Message.error("No event selected");
            return;
        }

        const errorMessage = validateAgeBrackets(ageBrackets);
        if (errorMessage) {
            Message.error(errorMessage);
            return;
        }

        const currentEvents = [...(form.getFieldValue("events") ?? [])];
        currentEvents[editingEventIndex].age_brackets = ageBrackets;
        form.setFieldValue("events", currentEvents);
        setAgeBracketModalVisible(false);
        setEditingEventIndex(null);
        onBracketsSaved?.(ageBrackets, editingEventIndex);
    };

    return {
        ageBracketModalVisible,
        ageBrackets,
        editingEventIndex,
        setAgeBrackets,
        setAgeBracketModalVisible,
        handleEditAgeBrackets,
        handleSaveAgeBrackets,
        makeHandleDeleteBracket,
    };
}
