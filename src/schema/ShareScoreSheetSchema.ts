import type {AgeBracket, Tournament, TournamentEvent} from "./TournamentSchema";

export type ShareRound = "prelim" | "final";

export interface ShareResultRow {
    id: string;
    rank: number;
    name: string;
    bestTime: number;
    globalId?: string;
    teamId?: string;
    leaderId?: string;
    [key: string]: unknown;
}

export interface ShareBracketSection {
    bracket: AgeBracket;
    classification?: string;
    rows: ShareResultRow[];
}

export interface ShareEventSection {
    event: TournamentEvent;
    brackets: ShareBracketSection[];
}

export interface ShareScoreSheetPayload {
    round: ShareRound;
    tournament: Tournament;
    events: TournamentEvent[];
    sections: ShareEventSection[];
}
