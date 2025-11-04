import type {AgeBracket} from "@/schema";
import type {FinalCriterion} from "@/schema/TournamentSchema";
import {validateAgeBrackets} from "@/utils/validation/validateAgeBrackets";
import {type FormInstance, Message} from "@arco-design/web-react";
import {useState} from "react";
import FinalCriteriaFields from "./FinalCriteriaFields";

// Temporary type for UI tracking with unique ID
type AgeBracketWithId = AgeBracket & {_id?: string};

export function useAgeBracketEditor(form: FormInstance, onBracketsSaved?: (brackets: AgeBracket[], index: number) => void) {
    const [ageBracketModalVisible, setAgeBracketModalVisible] = useState(false);
    const [editingEventIndex, setEditingEventIndex] = useState<number | null>(null);
    const [ageBrackets, setAgeBrackets] = useState<AgeBracketWithId[]>([]);

    const handleEditAgeBrackets = (index: number) => {
        const currentEvents = form.getFieldValue("events") ?? [];
        const brackets = currentEvents[index]?.age_brackets ?? [];

        // Ensure each bracket has a unique ID for React keys
        const bracketsWithIds: AgeBracketWithId[] = brackets.map((bracket: AgeBracket) => ({
            ...bracket,
            _id: (bracket as AgeBracketWithId)._id || crypto.randomUUID(),
        }));

        setEditingEventIndex(index);
        setAgeBrackets(bracketsWithIds);
        setAgeBracketModalVisible(true);
    };

    const validateFinalCriteria = (brackets: AgeBracket[]): string[] => {
        const errors: string[] = [];

        brackets.forEach((bracket, index) => {
            // Check if bracket has at least one final criteria
            if (!bracket.final_criteria || bracket.final_criteria.length === 0) {
                errors.push(`Age bracket "${bracket.name || `Bracket ${index + 1}`}" must have at least one final criteria`);
                return;
            }

            // Check for duplicate classifications within the same bracket
            const classifications = bracket.final_criteria.map((criteria: FinalCriterion) => criteria.classification);
            const duplicates = classifications.filter(
                (classification, idx: number) => classifications.indexOf(classification) !== idx,
            );

            if (duplicates.length > 0) {
                const uniqueDuplicates = [...new Set(duplicates)];
                errors.push(
                    `Age bracket "${bracket.name || `Bracket ${index + 1}`}" has duplicate classifications: ${uniqueDuplicates.join(", ")}`,
                );
            }
        });

        return errors;
    };

    // Combined validation function
    const validateAgeBracketsComplete = (brackets: AgeBracket[]): string[] => {
        const errors: string[] = [];

        // First, validate basic age bracket structure using existing function
        const basicValidationError = validateAgeBrackets(brackets);
        if (basicValidationError) {
            errors.push(basicValidationError);
        }

        // Then validate final criteria
        const finalCriteriaErrors = validateFinalCriteria(brackets);
        errors.push(...finalCriteriaErrors);

        return errors;
    };

    const makeHandleDeleteBracket = (idx: number) => () => {
        setAgeBrackets((prev) => prev.filter((_, i) => i !== idx));
    };

    const handleSaveAgeBrackets = () => {
        if (editingEventIndex === null) {
            Message.error("No event selected");
            return;
        }

        const errorMessage = validateAgeBracketsComplete(ageBrackets);
        if (errorMessage.length > 0) {
            Message.error(errorMessage.join("\n"));
            return;
        }

        // Remove temporary _id field before saving
        const cleanedBrackets = ageBrackets.map((bracket) => {
            const {_id, ...cleanBracket} = bracket;
            return cleanBracket as AgeBracket;
        });

        const currentEvents = [...(form.getFieldValue("events") ?? [])];
        currentEvents[editingEventIndex].age_brackets = cleanedBrackets;
        form.setFieldValue("events", currentEvents);
        setAgeBracketModalVisible(false);
        setEditingEventIndex(null);
        onBracketsSaved?.(cleanedBrackets, editingEventIndex);
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
