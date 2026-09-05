import {httpsCallable} from "firebase/functions";
import {createOperationId, getRelease} from "../observability";
import {measureOperation} from "../performance";
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
    workbookSha256: string;
    planChecksum: string;
    profilesCreated: number;
    profilesReused: number;
    registrationsCreated: number;
    registrationsUpdated: number;
    registrationsUnchanged: number;
    teamsCreated: number;
    teamsUpdated: number;
    teamsUnchanged: number;
    conflicts: number;
};

export type ImportWorkbookResult = {
    summary: ImportWorkbookSummary;
    rows: ImportReportRow[];
    committed: boolean;
    idempotentReplay: boolean;
};

export type TournamentImportHistoryItem = {
    id: string;
    fileName: string | null;
    status: "processing" | "committed" | "failed" | "reverted" | string;
    createdAt: string | null;
    completedAt: string | null;
    importedByName: string;
    summary: ImportWorkbookSummary | null;
    revertible: boolean;
    legacy: boolean;
    journalChanges: number;
};

export type ImportRevertPreview = {
    canRevert: boolean;
    blockers: string[];
    changes: Array<{collection: string; action: "remove" | "restore"; count: number}>;
};

type ImportWorkbookInput = {
    tournamentId: string;
    fileBase64: string;
    fileName: string;
    mode: ImportWorkbookMode;
    defaultCountry: string;
    defaultState: string;
    sheetMappings?: Record<string, string>;
    expectedPlanChecksum?: string;
    meta?: {operationId: string; release: string};
};

export const importTournamentWorkbook = async (input: ImportWorkbookInput): Promise<ImportWorkbookResult> => {
    if (import.meta.env.DEV && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR !== "true") {
        throw new Error(
            "Local workbook imports require the Functions emulator. Set VITE_USE_FUNCTIONS_EMULATOR=true and start the emulator first.",
        );
    }
    const callable = httpsCallable<ImportWorkbookInput, ImportWorkbookResult>(functions, "importTournamentWorkbook", {
        timeout: 540000,
    });
    const traceName = input.mode === "preview" ? "excel_preview" : "excel_commit";
    const result = await measureOperation(
        traceName,
        () => callable({...input, meta: input.meta ?? {operationId: createOperationId(), release: getRelease()}}),
        {entityType: "tournament-import", tournamentId: input.tournamentId},
    );
    return result.data;
};

export const listTournamentImportHistory = async (tournamentId: string): Promise<TournamentImportHistoryItem[]> => {
    const callable = httpsCallable<{tournamentId: string}, {batches: TournamentImportHistoryItem[]}>(
        functions,
        "listTournamentImportHistory",
    );
    return (await callable({tournamentId})).data.batches;
};

export const previewTournamentImportRevert = async (tournamentId: string, importBatchId: string): Promise<ImportRevertPreview> => {
    const callable = httpsCallable<{tournamentId: string; importBatchId: string}, ImportRevertPreview>(
        functions,
        "previewTournamentImportRevert",
    );
    return (await callable({tournamentId, importBatchId})).data;
};

export const revertTournamentImport = async (tournamentId: string, importBatchId: string): Promise<{reverted: boolean; changes: number}> => {
    const callable = httpsCallable<{tournamentId: string; importBatchId: string; confirm: boolean}, {reverted: boolean; changes: number}>(
        functions,
        "revertTournamentImport",
        {timeout: 540000},
    );
    return (await callable({tournamentId, importBatchId, confirm: true})).data;
};
