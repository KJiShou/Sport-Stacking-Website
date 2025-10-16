import type {PrelimResultData} from "./PdfSchema";
import type {Registration} from "./RegistrationSchema";
import type {Team} from "./TeamSchema";
import type {AgeBracket, TournamentEvent} from "./TournamentSchema";

export interface Score {
    try1: string;
    try2: string;
    try3: string;
    [key: string]: string | undefined;
}

export interface ParticipantScore extends Registration {
    scores: Record<string, Score>;
}

export interface TeamScore extends Team {
    scores: Record<string, Score>;
}

export interface Finalist {
    event: TournamentEvent;
    eventCode: string;
    eventCodes: string[];
    bracket: AgeBracket;
    records: (PrelimResultData & {team?: Team; registration?: Registration})[];
    classification: "beginner" | "intermediate" | "advance";
}

export interface ClassificationGroup {
    event: TournamentEvent;
    bracket: AgeBracket;
    classification: "beginner" | "intermediate" | "advance";
    finalists: Finalist[];
}
