import {httpsCallable} from "firebase/functions";
import {functions} from "./config";

export type ImportWorkbookMode = "preview" | "commit";

export type ImportReportRow = {
    sheet: string;
    row: number;
    level: "error" | "warning" | "info";
    message: string;
    category?: "errors" | "warnings" | "athletes" | "registrations" | "teams";
};

export type ImportWorkbookSummary = {
    mode: ImportWorkbookMode;
    importBatchId: string;
    athletes: number;
    baseRoster: number;
    registrations: number;
    teams: number;
    errors: number;
    warnings: number;
    createdRegistrations: number;
    updatedRegistrations: number;
    createdTeams: number;
};

export type ImportWorkbookResult = {
    summary: ImportWorkbookSummary;
    rows: ImportReportRow[];
    committed: boolean;
};

type ImportWorkbookInput = {
    tournamentId: string;
    fileBase64: string;
    fileName: string;
    mode: ImportWorkbookMode;
    defaultCountry: string;
    defaultState: string;
    sheetMappings?: Record<string, string>;
};

export const importTournamentWorkbook = async (input: ImportWorkbookInput): Promise<ImportWorkbookResult> => {
    const callable = httpsCallable<ImportWorkbookInput, ImportWorkbookResult>(functions, "importTournamentWorkbook");
    const result = await callable(input);
    return result.data;
};
