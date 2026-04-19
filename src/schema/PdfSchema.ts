import type {TournamentRecord} from "./RecordSchema";
import type {Registration} from "./RegistrationSchema";
import type {Team} from "./TeamSchema";
import type {AgeBracket, Tournament, TournamentEvent} from "./TournamentSchema";

export interface PrelimResultData {
    id: string;
    tournament_id?: string;
    tournament_name?: string | null;
    event_id?: string;
    event?: string;
    code?: string;
    age?: number | null;
    country?: string | null;
    status?: "submitted" | "verified";
    participant_id?: string;
    participant_global_id?: string;
    participant_name?: string;
    gender?: string;
    submitted_at?: string;
    created_at?: string;
    updated_at?: string;
    verified_at?: string | null;
    verified_by?: string | null;
    rank: number;
    name: string;
    three?: number;
    threeSixThree?: number;
    cycle?: number;
    try1?: number;
    try2?: number;
    try3?: number;
    bestTime?: number;
    classification?: "beginner" | "intermediate" | "advance" | "prelim" | null;
    round?: "prelim" | "advance" | "intermediate" | "beginner";
    participantId?: string;
    teamId?: string;
    globalId?: string;
}

export interface BracketResults {
    bracket: AgeBracket;
    records: PrelimResultData[];
    classification?: string;
    highlightFinalists?: boolean;
    highlightedRecordClassifications?: Record<string, string>;
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

export type PrelimResult = TournamentRecord & {
    rank: number;
    name: string;
};

export interface ExportPrelimResultsOptions {
    tournament: Tournament;
    eventKey: string;
    records: PrelimResult[];
}

export interface ExportPDFOptions {
    tournament: Tournament;
    events: TournamentEvent[];
    eventKey: string;
    bracketName: string;
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>;
    nameMap?: Record<string, string>;
    searchTerm?: string;
    isTeamEvent: boolean;
    logoDataUrl?: string;
    team?: Team;
    teams?: Team[];
}

export interface ExportMasterListOptions {
    tournament: Tournament;
    events: TournamentEvent[];
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>;
    logoDataUrl?: string;
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
