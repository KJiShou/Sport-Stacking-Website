import type {TournamentRecord} from "./RecordSchema";
import type {Registration} from "./RegistrationSchema";
import type {Team} from "./TeamSchema";
import type {AgeBracket, Tournament, TournamentEvent} from "./TournamentSchema";

export interface PrelimResultData extends Omit<TournamentRecord, "try1" | "try2" | "try3" | "bestTime" | "classification"> {
    rank: number;
    name: string;
    id: string;
    three?: number;
    threeSixThree?: number;
    cycle?: number;
    try1?: number;
    try2?: number;
    try3?: number;
    bestTime?: number;
    classification?: "beginner" | "intermediate" | "advance";
    round?: "prelim" | "final";
}

export interface BracketResults {
    bracket: AgeBracket;
    records: PrelimResultData[];
    classification?: "beginner" | "intermediate" | "advance";
    highlightFinalists?: boolean;
}

export interface EventResults {
    event: TournamentEvent;
    brackets: BracketResults[];
}

export interface AllPrelimResultsPDFParams {
    tournament: Tournament;
    resultsData: EventResults[];
    round?: "Preliminary" | "Final";
    highlightFinalists?: boolean;
}

export interface FinalistsPDFParams {
    tournament: Tournament;
    finalistsData: EventResults[];
}

export interface PrelimResult extends TournamentRecord {
    rank: number;
    name: string;
}

export interface ExportPrelimResultsOptions {
    tournament: Tournament;
    eventKey: string;
    records: PrelimResult[];
}

export interface ExportPDFOptions {
    tournament: Tournament;
    eventKey: string;
    bracketName: string;
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>;
    searchTerm?: string;
    isTeamEvent: boolean;
    logoDataUrl?: string;
    team?: Team;
    teams?: Team[];
}

export interface ExportMasterListOptions {
    tournament: Tournament;
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>;
}

export interface EventData {
    event: TournamentEvent;
    bracket: AgeBracket;
    isTeamEvent: boolean;
    registrations: Registration[];
}

export interface NameListStickerOptions {
    tournament: Tournament;
    registrations: Registration[];
    eventKey?: string;
    bracketName?: string;
    searchTerm?: string;
    teams?: Team[];
    isTeamEvent?: boolean;
    logoDataUrl?: string;
}
