import type {AgeBracket, TournamentEvent} from "./TournamentSchema";

export interface ExpandedEvent extends TournamentEvent {
    code: string;
}

export interface FinalCriteriaFieldsProps {
    index: number;
    onRemove: (index: number) => void;
}

export interface FinalCategoriesFieldsProps {
    index: number;
    onRemove: (index: number) => void;
}

export interface AgeBracketModalProps {
    visible: boolean;
    brackets: AgeBracket[];
    onChange: (brackets: AgeBracket[]) => void;
    onCancel: () => void;
    onSave: () => void;
    onDeleteBracket: (index: number) => void;
}

export interface EventFieldProps {
    index: number;
    onEditAgeBrackets: (index: number) => void;
    onRemove: (index: number) => void;
}

export type TournamentListType = "current" | "history";

export interface TournamentListProps {
    type: TournamentListType;
}
