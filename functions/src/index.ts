import {randomUUID} from "node:crypto";
import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import type {UserRecord} from "firebase-admin/auth";
import {getAuth} from "firebase-admin/auth";
import {
    type DocumentReference,
    FieldValue,
    type QueryDocumentSnapshot,
    Timestamp as FirestoreTimestamp,
    type WriteBatch,
    getFirestore,
} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {defineSecret} from "firebase-functions/params";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {HttpsError, onCall, onRequest} from "firebase-functions/v2/https";
import ExcelJS from "exceljs";
import nodemailer from "nodemailer";
import type {Registration} from "./../../src/schema/RegistrationSchema.js";
import type {Team, TeamMember} from "./../../src/schema/TeamSchema.js";
import type {UserRegistrationRecord} from "./../../src/schema/UserSchema.js";

const allowedOriginList = [
    "https://rankingstack.com",
    "https://www.rankingstack.com",
    "https://sport-stacking-website.web.app",
    "https://sport-stacking-website.firebaseapp.com",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
];

const allowedOrigins = new Set<string>(allowedOriginList);
const allowedOriginPatterns = [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];
const functionsRegion = process.env.FUNCTIONS_REGION ?? "asia-southeast1";
const callableFunctionOptions = {
    cors: [...allowedOriginList, ...allowedOriginPatterns],
    region: functionsRegion,
};
const importWorkbookFunctionOptions = {
    ...callableFunctionOptions,
    memory: "1GiB" as const,
    timeoutSeconds: 540,
};

const corsHandler = cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin) || allowedOriginPatterns.some((pattern) => pattern.test(origin))) {
            callback(null, true);
            return;
        }
        callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: ["GET", "POST", "OPTIONS"],
});

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";
const RESEND_API_URL = process.env.RESEND_API_URL ?? "https://api.resend.com/emails";
const PASSWORD_RESET_CONTINUE_URL = process.env.PASSWORD_RESET_CONTINUE_URL ?? "https://rankingstack.com/login";

// AWS SES Secrets for backup email delivery
const AWS_SES_SMTP_USERNAME = defineSecret("AWS_SES_SMTP_USERNAME");
const AWS_SES_SMTP_PASSWORD = defineSecret("AWS_SES_SMTP_PASSWORD");
const AWS_SES_REGION = "ap-southeast-2";
const AWS_SES_FROM_EMAIL = process.env.AWS_SES_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";

if (!getApps().length) {
    initializeApp();
}

const firebaseApp = getApps()[0] ?? initializeApp();
// Cloud Functions always operate on the primary production database. This must
// not be configurable by deployment environment variables.
const db = getFirestore(firebaseApp);
const firestoreTriggerDatabase = "(default)";

type ImportIdentityType = "MYKAD" | "PASSPORT" | "NONE";
type ImportGender = "Male" | "Female";
type ImportMode = "preview" | "commit";

type ImportRequestPayload = {
    tournamentId?: unknown;
    fileBase64?: unknown;
    fileName?: unknown;
    mode?: unknown;
    defaultCountry?: unknown;
    defaultState?: unknown;
    sheetMappings?: unknown;
};

type ImportEvent = {
    id: string;
    type: string;
    gender?: string;
    teamSize?: number;
};

type ImportAthlete = {
    workbookKey: string;
    name: string;
    identityType: ImportIdentityType;
    identityNumber: string | null;
    identityKey: string | null;
    passportCountry: string | null;
    birthdate: Date;
    gender: ImportGender;
    country: [string, string];
    sourceSheet: string;
    sourceRow: number;
    parentOnly: boolean;
    userDocId?: string;
    globalId?: string;
};

type ImportTeam = {
    eventId: string;
    eventType: string;
    sheetName: string;
    sourceRow: number;
    members: string[];
};

type ImportReportRow = {
    sheet: string;
    row: number;
    level: "error" | "warning" | "info";
    message: string;
    category?: "errors" | "warnings" | "athletes" | "registrations" | "teams";
};

const IMPORT_BATCH_WRITE_LIMIT = 450;
const IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY = 500;

type ParsedWorkbookImport = {
    athletes: Map<string, ImportAthlete>;
    invalidAthleteKeys: Set<string>;
    baseRosterKeys: Set<string>;
    registrationsByAthleteKey: Map<string, Set<string>>;
    teams: ImportTeam[];
    rows: ImportReportRow[];
};

type ImportUserProfileData = {
    id?: string;
    global_id?: string;
    name?: string;
    name_search?: string | null;
    IC?: string | null;
    email?: string | null;
    owner_uids?: string[] | null;
    primary_owner_email?: string | null;
    account_status?: "claimed" | "unclaimed" | "claim_review" | null;
    source?: "legacy" | "self_registered" | "admin_import" | null;
    identity_type?: ImportIdentityType | null;
    identity_key?: string | null;
    passport_country?: string | null;
    country?: string[] | null;
};

type ProfileClaimRequestStatus = "pending" | "approved" | "rejected";

type ProfileClaimRequestData = {
    requester_uid: string;
    requester_email: string;
    profile_global_id?: string | null;
    profile_name: string;
    identity_hint?: string | null;
    birthdate_hint?: FirestoreTimestamp | null;
    tournament_hint?: string | null;
    note?: string | null;
    status: ProfileClaimRequestStatus;
    matched_profile_id?: string | null;
    reviewed_by_uid?: string | null;
    reviewed_by_email?: string | null;
    rejection_reason?: string | null;
    created_at?: FirestoreTimestamp;
    updated_at?: FirestoreTimestamp;
    reviewed_at?: FirestoreTimestamp | null;
};

const IMPORT_TEMPLATE_MAPPING_SHEET_NAME = "__TemplateMapping";

const importCellToString = (value: ExcelJS.CellValue): string => {
    if (value == null) {
        return "";
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        if ("text" in value && typeof value.text === "string") {
            return value.text.trim();
        }
        if ("result" in value) {
            return importCellToString(value.result as ExcelJS.CellValue);
        }
        if ("formula" in value) {
            return "";
        }
        if ("richText" in value && Array.isArray(value.richText)) {
            return value.richText
                .map((item) => item.text)
                .join("")
                .trim();
        }
        if ("hyperlink" in value && "text" in value && typeof value.text === "string") {
            return value.text.trim();
        }
    }
    return String(value).trim();
};

const importNormalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const importNormalizeCompact = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

const importNormalizeEventType = (value: string): string => {
    const normalized = importNormalize(value).replace(/&/g, "and");
    const aliases: Record<string, string> = {
        double: "double",
        doubles: "double",
        "stack up champion": "stackout champion",
        "stack out champion": "stackout champion",
        "stackout champion": "stackout champion",
        "time relay": "team relay",
        "team relay": "team relay",
    };
    return aliases[normalized] ?? normalized;
};

const importIsEventType = (event: ImportEvent, expectedType: string): boolean =>
    importNormalizeEventType(event.type) === importNormalizeEventType(expectedType);

const importIsIndividualEvent = (event: ImportEvent): boolean => {
    const normalizedType = importNormalizeEventType(event.type);
    return normalizedType === "individual" || normalizedType.includes("individual");
};

const importIsTeamEvent = (event: ImportEvent): boolean =>
    importIsEventType(event, "Double") || importIsEventType(event, "Team Relay") || importIsEventType(event, "Parent & Child");

const importGetExpectedTeamSize = (event: ImportEvent): number => {
    if (typeof event.teamSize === "number" && event.teamSize > 0) {
        return event.teamSize;
    }
    if (importIsEventType(event, "Double") || importIsEventType(event, "Parent & Child")) {
        return 2;
    }
    if (importIsEventType(event, "Team Relay")) {
        return 4;
    }
    return 1;
};

const importBuildIdentityKey = (
    identityType: ImportIdentityType,
    identityNumber: string | null,
    passportCountry: string | null,
): string | null => {
    const normalizedNumber = importNormalizeCompact(identityNumber ?? "");
    if (!normalizedNumber || identityType === "NONE") {
        return null;
    }
    if (identityType === "MYKAD") {
        return `MYKAD:${normalizedNumber}`;
    }
    return `PASSPORT:${importNormalizeCompact(passportCountry ?? "UNKNOWN") || "UNKNOWN"}:${normalizedNumber}`;
};

const importInferIdentityType = (identityNumber: string | null): ImportIdentityType => {
    const normalizedNumber = importNormalizeCompact(identityNumber ?? "");
    if (!normalizedNumber) {
        return "NONE";
    }
    return /^\d{12}$/.test(normalizedNumber) ? "MYKAD" : "PASSPORT";
};

const importParseDate = (value: ExcelJS.CellValue): Date | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const excelEpoch = Date.UTC(1899, 11, 30);
        return new Date(excelEpoch + value * 24 * 60 * 60 * 1000);
    }
    const raw = importCellToString(value);
    if (!raw) {
        return null;
    }
    const slashMatch = raw.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
    if (slashMatch) {
        const first = Number(slashMatch[1]);
        const second = Number(slashMatch[2]);
        const third = Number(slashMatch[3]);
        const year = slashMatch[1].length === 4 ? first : third;
        const month = slashMatch[1].length === 4 ? second : second;
        const day = slashMatch[1].length === 4 ? third : first;
        const parsed = new Date(Date.UTC(year, month - 1, day));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const importFormatDateKey = (date: Date): string => date.toISOString().slice(0, 10);

const importAgeAtTournament = (birthdate: Date, startDate: Date): number => {
    let age = startDate.getUTCFullYear() - birthdate.getUTCFullYear();
    const birthdayThisYear = new Date(Date.UTC(startDate.getUTCFullYear(), birthdate.getUTCMonth(), birthdate.getUTCDate()));
    if (startDate.getTime() < birthdayThisYear.getTime()) {
        age -= 1;
    }
    return age;
};

const importInferGender = (identityType: ImportIdentityType, identityNumber: string | null): ImportGender | null => {
    if (identityType !== "MYKAD" || !identityNumber) {
        return null;
    }
    const normalized = importNormalizeCompact(identityNumber);
    const lastDigit = Number(normalized[normalized.length - 1]);
    if (!Number.isFinite(lastDigit)) {
        return null;
    }
    return lastDigit % 2 === 1 ? "Male" : "Female";
};

const importWorkbookKey = (athlete: Pick<ImportAthlete, "identityKey" | "name" | "birthdate">): string => {
    if (athlete.identityKey) {
        return athlete.identityKey;
    }
    return `NO_ID:${importNormalize(athlete.name)}:${importFormatDateKey(athlete.birthdate)}`;
};

const importNamesMatch = (firstName: string, secondName: string): boolean => importNormalize(firstName) === importNormalize(secondName);

const importFindHeaderRow = (worksheet: ExcelJS.Worksheet): number => {
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12); rowNumber += 1) {
        const rowText = worksheet.getRow(rowNumber).values.toString().toLowerCase();
        if (rowText.includes("name") && (rowText.includes("birth") || rowText.includes("dob"))) {
            return rowNumber;
        }
    }
    return 2;
};

const importFindColumns = (worksheet: ExcelJS.Worksheet, headerRowNumber: number) => {
    const headerRow = worksheet.getRow(headerRowNumber);
    const columns = {
        role: 0,
        name: 0,
        identity: 0,
        birthdate: 0,
        gender: 0,
        country: 0,
        state: 0,
        no: 1,
    };

    headerRow.eachCell((cell, colNumber) => {
        const value = importNormalize(importCellToString(cell.value));
        if (!value) {
            return;
        }
        const headerTokens = value
            .replace(/[^a-z0-9]+/g, " ")
            .split(" ")
            .filter(Boolean);
        if (value.includes("name")) columns.name = colNumber;
        if (value.includes("passport") || headerTokens.includes("ic") || value.includes("identity")) columns.identity = colNumber;
        if (value.includes("birth") || value.includes("dob")) columns.birthdate = colNumber;
        if (value.includes("gender")) columns.gender = colNumber;
        if (value === "country") columns.country = colNumber;
        if (value === "state" || value.includes("region")) columns.state = colNumber;
        if (value === "no" || value === "no.") columns.no = colNumber;
    });

    return columns;
};

const importDetectRole = (row: ExcelJS.Row): {role: "child" | "parent" | null; col: number} => {
    let role: "child" | "parent" | null = null;
    let col = 0;
    row.eachCell((cell, colNumber) => {
        const value = importNormalize(importCellToString(cell.value)).replace(":", "");
        if (value === "child" || value === "parent") {
            role = value;
            col = colNumber;
        }
    });
    return {role, col};
};

const importIsExampleMarker = (value: string): boolean => {
    const normalized = importNormalize(value).replace(":", "");
    return normalized === "ex" || normalized === "example";
};

const importIsMergedContinuationCell = (cell: ExcelJS.Cell): boolean => cell.isMerged && cell.master.address !== cell.address;

const importRowHasParticipantContent = (row: ExcelJS.Row, columns: ReturnType<typeof importFindColumns>): boolean => {
    const checkedColumns = [columns.name, columns.identity, columns.birthdate].filter((column) => column > 0);
    return checkedColumns.some((column) => importCellToString(row.getCell(column).value).trim().length > 0);
};

const importGetLastRelevantRow = (
    worksheet: ExcelJS.Worksheet,
    headerRowNumber: number,
    columns: ReturnType<typeof importFindColumns>,
): number => {
    let lastRelevantRow = headerRowNumber;
    worksheet.eachRow({includeEmpty: false}, (row, rowNumber) => {
        if (rowNumber <= headerRowNumber) {
            return;
        }
        const noText = importCellToString(row.getCell(columns.no).value);
        if (importIsExampleMarker(noText) || importRowHasParticipantContent(row, columns)) {
            lastRelevantRow = Math.max(lastRelevantRow, rowNumber);
        }
    });
    return lastRelevantRow;
};

const importFindNextTextCell = (row: ExcelJS.Row, startCol: number): {value: string; col: number} => {
    for (let col = startCol; col <= row.cellCount; col += 1) {
        const value = importCellToString(row.getCell(col).value);
        if (value && !["child:", "parent:", "child", "parent"].includes(importNormalize(value))) {
            return {value, col};
        }
    }
    return {value: "", col: 0};
};

const importGetAthleteNameFromRow = (
    row: ExcelJS.Row,
    columns: ReturnType<typeof importFindColumns>,
    roleCol?: number,
): string => {
    const value =
        columns.name > 0
            ? importCellToString(row.getCell(columns.name).value)
            : importFindNextTextCell(row, roleCol ? roleCol + 1 : 1).value;
    const name = value.trim();
    return !name || name.toLowerCase() === "name" ? "" : name;
};

const importResolveEventForSheet = (
    sheetName: string,
    events: ImportEvent[],
    explicitMapping: Record<string, string>,
): ImportEvent | null => {
    const mapped = explicitMapping[sheetName] ?? explicitMapping[importNormalize(sheetName)];
    if (mapped) {
        const normalizedMappedType = importNormalizeEventType(mapped);
        const mappedEvent = events.find(
            (event) => event.id === mapped || importNormalizeEventType(event.type) === normalizedMappedType,
        );
        if (mappedEvent) {
            return mappedEvent;
        }
    }

    const normalizedSheet = importNormalize(sheetName).replace(/&/g, "and");
    const aliases: [string, string][] = [
        ["individual", "Individual"],
        ["doubles", "Double"],
        ["double", "Double"],
        ["child and parent", "Parent & Child"],
        ["parent and child", "Parent & Child"],
        ["time relay", "Team Relay"],
        ["team relay", "Team Relay"],
        ["stackout champion", "StackOut Champion"],
        ["stackout", "StackOut Champion"],
        ["stack out champion", "StackOut Champion"],
        ["stack up champion", "StackOut Champion"],
    ];
    const alias = aliases.find(([name]) => normalizedSheet.includes(name))?.[1];
    if (alias) {
        const normalizedAliasType = importNormalizeEventType(alias);
        return (
            events.find(
                (event) =>
                    importNormalizeEventType(event.type) === normalizedAliasType ||
                    (alias === "Individual" && importIsIndividualEvent(event)),
            ) ?? null
        );
    }

    return events.find((event) => normalizedSheet.includes(importNormalizeEventType(event.type))) ?? null;
};

const importReadTemplateMappings = (workbook: ExcelJS.Workbook): Record<string, string> => {
    const worksheet = workbook.getWorksheet(IMPORT_TEMPLATE_MAPPING_SHEET_NAME);
    if (!worksheet) {
        return {};
    }

    const mappings: Record<string, string> = {};
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        const sheetName = importCellToString(row.getCell(1).value);
        const eventId = importCellToString(row.getCell(2).value);
        const eventType = importCellToString(row.getCell(3).value);
        const mappedValue = eventId || eventType;
        if (!sheetName || !mappedValue) {
            continue;
        }
        mappings[sheetName] = mappedValue;
        mappings[importNormalize(sheetName)] = mappedValue;
    }
    return mappings;
};

const importReadAthleteFromRow = ({
    worksheet,
    rowNumber,
    columns,
    roleCol,
    defaultCountry,
    defaultState,
    eventGender,
}: {
    worksheet: ExcelJS.Worksheet;
    rowNumber: number;
    columns: ReturnType<typeof importFindColumns>;
    roleCol?: number;
    defaultCountry: string;
    defaultState: string;
    eventGender?: string;
}): {athlete: ImportAthlete | null; warnings: string[]} => {
    const row = worksheet.getRow(rowNumber);
    const nameCell =
        columns.name > 0
            ? {value: importCellToString(row.getCell(columns.name).value), col: columns.name}
            : importFindNextTextCell(row, roleCol ? roleCol + 1 : 1);
    const name = nameCell.value.trim();
    if (!name || name.toLowerCase() === "name") {
        return {athlete: null, warnings: []};
    }

    const identityNumber = columns.identity > 0 ? importCellToString(row.getCell(columns.identity).value) || null : null;
    const identityType = importInferIdentityType(identityNumber);
    const birthdateCell = columns.birthdate > 0 ? row.getCell(columns.birthdate).value : row.getCell(nameCell.col + 1).value;
    const parsedBirthdate = importParseDate(birthdateCell);
    const warnings: string[] = [];
    if (!parsedBirthdate) {
        return {athlete: null, warnings: [`${name}: missing or invalid date of birth.`]};
    }
    const birthdate = parsedBirthdate;

    const genderText = columns.gender > 0 ? importNormalize(importCellToString(row.getCell(columns.gender).value)) : "";
    const inferredGender = importInferGender(identityType, identityNumber);
    const gender =
        genderText.startsWith("f") || genderText.includes("female")
            ? "Female"
            : genderText.startsWith("m") || genderText.includes("male")
              ? "Male"
              : (inferredGender ?? (eventGender === "Female" ? "Female" : "Male"));
    if (!genderText && !inferredGender && eventGender !== "Female" && eventGender !== "Male") {
        warnings.push(`${name}: gender missing; defaulted to Male.`);
    }

    const country =
        columns.country > 0 ? importCellToString(row.getCell(columns.country).value) || defaultCountry : defaultCountry;
    const state = columns.state > 0 ? importCellToString(row.getCell(columns.state).value) || defaultState : defaultState;
    const passportCountry = identityType === "PASSPORT" ? country : null;
    const identityKey = importBuildIdentityKey(identityType, identityNumber, passportCountry);
    const athlete: ImportAthlete = {
        workbookKey: "",
        name,
        identityType,
        identityNumber,
        identityKey,
        passportCountry,
        birthdate,
        gender,
        country: [country, state],
        sourceSheet: worksheet.name,
        sourceRow: rowNumber,
        parentOnly: false,
    };
    athlete.workbookKey = importWorkbookKey(athlete);
    return {athlete, warnings};
};

const importMergeAthlete = (parsed: ParsedWorkbookImport, athlete: ImportAthlete, rows: ImportReportRow[]): ImportAthlete => {
    const existing = parsed.athletes.get(athlete.workbookKey);
    if (!existing) {
        parsed.athletes.set(athlete.workbookKey, athlete);
        return athlete;
    }
    if (!importNamesMatch(existing.name, athlete.name)) {
        if (athlete.identityKey && existing.identityKey === athlete.identityKey) {
            parsed.invalidAthleteKeys.add(athlete.workbookKey);
            rows.push({
                sheet: athlete.sourceSheet,
                row: athlete.sourceRow,
                level: "error",
                message: `${athlete.identityNumber ?? athlete.identityKey} is used by both ${existing.name} and ${athlete.name}. Fix the name or Passport/IC before importing.`,
            });
            return existing;
        }
        rows.push({
            sheet: athlete.sourceSheet,
            row: athlete.sourceRow,
            level: "warning",
            message: `Matched ${athlete.name} to existing imported athlete ${existing.name}.`,
        });
    }
    if (existing.identityType === "NONE" && athlete.identityType !== "NONE") {
        Object.assign(existing, {
            identityType: athlete.identityType,
            identityNumber: athlete.identityNumber,
            identityKey: athlete.identityKey,
            passportCountry: athlete.passportCountry,
            workbookKey: athlete.workbookKey,
        });
    }
    existing.parentOnly = existing.parentOnly && athlete.parentOnly;
    return existing;
};

const importAddEventForAthlete = (parsed: ParsedWorkbookImport, athleteKey: string, eventId: string): void => {
    const events = parsed.registrationsByAthleteKey.get(athleteKey) ?? new Set<string>();
    events.add(eventId);
    parsed.registrationsByAthleteKey.set(athleteKey, events);
};

const importParseWorkbook = (
    workbook: ExcelJS.Workbook,
    events: ImportEvent[],
    options: {
        defaultCountry: string;
        defaultState: string;
        sheetMappings: Record<string, string>;
    },
): ParsedWorkbookImport => {
    const parsed: ParsedWorkbookImport = {
        athletes: new Map(),
        invalidAthleteKeys: new Set(),
        baseRosterKeys: new Set(),
        registrationsByAthleteKey: new Map(),
        teams: [],
        rows: [],
    };
    const individualEvent = events.find((event) => importIsEventType(event, "Individual")) ?? events.find(importIsIndividualEvent);
    if (!individualEvent) {
        parsed.rows.push({sheet: "Workbook", row: 0, level: "error", message: "Tournament has no Individual event."});
        return parsed;
    }
    const sheetMappings = {
        ...importReadTemplateMappings(workbook),
        ...options.sheetMappings,
    };

    for (const worksheet of workbook.worksheets) {
        if (worksheet.name === IMPORT_TEMPLATE_MAPPING_SHEET_NAME) {
            continue;
        }

        const event = importResolveEventForSheet(worksheet.name, events, sheetMappings);
        if (!event) {
            parsed.rows.push({
                sheet: worksheet.name,
                row: 0,
                level: "warning",
                message: "Sheet was skipped because it does not map to a tournament event.",
            });
            continue;
        }

        const headerRowNumber = importFindHeaderRow(worksheet);
        const columns = importFindColumns(worksheet, headerRowNumber);
        const isIndividualSheet = event.id === individualEvent.id || importIsIndividualEvent(event);
        const isParentChildSheet = importIsEventType(event, "Parent & Child");
        const isTeamSheet = importIsTeamEvent(event);
        const lastRelevantRow = importGetLastRelevantRow(worksheet, headerRowNumber, columns);

        if (!isTeamSheet) {
            for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRelevantRow; rowNumber += 1) {
                const row = worksheet.getRow(rowNumber);
                const noText = importNormalize(importCellToString(row.getCell(columns.no).value));
                if (noText === "ex:" || noText === "ex") {
                    continue;
                }
                if (!importRowHasParticipantContent(row, columns)) {
                    continue;
                }
                const {athlete, warnings} = importReadAthleteFromRow({
                    worksheet,
                    rowNumber,
                    columns,
                    defaultCountry: options.defaultCountry,
                    defaultState: options.defaultState,
                    eventGender: event.gender,
                });
                for (const warning of warnings) {
                    parsed.rows.push({sheet: worksheet.name, row: rowNumber, level: "warning", message: warning});
                }
                if (!athlete) {
                    continue;
                }
                const merged = importMergeAthlete(parsed, athlete, parsed.rows);
                if (isIndividualSheet) {
                    parsed.baseRosterKeys.add(merged.workbookKey);
                    if (!parsed.invalidAthleteKeys.has(merged.workbookKey)) {
                        importAddEventForAthlete(parsed, merged.workbookKey, individualEvent.id);
                    }
                } else if (!parsed.baseRosterKeys.has(merged.workbookKey)) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: `${merged.name} must appear in the Individual sheet before joining ${event.type}.`,
                    });
                } else if (parsed.invalidAthleteKeys.has(merged.workbookKey)) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: `${merged.name} has a Passport/IC conflict and cannot be registered for ${event.type}.`,
                    });
                } else {
                    importAddEventForAthlete(parsed, merged.workbookKey, event.id);
                }
            }
            continue;
        }

        if (isParentChildSheet) {
            for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRelevantRow; rowNumber += 1) {
                const row = worksheet.getRow(rowNumber);
                const noText = importCellToString(row.getCell(columns.no).value);
                if (importIsExampleMarker(noText)) {
                    rowNumber += 1;
                    continue;
                }
                const nextRow = worksheet.getRow(rowNumber + 1);
                if (!importRowHasParticipantContent(row, columns) && !importRowHasParticipantContent(nextRow, columns)) {
                    continue;
                }
                const roleInfo = importDetectRole(row);
                if (roleInfo.role !== "child") {
                    continue;
                }
                const childName = importGetAthleteNameFromRow(row, columns, roleInfo.col);
                const parentName = importGetAthleteNameFromRow(nextRow, columns, roleInfo.col);
                if (!childName && !parentName) {
                    continue;
                }
                const childResult = importReadAthleteFromRow({
                    worksheet,
                    rowNumber,
                    columns,
                    roleCol: roleInfo.col,
                    defaultCountry: options.defaultCountry,
                    defaultState: options.defaultState,
                    eventGender: event.gender,
                });
                const parentResult = importReadAthleteFromRow({
                    worksheet,
                    rowNumber: rowNumber + 1,
                    columns,
                    roleCol: roleInfo.col,
                    defaultCountry: options.defaultCountry,
                    defaultState: options.defaultState,
                    eventGender: event.gender,
                });
                for (const warning of childResult.warnings) {
                    parsed.rows.push({sheet: worksheet.name, row: rowNumber, level: "warning", message: warning});
                }
                for (const warning of parentResult.warnings) {
                    parsed.rows.push({sheet: worksheet.name, row: rowNumber + 1, level: "warning", message: warning});
                }
                if (!childResult.athlete || !parentResult.athlete) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: "Child and Parent block must include both child and parent names and DOB.",
                    });
                    continue;
                }
                const child = importMergeAthlete(parsed, childResult.athlete, parsed.rows);
                const parentInput = {...parentResult.athlete, parentOnly: true};
                const parent = importMergeAthlete(parsed, parentInput, parsed.rows);
                if (parsed.invalidAthleteKeys.has(child.workbookKey) || parsed.invalidAthleteKeys.has(parent.workbookKey)) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: "Child and Parent block has a Passport/IC conflict and cannot be imported.",
                    });
                    continue;
                }
                if (!parsed.baseRosterKeys.has(child.workbookKey)) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: `${child.name} must appear in the Individual sheet before joining Parent & Child.`,
                    });
                    continue;
                }
                importAddEventForAthlete(parsed, child.workbookKey, event.id);
                parsed.teams.push({
                    eventId: event.id,
                    eventType: event.type,
                    sheetName: worksheet.name,
                    sourceRow: rowNumber,
                    members: [child.workbookKey, parent.workbookKey],
                });
            }
            continue;
        }

        let currentBlock: string[] = [];
        let currentBlockRow = 0;
        let currentBlockHasErrors = false;
        const expectedSize = importGetExpectedTeamSize(event);
        const flushBlock = () => {
            if (currentBlock.length === 0) {
                return;
            }
            if (currentBlock.length !== expectedSize) {
                parsed.rows.push({
                    sheet: worksheet.name,
                    row: currentBlockRow,
                    level: "error",
                    message: `${event.type} block has ${currentBlock.length} members; expected ${expectedSize}.`,
                });
            } else if (!currentBlockHasErrors) {
                parsed.teams.push({
                    eventId: event.id,
                    eventType: event.type,
                    sheetName: worksheet.name,
                    sourceRow: currentBlockRow,
                    members: currentBlock,
                });
                for (const athleteKey of currentBlock) {
                    importAddEventForAthlete(parsed, athleteKey, event.id);
                }
            }
            currentBlock = [];
            currentBlockRow = 0;
            currentBlockHasErrors = false;
        };

        for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRelevantRow; rowNumber += 1) {
            const row = worksheet.getRow(rowNumber);
            const noCell = row.getCell(columns.no);
            const noText = importCellToString(noCell.value);
            if (importIsExampleMarker(noText)) {
                flushBlock();
                rowNumber += expectedSize - 1;
                continue;
            }
            if (!importRowHasParticipantContent(row, columns)) {
                continue;
            }
            const startsBlock =
                noText.trim().length > 0 && noText.toLowerCase() !== "ex:" && !importIsMergedContinuationCell(noCell);
            if (startsBlock) {
                flushBlock();
                currentBlockRow = rowNumber;
            } else if (currentBlockRow === 0) {
                currentBlockRow = rowNumber;
            }
            const {athlete, warnings} = importReadAthleteFromRow({
                worksheet,
                rowNumber,
                columns,
                defaultCountry: options.defaultCountry,
                defaultState: options.defaultState,
                eventGender: event.gender,
            });
            for (const warning of warnings) {
                parsed.rows.push({sheet: worksheet.name, row: rowNumber, level: "warning", message: warning});
            }
            if (!athlete) {
                continue;
            }
            const merged = importMergeAthlete(parsed, athlete, parsed.rows);
            currentBlock.push(merged.workbookKey);
            if (parsed.invalidAthleteKeys.has(merged.workbookKey)) {
                parsed.rows.push({
                    sheet: worksheet.name,
                    row: rowNumber,
                    level: "error",
                    message: `${merged.name} has a Passport/IC conflict and cannot join ${event.type}.`,
                });
                currentBlockHasErrors = true;
                continue;
            }
            if (!parsed.baseRosterKeys.has(merged.workbookKey)) {
                parsed.rows.push({
                    sheet: worksheet.name,
                    row: rowNumber,
                    level: "error",
                    message: `${merged.name} must appear in the Individual sheet before joining ${event.type}.`,
                });
                currentBlockHasErrors = true;
            }
        }
        flushBlock();
    }

    if (parsed.baseRosterKeys.size === 0) {
        parsed.rows.push({sheet: "Individual", row: 0, level: "error", message: "Individual sheet has no valid athletes."});
    }

    return parsed;
};

const importNextGlobalIdNumber = (current: number): number => {
    let candidate = current + 1;
    while (String(candidate).includes("4")) {
        candidate += 1;
    }
    return candidate;
};

const importReserveGlobalIds = async (count: number): Promise<string[]> => {
    if (count <= 0) {
        return [];
    }

    const counterRef = db.collection("counters").doc("userCounter");
    return db.runTransaction(async (transaction) => {
        const snap = await transaction.get(counterRef);
        const current = snap.exists ? ((snap.data()?.count as number | undefined) ?? 0) : 0;
        const reserved: number[] = [];
        let last = current;

        while (reserved.length < count) {
            last = importNextGlobalIdNumber(last);
            reserved.push(last);
        }

        transaction.set(counterRef, {count: last}, {merge: true});
        return reserved.map((value) => String(value).padStart(5, "0"));
    });
};

const importCommitBatchWrites = async (applyWrites: Array<(batch: WriteBatch) => void>): Promise<void> => {
    for (let index = 0; index < applyWrites.length; index += IMPORT_BATCH_WRITE_LIMIT) {
        const batch = db.batch();
        for (const applyWrite of applyWrites.slice(index, index + IMPORT_BATCH_WRITE_LIMIT)) {
            applyWrite(batch);
        }
        await batch.commit();
    }
};

const importGetDocumentsInChunks = async <T extends DocumentReference>(refs: T[]) => {
    const snapshots: Awaited<ReturnType<typeof db.getAll>> = [];
    for (let index = 0; index < refs.length; index += IMPORT_BATCH_WRITE_LIMIT) {
        snapshots.push(...(await db.getAll(...refs.slice(index, index + IMPORT_BATCH_WRITE_LIMIT))));
    }
    return snapshots;
};

const profileSnapshotBelongsToUid = (profile: {id: string; data: () => Record<string, unknown> | undefined}, uid: string): boolean => {
    const data = profile.data() as {owner_uids?: string[] | null};
    if (Array.isArray(data.owner_uids)) {
        return data.owner_uids.includes(uid);
    }

    return profile.id === uid;
};

const importIsAuthorized = async (uid: string, tournamentId: string): Promise<boolean> => {
    const tournamentSnap = await db.collection("tournaments").doc(tournamentId).get();
    const tournamentData = tournamentSnap.data() as {editor?: string; recorder?: string} | undefined;
    const ownedProfilesSnap = await db.collection("users").where("owner_uids", "array-contains", uid).get();
    const legacyProfileSnap = await db.collection("users").doc(uid).get();
    const profiles = [
        ...ownedProfilesSnap.docs,
        ...(legacyProfileSnap.exists && profileSnapshotBelongsToUid(legacyProfileSnap, uid) ? [legacyProfileSnap] : []),
    ];
    return profiles.some((profile) => {
        const data = profile.data() as {roles?: {modify_admin?: boolean; edit_tournament?: boolean}; global_id?: string};
        return (
            data.roles?.modify_admin === true ||
            data.roles?.edit_tournament === true ||
            data.global_id === tournamentData?.editor ||
            data.global_id === tournamentData?.recorder
        );
    });
};

const requesterHasModifyAdmin = async (uid: string): Promise<boolean> => {
    const ownedProfilesSnap = await db.collection("users").where("owner_uids", "array-contains", uid).get();
    const legacyProfileSnap = await db.collection("users").doc(uid).get();
    const profileDocs = new Map<string, {data: () => Record<string, unknown> | undefined}>();

    for (const profile of ownedProfilesSnap.docs) {
        profileDocs.set(profile.id, profile);
    }
    if (legacyProfileSnap.exists && profileSnapshotBelongsToUid(legacyProfileSnap, uid)) {
        profileDocs.set(legacyProfileSnap.id, legacyProfileSnap);
    }

    return [...profileDocs.values()].some((profile) => {
        const data = profile.data() as {roles?: {modify_admin?: boolean}} | undefined;
        return data?.roles?.modify_admin === true;
    });
};

const importInferStoredIdentityType = (data: ImportUserProfileData): ImportIdentityType | null => {
    if (data.identity_type) {
        return data.identity_type;
    }

    const normalizedIc = importNormalizeCompact(data.IC ?? "");
    if (!normalizedIc) {
        return null;
    }
    return /^\d{12}$/.test(normalizedIc) ? "MYKAD" : "PASSPORT";
};

const importGetLegacyIdentityCandidates = (athlete: ImportAthlete): string[] => {
    const rawIdentityNumber = athlete.identityNumber?.trim();
    const normalizedIdentityNumber = importNormalizeCompact(athlete.identityNumber ?? "");
    return Array.from(new Set([rawIdentityNumber, normalizedIdentityNumber].filter((value): value is string => Boolean(value))));
};

const importLegacyProfileMatchesAthlete = (data: ImportUserProfileData, athlete: ImportAthlete): boolean => {
    const storedIdentityNumber = importNormalizeCompact(data.IC ?? "");
    const importedIdentityNumber = importNormalizeCompact(athlete.identityNumber ?? "");
    if (!storedIdentityNumber || !importedIdentityNumber || storedIdentityNumber !== importedIdentityNumber) {
        return false;
    }

    const storedIdentityType = importInferStoredIdentityType(data);
    if (athlete.identityType === "MYKAD") {
        return storedIdentityType == null || storedIdentityType === "MYKAD";
    }
    if (athlete.identityType === "PASSPORT") {
        if (storedIdentityType === "MYKAD") {
            return false;
        }

        const storedPassportCountry = importNormalizeCompact(data.passport_country ?? data.country?.[0] ?? "");
        const importedPassportCountry = importNormalizeCompact(athlete.passportCountry ?? "");
        return !storedPassportCountry || !importedPassportCountry || storedPassportCountry === importedPassportCountry;
    }

    return storedIdentityType == null || storedIdentityType === "NONE";
};

const importFindExistingUserForAthlete = async (athlete: ImportAthlete): Promise<QueryDocumentSnapshot | null> => {
    if (athlete.identityKey) {
        const existingSnap = await db.collection("users").where("identity_key", "==", athlete.identityKey).limit(1).get();
        if (!existingSnap.empty) {
            return existingSnap.docs[0];
        }
    }

    const legacyIdentityCandidates = importGetLegacyIdentityCandidates(athlete);
    const checkedDocIds = new Set<string>();
    for (const identityCandidate of legacyIdentityCandidates) {
        const legacySnap = await db.collection("users").where("IC", "==", identityCandidate).get();
        for (const docSnap of legacySnap.docs) {
            if (checkedDocIds.has(docSnap.id)) {
                continue;
            }
            checkedDocIds.add(docSnap.id);
            const data = docSnap.data() as ImportUserProfileData;
            if (importLegacyProfileMatchesAthlete(data, athlete)) {
                return docSnap;
            }
        }
    }

    return null;
};

const importBuildExistingUserPatch = (
    athlete: ImportAthlete,
    existingDoc: QueryDocumentSnapshot,
    assignedGlobalId?: string,
): Partial<ImportUserProfileData> & {updated_at: FirestoreTimestamp} => {
    const data = existingDoc.data() as ImportUserProfileData;
    const nextGlobalId = data.global_id ?? assignedGlobalId;
    const accountStatus = data.account_status ?? (data.email ? "claimed" : "unclaimed");
    const ownerUids = Array.isArray(data.owner_uids) ? data.owner_uids : data.email ? [existingDoc.id] : [];
    const patch: Partial<ImportUserProfileData> & {updated_at: FirestoreTimestamp} = {
        updated_at: FirestoreTimestamp.now(),
    };

    athlete.userDocId = existingDoc.id;
    athlete.globalId = nextGlobalId;

    if (!data.id) {
        patch.id = existingDoc.id;
    }
    if (!data.global_id) {
        patch.global_id = nextGlobalId;
    }
    const normalizedNameSearch = importNormalize(data.name ?? athlete.name);
    if (data.name_search !== normalizedNameSearch) {
        patch.name_search = normalizedNameSearch;
    }
    if (!Array.isArray(data.owner_uids)) {
        patch.owner_uids = ownerUids;
    }
    if (!data.primary_owner_email && data.email) {
        patch.primary_owner_email = data.email;
    }
    if (!data.account_status) {
        patch.account_status = accountStatus;
    }
    if (!data.source) {
        patch.source = "legacy";
    }
    if (!data.identity_type) {
        patch.identity_type = athlete.identityType;
    }
    if (!data.identity_key && athlete.identityKey) {
        patch.identity_key = athlete.identityKey;
    }
    if (!data.passport_country && athlete.passportCountry) {
        patch.passport_country = athlete.passportCountry;
    }

    return patch;
};

const importResolveUsers = async (athletes: Iterable<ImportAthlete>, importBatchId: string): Promise<void> => {
    const existingAthletes: Array<{athlete: ImportAthlete; existingDoc: QueryDocumentSnapshot}> = [];
    const newAthletes: ImportAthlete[] = [];

    for (const athlete of athletes) {
        const existingDoc = await importFindExistingUserForAthlete(athlete);
        if (existingDoc) {
            existingAthletes.push({athlete, existingDoc});
            continue;
        }

        newAthletes.push(athlete);
    }

    const existingWithoutGlobalId = existingAthletes.filter(({existingDoc}) => {
        const data = existingDoc.data() as ImportUserProfileData;
        return !data.global_id;
    });
    const reservedGlobalIds = await importReserveGlobalIds(existingWithoutGlobalId.length + newAthletes.length);
    let nextReservedGlobalIdIndex = 0;
    const writes: Array<(batch: WriteBatch) => void> = [];

    for (const {athlete, existingDoc} of existingAthletes) {
        const data = existingDoc.data() as ImportUserProfileData;
        const assignedGlobalId = data.global_id ? undefined : reservedGlobalIds[nextReservedGlobalIdIndex++];
        const patch = importBuildExistingUserPatch(athlete, existingDoc, assignedGlobalId);
        writes.push((batch) => batch.update(existingDoc.ref, patch));
    }

    for (const athlete of newAthletes) {
        const userRef = db.collection("users").doc();
        const globalId = reservedGlobalIds[nextReservedGlobalIdIndex++];
        const now = FirestoreTimestamp.now();
        athlete.userDocId = userRef.id;
        athlete.globalId = globalId;
        writes.push((batch) =>
            batch.set(userRef, {
                id: userRef.id,
                global_id: globalId,
                name: athlete.name,
                name_search: importNormalize(athlete.name),
                IC: athlete.identityNumber,
                email: null,
                phone_number: null,
                birthdate: FirestoreTimestamp.fromDate(athlete.birthdate),
                gender: athlete.gender,
                country: athlete.country,
                image_url: "",
                owner_uids: [],
                primary_owner_email: null,
                account_status: "unclaimed",
                source: "admin_import",
                identity_type: athlete.identityType,
                identity_key: athlete.identityKey,
                passport_country: athlete.passportCountry,
                import_batch_id: importBatchId,
                claim_method: athlete.identityType === "NONE" ? "admin_review" : "identity_match",
                roles: null,
                school: null,
                best_times: {},
                registration_records: [],
                created_at: now,
                updated_at: now,
            }),
        );
    }

    await importCommitBatchWrites(writes);
};

const importCommitRegistrationsAndTeams = async ({
    tournamentId,
    tournamentStartDate,
    parsed,
    importBatchId,
}: {
    tournamentId: string;
    tournamentStartDate: Date;
    parsed: ParsedWorkbookImport;
    importBatchId: string;
}): Promise<{createdRegistrations: number; updatedRegistrations: number; createdTeams: number}> => {
    let createdRegistrations = 0;
    let updatedRegistrations = 0;
    let createdTeams = 0;
    const registrationIdByAthleteKey = new Map<string, string>();
    const existingRegistrationsSnap = await db.collection("registrations").where("tournament_id", "==", tournamentId).get();
    const existingRegistrationByGlobalId = new Map(
        existingRegistrationsSnap.docs
            .map((docSnap) => {
                const data = docSnap.data() as {user_global_id?: string};
                return data.user_global_id ? ([data.user_global_id, docSnap] as const) : null;
            })
            .filter((entry): entry is readonly [string, QueryDocumentSnapshot] => Boolean(entry)),
    );
    const registrationWrites: Array<(batch: WriteBatch) => void> = [];
    const userRegistrationUpdates: Array<{
        userRef: DocumentReference;
        tournamentId: string;
        registrationRecord: {
            tournament_id: string;
            events: string[];
            registration_date: FirestoreTimestamp;
            status: string;
            rejection_reason: null;
            created_at: FirestoreTimestamp;
            updated_at: FirestoreTimestamp;
        };
        now: FirestoreTimestamp;
    }> = [];

    for (const [athleteKey, eventIds] of parsed.registrationsByAthleteKey.entries()) {
        const athlete = parsed.athletes.get(athleteKey);
        if (!athlete?.userDocId || !athlete.globalId || athlete.parentOnly) {
            continue;
        }
        const existingRegistrationDoc = existingRegistrationByGlobalId.get(athlete.globalId);
        const age = importAgeAtTournament(athlete.birthdate, tournamentStartDate);
        const eventsRegistered = Array.from(eventIds);
        const now = FirestoreTimestamp.now();
        let recordEvents = eventsRegistered;
        const registrationRecord = {
            tournament_id: tournamentId,
            events: recordEvents,
            registration_date: now,
            status: "approved",
            rejection_reason: null,
            created_at: now,
            updated_at: now,
        };

        if (!existingRegistrationDoc) {
            const registrationRef = db.collection("registrations").doc();
            const payload = {
                id: registrationRef.id,
                tournament_id: tournamentId,
                user_id: athlete.userDocId,
                user_global_id: athlete.globalId,
                user_name: athlete.name,
                age,
                gender: athlete.gender,
                country: athlete.country[0],
                phone_number: "",
                organizer: "",
                events_registered: eventsRegistered,
                payment_proof_url: null,
                registration_status: "approved",
                rejection_reason: null,
                final_status: null,
                import_batch_id: importBatchId,
                created_at: now,
                updated_at: now,
            };
            registrationWrites.push((batch) => batch.set(registrationRef, payload));
            registrationIdByAthleteKey.set(athleteKey, registrationRef.id);
            createdRegistrations += 1;
        } else {
            const existingData = existingRegistrationDoc.data() as {events_registered?: string[]; registration_status?: string};
            const mergedEvents = Array.from(new Set([...(existingData.events_registered ?? []), ...eventsRegistered]));
            recordEvents = mergedEvents;
            registrationWrites.push((batch) =>
                batch.update(existingRegistrationDoc.ref, {
                    events_registered: mergedEvents,
                    registration_status: "approved",
                    import_batch_id: importBatchId,
                    updated_at: now,
                }),
            );
            registrationIdByAthleteKey.set(athleteKey, existingRegistrationDoc.id);
            updatedRegistrations += 1;
            if (existingData.registration_status !== "approved") {
                createdRegistrations += 1;
            }
        }

        userRegistrationUpdates.push({
            userRef: db.collection("users").doc(athlete.userDocId),
            tournamentId,
            registrationRecord: {
                ...registrationRecord,
                events: recordEvents,
            },
            now,
        });
    }

    await importCommitBatchWrites(registrationWrites);

    const userSnapshots = await importGetDocumentsInChunks(userRegistrationUpdates.map((update) => update.userRef));
    const userWrites = userRegistrationUpdates.map((update, index) => {
        const userSnap = userSnapshots[index];
        const existingRecords = (userSnap?.data()?.registration_records as Array<{tournament_id?: string}> | undefined) ?? [];
        const nextRecords = [
            ...existingRecords.filter((record) => record.tournament_id !== update.tournamentId),
            update.registrationRecord,
        ];

        return (batch: WriteBatch) =>
            batch.update(update.userRef, {
                registration_records: nextRecords,
                updated_at: update.now,
            });
    });
    await importCommitBatchWrites(userWrites);

    if (createdRegistrations > 0) {
        await db
            .collection("tournaments")
            .doc(tournamentId)
            .update({participants: FieldValue.increment(createdRegistrations)});
    }

    const existingTeamsSnap = await db.collection("teams").where("tournament_id", "==", tournamentId).get();
    const existingTeamKeys = new Set(
        existingTeamsSnap.docs.map((docSnap) => {
            const team = docSnap.data() as {event_id?: string; leader_id?: string; members?: Array<{global_id?: string}>};
            const memberIds = (team.members ?? []).map((member) => member.global_id ?? "").sort();
            return `${team.event_id ?? ""}|${team.leader_id ?? ""}|${memberIds.join(",")}`;
        }),
    );

    for (const team of parsed.teams) {
        const athletes = team.members
            .map((memberKey) => parsed.athletes.get(memberKey))
            .filter((value): value is ImportAthlete => Boolean(value));
        if (athletes.some((athlete) => !athlete.globalId)) {
            continue;
        }
        const leader = athletes[0];
        const members = athletes.slice(1).map((athlete) => ({
            global_id: athlete.globalId as string,
            verified: true,
        }));
        const registrationId = registrationIdByAthleteKey.get(team.members[0]);
        if (!registrationId || !leader.globalId) {
            continue;
        }
        const teamKey = `${team.eventId}|${leader.globalId}|${members
            .map((member) => member.global_id)
            .sort()
            .join(",")}`;
        if (existingTeamKeys.has(teamKey)) {
            continue;
        }
        const ages = athletes.map((athlete) => importAgeAtTournament(athlete.birthdate, tournamentStartDate));
        const normalizedTeamEventType = importNormalizeEventType(team.eventType);
        const teamAge =
            normalizedTeamEventType === importNormalizeEventType("Team Relay") ||
            normalizedTeamEventType === importNormalizeEventType("Double")
                ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length)
                : ages[0];
        const teamRef = db.collection("teams").doc();
        const teamName = athletes.map((athlete) => athlete.name).join(" & ");
        await teamRef.set({
            id: teamRef.id,
            name: teamName,
            tournament_id: tournamentId,
            registration_id: registrationId,
            leader_id: leader.globalId,
            members,
            event_id: team.eventId,
            event: [team.eventType],
            team_age: teamAge,
            looking_for_member: false,
            import_batch_id: importBatchId,
            created_at: FirestoreTimestamp.now(),
            updated_at: FirestoreTimestamp.now(),
        });
        existingTeamKeys.add(teamKey);
        createdTeams += 1;
    }

    return {createdRegistrations, updatedRegistrations, createdTeams};
};

const importBuildReportRows = (parsed: ParsedWorkbookImport, events: ImportEvent[]): ImportReportRow[] => {
    const eventLabelById = new Map(events.map((event) => [event.id, event.type]));
    const rows: ImportReportRow[] = [];
    let errorRows = 0;
    let warningRows = 0;
    let athleteRows = 0;
    let registrationRows = 0;
    let teamRows = 0;

    for (const row of parsed.rows) {
        if (row.level === "warning") {
            if (warningRows >= IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY) {
                continue;
            }
            warningRows += 1;
            rows.push({...row, category: "warnings"});
            continue;
        }
        if (errorRows >= IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY) {
            continue;
        }
        errorRows += 1;
        rows.push({...row, category: "errors"});
    }

    for (const athlete of parsed.athletes.values()) {
        if (athleteRows >= IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY) {
            break;
        }
        athleteRows += 1;
        rows.push({
            sheet: athlete.sourceSheet,
            row: athlete.sourceRow,
            level: "info",
            category: "athletes",
            message: `${athlete.name} | ${athlete.gender} | ${athlete.identityNumber ?? "No Passport/IC"} | ${importFormatDateKey(athlete.birthdate)}`,
        });
    }

    for (const [athleteKey, eventIds] of parsed.registrationsByAthleteKey.entries()) {
        if (registrationRows >= IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY) {
            break;
        }
        const athlete = parsed.athletes.get(athleteKey);
        if (!athlete) {
            continue;
        }
        const eventLabels = Array.from(eventIds).map((eventId) => eventLabelById.get(eventId) ?? eventId);
        registrationRows += 1;
        rows.push({
            sheet: athlete.sourceSheet,
            row: athlete.sourceRow,
            level: "info",
            category: "registrations",
            message: `${athlete.name} | ${eventLabels.join(", ")}`,
        });
    }

    for (const team of parsed.teams) {
        if (teamRows >= IMPORT_REPORT_ROW_LIMIT_PER_CATEGORY) {
            break;
        }
        const memberNames = team.members.map((memberKey) => parsed.athletes.get(memberKey)?.name ?? memberKey);
        teamRows += 1;
        rows.push({
            sheet: team.sheetName,
            row: team.sourceRow,
            level: "info",
            category: "teams",
            message: `${team.eventType} | ${memberNames.join(" / ")}`,
        });
    }

    return rows;
};

const buildVerificationRequestId = (tournamentId: string, teamId: string, memberId: string): string =>
    `${tournamentId}_${teamId}_${memberId}`;

const deleteRecruitmentsForVerifiedMember = async ({
    tournamentId,
    memberId,
    registrationId,
}: {
    tournamentId: string;
    memberId: string;
    registrationId: string;
}): Promise<void> => {
    const teamRecruitmentRef = db.collection("team_recruitment");
    const normalizedRegistrationId = registrationId.trim();
    const [individualSnapshot, doubleSnapshot, teamLeaderSnapshot, teamRegistrationSnapshot] = await Promise.all([
        db
            .collection("individual_recruitment")
            .where("tournament_id", "==", tournamentId)
            .where("participant_id", "==", memberId)
            .get(),
        db
            .collection("double_recruitment")
            .where("tournament_id", "==", tournamentId)
            .where("participant_id", "==", memberId)
            .get(),
        teamRecruitmentRef.where("tournament_id", "==", tournamentId).where("leader_id", "==", memberId).get(),
        normalizedRegistrationId.length > 0
            ? teamRecruitmentRef
                  .where("tournament_id", "==", tournamentId)
                  .where("registration_id", "==", normalizedRegistrationId)
                  .get()
            : Promise.resolve(null),
    ]);

    const teamRecruitmentDocRefs = new Map<string, ReturnType<typeof teamRecruitmentRef.doc>>();
    for (const docSnapshot of teamLeaderSnapshot.docs) {
        teamRecruitmentDocRefs.set(docSnapshot.id, docSnapshot.ref);
    }
    if (teamRegistrationSnapshot) {
        for (const docSnapshot of teamRegistrationSnapshot.docs) {
            teamRecruitmentDocRefs.set(docSnapshot.id, docSnapshot.ref);
        }
    }

    const deletions = [
        ...individualSnapshot.docs.map((docSnapshot) => docSnapshot.ref.delete()),
        ...doubleSnapshot.docs.map((docSnapshot) => docSnapshot.ref.delete()),
        ...Array.from(teamRecruitmentDocRefs.values()).map((ref) => ref.delete()),
    ];
    if (deletions.length === 0) {
        return;
    }

    await Promise.all(deletions);
};

type TeamEventRefs = Partial<Pick<Team, "event_id" | "event">> & {
    event_ids?: unknown;
    events?: unknown;
};

type FirestoreEventRecord = {
    id?: string;
    type?: string;
    gender?: string;
    codes?: string[];
};

type BestEventType = "3-3-3" | "3-6-3" | "Cycle";
type BestTimesRecord = Partial<Record<BestEventType | "Overall", {time: number; updated_at: FirestoreTimestamp; season: string}>>;

type HistoryResultType = "individual" | "team";
type HistoryParticipantRole = "participant" | "leader" | "member";

type HistoryResult = {
    recordPath: string;
    event: string | null;
    eventKey: string | null;
    eventCategory: string | null;
    round: string | null;
    bestTime: number | null;
    try1: number | null;
    try2: number | null;
    try3: number | null;
    status: string | null;
    classification: string | null;
    resultType: HistoryResultType;
    participantRole: HistoryParticipantRole;
    teamContext: {leaderId: string | null; memberIds: string[]} | null;
    submittedAt: FirestoreTimestamp | null;
    verifiedAt: FirestoreTimestamp | null;
    createdAt: FirestoreTimestamp | null;
    updatedAt: FirestoreTimestamp | null;
    videoUrl: string | null;
};

type HistoryTournamentSummary = {
    tournamentId: string;
    tournamentName: string | null;
    startDate: FirestoreTimestamp | null;
    endDate: FirestoreTimestamp | null;
    country: string | null;
    venue: string | null;
    lastActivityAt: FirestoreTimestamp | null;
    results: HistoryResult[];
};

type UserTournamentHistoryPayload = {
    globalId: string;
    userId: string;
    updatedAt: FirestoreTimestamp;
    tournamentCount: number;
    recordCount: number;
    tournaments: HistoryTournamentSummary[];
};

const addEventReference = (target: Set<string>, value: unknown): void => {
    if (typeof value !== "string") {
        return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return;
    }

    target.add(trimmed);
};

const addEventReferences = (target: Set<string>, values: unknown): void => {
    if (!Array.isArray(values)) {
        return;
    }

    for (const value of values) {
        addEventReference(target, value);
    }
};

const getTeamEventIdReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const ids = new Set<string>();
    if (Array.isArray(team.event_id)) {
        addEventReferences(ids, team.event_id);
    } else {
        addEventReference(ids, team.event_id);
    }
    addEventReferences(ids, team.event_ids);

    return Array.from(ids);
};

const getTeamEventNameReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const names = new Set<string>();
    if (Array.isArray(team.event)) {
        addEventReferences(names, team.event);
    } else {
        addEventReference(names, team.event);
    }
    addEventReferences(names, team.events);

    return Array.from(names);
};

const getTeamEventReferences = (team: TeamEventRefs | null | undefined): string[] => {
    const references = new Set<string>();
    for (const value of getTeamEventIdReferences(team)) {
        references.add(value);
    }
    for (const value of getTeamEventNameReferences(team)) {
        references.add(value);
    }
    return Array.from(references);
};

const getPreferredTeamEventKeys = (team: TeamEventRefs | null | undefined, fallback: string[]): string[] => {
    const ids = getTeamEventIdReferences(team);
    if (ids.length > 0) {
        return ids;
    }

    const names = getTeamEventNameReferences(team);
    if (names.length > 0) {
        return names;
    }

    return fallback;
};

type RegistrationTeamSnapshot = NonNullable<Registration["teams"]>[number];

const buildRegistrationTeamSnapshot = (team: Team): RegistrationTeamSnapshot => ({
    team_id: team.id,
    label: team.name ?? "",
    name: team.name ?? "",
    member: (team.members ?? []).map((member) => ({
        global_id: member.global_id,
        verified: Boolean(member.verified),
    })),
    leader: {
        global_id: team.leader_id ?? null,
        verified: true,
    },
    looking_for_team_members: Boolean(team.looking_for_member),
});

/**
 * Keeps the legacy registration team snapshot readable by every confirmed
 * participant. The teams collection remains the source of truth.
 */
const syncRegistrationTeamSnapshots = async (teamId: string, beforeTeam: Team | null, afterTeam: Team | null): Promise<void> => {
    const tournamentId = afterTeam?.tournament_id ?? beforeTeam?.tournament_id ?? "";
    if (!tournamentId) return;

    const participantIds = new Set<string>();
    for (const team of [beforeTeam, afterTeam]) {
        if (!team) continue;
        if (team.leader_id) participantIds.add(team.leader_id);
        for (const member of team.members ?? []) {
            if (member.global_id) participantIds.add(member.global_id);
        }
    }
    if (participantIds.size === 0) return;

    const registrationSnapshots = await Promise.all(
        [...participantIds].map((participantId) =>
            db
                .collection("registrations")
                .where("tournament_id", "==", tournamentId)
                .where("user_global_id", "==", participantId)
                .limit(1)
                .get(),
        ),
    );
    const activeParticipantIds = new Set<string>();
    if (afterTeam?.leader_id) activeParticipantIds.add(afterTeam.leader_id);
    for (const member of afterTeam?.members ?? []) {
        if (member.global_id && member.verified) activeParticipantIds.add(member.global_id);
    }
    const snapshot = afterTeam ? buildRegistrationTeamSnapshot(afterTeam) : null;

    await Promise.all(
        registrationSnapshots.flatMap((result) =>
            result.docs.map((registrationDoc) => {
                const registration = registrationDoc.data() as Registration;
                const existingTeams = Array.isArray(registration.teams) ? registration.teams : [];
                const withoutCurrentTeam = existingTeams.filter((entry) => entry.team_id !== teamId);
                const nextTeams =
                    snapshot && activeParticipantIds.has(registration.user_global_id)
                        ? [...withoutCurrentTeam, snapshot]
                        : withoutCurrentTeam;
                if (JSON.stringify(nextTeams) === JSON.stringify(existingTeams)) return Promise.resolve();
                return registrationDoc.ref.update({teams: nextTeams, updated_at: FirestoreTimestamp.now()});
            }),
        ),
    );
};

const normalizeEventValue = (value: string): string => value.trim().toLowerCase();

const buildNormalizedEventSet = (values: string[]): Set<string> => {
    const normalized = new Set<string>();
    for (const value of values) {
        if (typeof value !== "string") {
            continue;
        }

        const trimmed = value.trim();
        if (trimmed.length === 0) {
            continue;
        }

        normalized.add(trimmed.toLowerCase());
    }
    return normalized;
};

const hasEventOverlap = (primary: Set<string>, secondary: Set<string>): boolean => {
    for (const value of primary) {
        if (secondary.has(value)) {
            return true;
        }
    }
    return false;
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return character;
        }
    });

const sanitizeEventCodes = (codes: unknown): string[] =>
    Array.isArray(codes)
        ? codes.filter((code): code is string => typeof code === "string" && code.length > 0 && code !== "Overall")
        : [];

const normalizeEmail = (value: unknown): string => {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().toLowerCase();
};

const buildPasswordResetEmailHtml = (resetLink: string, email: string): string => {
    const safeResetLink = escapeHtml(resetLink);
    const safeEmail = escapeHtml(email);

    return `
        <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.6; max-width: 560px;">
            <p>Hello,</p>
            <p>Follow this link to reset your Sport Stacking Website password for your ${safeEmail} account.</p>
            <p style="margin: 24px 0;">
                <a href="${safeResetLink}" style="background: #165DFF; border-radius: 6px; color: #ffffff; display: inline-block; font-weight: 600; padding: 10px 16px; text-decoration: none;">
                    Reset password
                </a>
            </p>
            <p>If you did not ask to reset your password, you can ignore this email.</p>
            <p>Thanks,<br />Sport Stacking Website team</p>
        </div>
    `;
};

const formatEventLabel = (event: FirestoreEventRecord): string | null => {
    if (!event.type) {
        return null;
    }

    const gender = event.gender === "Male" || event.gender === "Female" ? event.gender : "Mixed";
    const codes = sanitizeEventCodes(event.codes);
    const codesLabel = codes.length > 0 ? ` (${codes.join(", ")})` : "";
    return `${event.type} - ${gender}${codesLabel}`;
};

const eventMatchesReference = (event: FirestoreEventRecord, reference: string): boolean => {
    const normalizedReference = normalizeEventValue(reference);
    if (!normalizedReference) {
        return false;
    }

    const candidates: string[] = [];
    if (event.id) {
        candidates.push(event.id);
    }
    if (event.type) {
        candidates.push(event.type);
    }
    for (const code of sanitizeEventCodes(event.codes)) {
        candidates.push(code);
        if (event.type) {
            candidates.push(`${code}-${event.type}`);
        }
    }
    const label = formatEventLabel(event);
    if (label) {
        candidates.push(label);
    }

    return candidates.some((candidate) => normalizeEventValue(candidate) === normalizedReference);
};

const resolveEventLabels = async (tournamentId: string, references: string[]): Promise<string[]> => {
    if (!tournamentId || references.length === 0) {
        return [];
    }

    const eventsSnapshot = await db.collection("events").where("tournament_id", "==", tournamentId).get();
    if (eventsSnapshot.empty) {
        return [];
    }

    const events = eventsSnapshot.docs.map((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        return {
            id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : docSnap.id,
            type: typeof raw.type === "string" ? raw.type : undefined,
            gender: typeof raw.gender === "string" ? raw.gender : undefined,
            codes: Array.isArray(raw.codes) ? raw.codes.filter((code): code is string => typeof code === "string") : [],
        } satisfies FirestoreEventRecord;
    });

    const labels = new Set<string>();
    for (const reference of references) {
        const match = events.find((event) => eventMatchesReference(event, reference));
        if (match) {
            const label = formatEventLabel(match);
            if (label) {
                labels.add(label);
            }
        }
    }

    return Array.from(labels);
};

const resolveLeaderName = async (leaderId: string): Promise<string | null> => {
    if (!leaderId) {
        return null;
    }

    const leaderSnap = await db.collection("users").where("global_id", "==", leaderId).limit(1).get();
    if (leaderSnap.empty) {
        return null;
    }

    const leaderData = leaderSnap.docs[0]?.data();
    return typeof leaderData?.name === "string" ? leaderData.name : null;
};

const normalizeCode = (value: unknown): BestEventType | null => {
    if (value === "3-3-3" || value === "3-6-3" || value === "Cycle") {
        return value;
    }
    return null;
};

const getBestEventTypeFromRecord = (data: Record<string, unknown>): BestEventType | null => {
    const fromCode = normalizeCode(data.code);
    if (fromCode) {
        return fromCode;
    }

    const eventName = typeof data.event === "string" ? data.event.toLowerCase() : "";
    if (eventName.includes("3-3-3")) return "3-3-3";
    if (eventName.includes("3-6-3")) return "3-6-3";
    if (eventName.includes("cycle")) return "Cycle";
    return null;
};

const normalizeBestTime = (value: unknown): number | null => {
    const numeric = toNumber(value);
    if (numeric === null || numeric <= 0) {
        return null;
    }
    return Math.round(numeric * 1000) / 1000;
};

const getCurrentSeasonLabel = (now: FirestoreTimestamp): string => {
    const jsDate = new Date(now.toMillis());
    const year = jsDate.getUTCFullYear();
    const month = jsDate.getUTCMonth();
    const seasonStartYear = month >= 6 ? year : year - 1;
    return `${seasonStartYear}-${seasonStartYear + 1}`;
};

const collectParticipantGlobalIds = (...records: Array<Record<string, unknown> | undefined>): string[] => {
    const ids = new Set<string>();
    for (const record of records) {
        const participantGlobalId = record ? toStringOrNull(record.participant_global_id) : null;
        if (participantGlobalId) {
            ids.add(participantGlobalId);
        }
    }
    return Array.from(ids);
};

const recalculateUserBestTimesByGlobalId = async (participantGlobalId: string): Promise<void> => {
    const usersSnap = await db.collection("users").where("global_id", "==", participantGlobalId).limit(1).get();
    if (usersSnap.empty) {
        console.warn(`User not found with global_id: ${participantGlobalId}`);
        return;
    }

    const recordSnap = await db.collection("records").where("participant_global_id", "==", participantGlobalId).get();
    const bestByEvent: Partial<Record<BestEventType, number>> = {};

    for (const docSnap of recordSnap.docs) {
        const data = docSnap.data() as Record<string, unknown>;
        if (isPrelimResult(data)) {
            continue;
        }

        const eventType = getBestEventTypeFromRecord(data);
        if (!eventType) {
            continue;
        }

        const bestTime = normalizeBestTime(data.best_time);
        if (bestTime === null) {
            continue;
        }

        const current = bestByEvent[eventType];
        if (current === undefined || bestTime < current) {
            bestByEvent[eventType] = bestTime;
        }
    }

    const now = FirestoreTimestamp.now();
    const season = getCurrentSeasonLabel(now);
    const nextBestTimes: BestTimesRecord = {};

    for (const eventType of ["3-3-3", "3-6-3", "Cycle"] as const) {
        const bestTime = bestByEvent[eventType];
        if (bestTime !== undefined) {
            nextBestTimes[eventType] = {time: bestTime, updated_at: now, season};
        }
    }

    if (bestByEvent["3-3-3"] !== undefined && bestByEvent["3-6-3"] !== undefined && bestByEvent.Cycle !== undefined) {
        nextBestTimes.Overall = {
            time: Math.round((bestByEvent["3-3-3"] + bestByEvent["3-6-3"] + bestByEvent.Cycle) * 1000) / 1000,
            updated_at: now,
            season,
        };
    }

    await usersSnap.docs[0].ref.update({
        best_times: nextBestTimes,
        updated_at: now,
    });
};

const toNumber = (value: unknown): number | null => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    return value;
};

const toStringOrNull = (value: unknown): string | null => {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const toTimestampOrNull = (value: unknown): FirestoreTimestamp | null => {
    if (value instanceof FirestoreTimestamp) {
        return value;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return FirestoreTimestamp.fromDate(value);
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return FirestoreTimestamp.fromDate(parsed);
        }
    }
    return null;
};

const extractMemberIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter((item) => item.length > 0);
};

const deriveEventCategory = (eventType: string | null): string | null => {
    if (!eventType) return null;
    const normalized = eventType.toLowerCase();
    if (normalized === "double") return "double";
    if (normalized === "team relay") return "team_relay";
    if (normalized === "parent & child") return "parent_&_child";
    if (normalized === "special need") return "special_need";
    if (normalized === "stack up champion") return "stack_out_champion";
    if (normalized === "stackout champion") return "stack_out_champion";
    if (normalized === "stack out champion") return "stack_out_champion";
    if (normalized === "blindfolded cycle") return "blindfolded_cycle";
    return "individual";
};

const buildEventKey = (eventType: string | null, code: string | null): string | null => {
    if (code && eventType) {
        return `${code}-${eventType}`;
    }
    return eventType ?? code ?? null;
};

const determineHistoryRole = (globalId: string, leaderId: string | null, memberIds: string[]): HistoryParticipantRole => {
    if (leaderId && globalId === leaderId) {
        return "leader";
    }
    if (memberIds.includes(globalId)) {
        return "member";
    }
    return "participant";
};

const isPrelimResult = (data: Record<string, unknown>): boolean => {
    const classification = toStringOrNull(data.classification)?.toLowerCase();
    if (classification === "prelim") {
        return true;
    }

    const round = toStringOrNull(data.round)?.toLowerCase();
    return round === "prelim";
};

const buildHistoryResult = (
    globalId: string,
    collectionName: string,
    docId: string,
    data: Record<string, unknown>,
): HistoryResult | null => {
    const tournamentId = toStringOrNull(data.tournament_id);
    if (!tournamentId) {
        return null;
    }

    const eventType = toStringOrNull(data.event);
    const code = toStringOrNull(data.code);
    const leaderId = toStringOrNull(data.leader_id);
    const memberIds = extractMemberIds(data.member_global_ids);
    const teamId = toStringOrNull(data.team_id);
    const resultType: HistoryResultType = teamId ? "team" : "individual";
    const participantRole =
        resultType === "team" ? determineHistoryRole(globalId, leaderId, memberIds) : ("participant" as const);

    const classification = toStringOrNull(data.classification);
    const round = toStringOrNull(data.round) ?? (classification === "prelim" ? "prelim" : classification ? "final" : null);
    const bestTime = toNumber(data.best_time) ?? toNumber(data.overall_time);
    const recordPath = `${collectionName}/${docId}`;
    const eventKey = buildEventKey(eventType, code);
    const eventCategory = deriveEventCategory(eventType);
    const submittedAt = toTimestampOrNull(data.submitted_at);
    const verifiedAt = toTimestampOrNull(data.verified_at);
    const createdAt = toTimestampOrNull(data.created_at);
    const updatedAt = toTimestampOrNull(data.updated_at);
    const videoUrl = toStringOrNull(data.video_url);
    const try1 = toNumber(data.try1);
    const try2 = toNumber(data.try2);
    const try3 = toNumber(data.try3);

    return {
        recordPath,
        event: eventType,
        eventKey,
        eventCategory,
        round,
        bestTime,
        try1,
        try2,
        try3,
        status: toStringOrNull(data.status),
        classification,
        resultType,
        participantRole,
        teamContext: resultType === "team" ? {leaderId, memberIds} : null,
        submittedAt,
        verifiedAt,
        createdAt,
        updatedAt,
        videoUrl,
    };
};

const getResultActivityTimestamp = (result: HistoryResult): FirestoreTimestamp | null =>
    result.updatedAt ?? result.createdAt ?? result.submittedAt ?? result.verifiedAt ?? null;

const getMaxTimestamp = (values: Array<FirestoreTimestamp | null>): FirestoreTimestamp | null => {
    let maxValue: FirestoreTimestamp | null = null;
    for (const value of values) {
        if (!value) continue;
        if (!maxValue || value.toMillis() > maxValue.toMillis()) {
            maxValue = value;
        }
    }
    return maxValue;
};

const syncUserTournamentHistoryByGlobalId = async (rawGlobalId: string): Promise<void> => {
    const globalId = rawGlobalId.trim();
    if (!globalId) {
        return;
    }

    const usersSnap = await db.collection("users").where("global_id", "==", globalId).limit(1).get();
    if (usersSnap.empty) {
        return;
    }

    const userDoc = usersSnap.docs[0];
    const userData = userDoc.data();
    const userId = typeof userData.id === "string" && userData.id.length > 0 ? userData.id : userDoc.id;

    const historyDocRef = db.collection("user_tournament_history").doc(globalId);
    const deduped = new Map<string, {collectionName: string; docId: string; data: Record<string, unknown>}>();

    const addSnapshotDocs = (collectionName: string, docs: Array<{id: string; data: () => Record<string, unknown>}>) => {
        for (const docSnap of docs) {
            const key = `${collectionName}/${docSnap.id}`;
            deduped.set(key, {
                collectionName,
                docId: docSnap.id,
                data: docSnap.data() as Record<string, unknown>,
            });
        }
    };

    const [
        recordsByParticipant,
        prelimByParticipant,
        overallByParticipant,
        recordsByLeader,
        prelimByLeader,
        recordsByMember,
        prelimByMember,
    ] = await Promise.all([
        db.collection("records").where("participant_global_id", "==", globalId).get(),
        db.collection("prelim_records").where("participant_global_id", "==", globalId).get(),
        db.collection("overall_records").where("participant_global_id", "==", globalId).get(),
        db.collection("records").where("leader_id", "==", globalId).get(),
        db.collection("prelim_records").where("leader_id", "==", globalId).get(),
        db.collection("records").where("member_global_ids", "array-contains", globalId).get(),
        db.collection("prelim_records").where("member_global_ids", "array-contains", globalId).get(),
    ]);

    addSnapshotDocs("records", recordsByParticipant.docs);
    addSnapshotDocs("prelim_records", prelimByParticipant.docs);
    addSnapshotDocs("overall_records", overallByParticipant.docs);
    addSnapshotDocs("records", recordsByLeader.docs);
    addSnapshotDocs("prelim_records", prelimByLeader.docs);
    addSnapshotDocs("records", recordsByMember.docs);
    addSnapshotDocs("prelim_records", prelimByMember.docs);

    const groupedByTournament = new Map<string, HistoryResult[]>();
    for (const item of deduped.values()) {
        const tournamentId = toStringOrNull(item.data.tournament_id);
        if (!tournamentId) {
            continue;
        }
        const result = buildHistoryResult(globalId, item.collectionName, item.docId, item.data);
        if (!result) {
            continue;
        }
        const existing = groupedByTournament.get(tournamentId) ?? [];
        existing.push(result);
        groupedByTournament.set(tournamentId, existing);
    }

    const tournamentCache = new Map<string, Record<string, unknown>>();
    const tournamentSummaries: HistoryTournamentSummary[] = [];
    for (const [tournamentId, results] of groupedByTournament.entries()) {
        let tournamentRaw = tournamentCache.get(tournamentId);
        if (!tournamentRaw) {
            const tournamentSnap = await db.collection("tournaments").doc(tournamentId).get();
            tournamentRaw = tournamentSnap.exists ? (tournamentSnap.data() as Record<string, unknown>) : {};
            tournamentCache.set(tournamentId, tournamentRaw);
        }

        const normalizedResults = results.sort((a, b) => {
            const aTime = getResultActivityTimestamp(a)?.toMillis() ?? 0;
            const bTime = getResultActivityTimestamp(b)?.toMillis() ?? 0;
            return bTime - aTime;
        });

        const lastActivityAt = getMaxTimestamp(normalizedResults.map((result) => getResultActivityTimestamp(result)));
        const countryRaw = tournamentRaw?.country;
        const country =
            Array.isArray(countryRaw) && typeof countryRaw[0] === "string"
                ? (countryRaw[0] as string)
                : toStringOrNull(countryRaw);

        tournamentSummaries.push({
            tournamentId,
            tournamentName: toStringOrNull(tournamentRaw?.name),
            startDate: toTimestampOrNull(tournamentRaw?.start_date),
            endDate: toTimestampOrNull(tournamentRaw?.end_date),
            country,
            venue: toStringOrNull(tournamentRaw?.venue),
            lastActivityAt,
            results: normalizedResults,
        });
    }

    tournamentSummaries.sort((a, b) => {
        const aTime = a.lastActivityAt?.toMillis() ?? 0;
        const bTime = b.lastActivityAt?.toMillis() ?? 0;
        return bTime - aTime;
    });

    const recordCount = tournamentSummaries.reduce((sum, summary) => sum + summary.results.length, 0);
    const payload: UserTournamentHistoryPayload = {
        globalId,
        userId,
        updatedAt: FirestoreTimestamp.now(),
        tournamentCount: tournamentSummaries.length,
        recordCount,
        tournaments: tournamentSummaries,
    };

    await historyDocRef.set(payload, {merge: true});
};

const collectAffectedGlobalIds = (data: Record<string, unknown>): string[] => {
    const ids = new Set<string>();

    const participantGlobalId = toStringOrNull(data.participant_global_id);
    if (participantGlobalId) {
        ids.add(participantGlobalId);
    }

    const leaderId = toStringOrNull(data.leader_id);
    if (leaderId) {
        ids.add(leaderId);
    }

    for (const memberId of extractMemberIds(data.member_global_ids)) {
        ids.add(memberId);
    }

    return Array.from(ids);
};

/**
 * Send email using AWS SES SMTP as a backup when Resend fails
 */
async function sendEmailViaSES(
    to: string,
    subject: string,
    htmlBody: string,
    username: string,
    password: string,
): Promise<{success: boolean; messageId?: string; error?: string}> {
    try {
        // Create SMTP transporter for AWS SES
        const transporter = nodemailer.createTransport({
            host: `email-smtp.${AWS_SES_REGION}.amazonaws.com`,
            port: 587,
            secure: false, // Use STARTTLS
            auth: {
                user: username,
                pass: password,
            },
        });

        // Send email
        const info = await transporter.sendMail({
            from: AWS_SES_FROM_EMAIL,
            to: to,
            subject: subject,
            html: htmlBody,
        });

        return {success: true, messageId: info.messageId};
    } catch (error) {
        console.error("❌ AWS SES SMTP send failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown AWS SES error",
        };
    }
}

type EmailDeliveryResult = {
    success: boolean;
    provider?: "resend" | "aws-ses";
    messageId?: string;
    error?: string;
};

type VerificationRequestData = {
    target_global_id: string;
    member_id: string;
    tournament_id: string;
    team_id: string;
    registration_id: string;
    status: "pending" | "verified" | "expired" | "rejected";
    event_label?: string | null;
    team_name?: string | null;
    leader_label?: string | null;
    email_status?: "pending" | "sending" | "accepted" | "failed" | "skipped";
};

type UserNotificationData = {
    target_global_id: string;
    type: "team_invitation_rejected";
    status: "unread" | "read";
    title: string;
    message: string;
    tournament_id?: string | null;
    team_id?: string | null;
    actor_global_id?: string | null;
    action_url?: string | null;
    email_status?: "pending" | "sending" | "accepted" | "failed" | "skipped";
};

const sendHtmlEmail = async (to: string, subject: string, html: string): Promise<EmailDeliveryResult> => {
    try {
        const resendResponse = await fetch(RESEND_API_URL, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${RESEND_API_KEY.value()}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                from: RESEND_FROM_EMAIL,
                to: [to],
                subject,
                html,
            }),
        });
        const payload = (await resendResponse.json().catch(() => undefined)) as
            | {id?: string; error?: {message?: string} | string}
            | undefined;
        if (resendResponse.ok) {
            return {success: true, provider: "resend", messageId: payload?.id};
        }

        const resendError =
            typeof payload?.error === "string"
                ? payload.error
                : payload?.error?.message || `Resend failed with status ${resendResponse.status}`;
        console.error("Resend email failed; trying AWS SES", resendError);
    } catch (error) {
        console.error("Resend email threw; trying AWS SES", error);
    }

    const sesResult = await sendEmailViaSES(
        to,
        subject,
        html,
        AWS_SES_SMTP_USERNAME.value(),
        AWS_SES_SMTP_PASSWORD.value(),
    );
    if (sesResult.success) {
        return {success: true, provider: "aws-ses", messageId: sesResult.messageId};
    }
    return {success: false, error: sesResult.error || "Both email providers failed."};
};

const resolveProfileEmail = async (globalId: string): Promise<string | null> => {
    const snapshot = await db.collection("users").where("global_id", "==", globalId).get();
    if (snapshot.empty) {
        return null;
    }

    const candidates = snapshot.docs
        .map((docSnapshot) => docSnapshot.data() as {email?: string | null; primary_owner_email?: string | null})
        .map((data) => data.email?.trim() || data.primary_owner_email?.trim() || "")
        .filter(Boolean);
    return candidates[0] ?? null;
};

const claimEmailDelivery = async (
    ref: DocumentReference,
    allowedStatus: string,
): Promise<Record<string, unknown> | null> =>
    db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) {
            return null;
        }
        const data = snapshot.data() as Record<string, unknown>;
        if (data.status !== allowedStatus) {
            return null;
        }
        const emailStatus = data.email_status;
        if (emailStatus === "sending" || emailStatus === "accepted" || emailStatus === "skipped") {
            return null;
        }
        transaction.set(
            ref,
            {
                email_status: "sending",
                email_error: FieldValue.delete(),
                email_updated_at: FirestoreTimestamp.now(),
            },
            {merge: true},
        );
        return data;
    });

const buildVerificationEmailHtml = (data: VerificationRequestData): string => {
    const detailItems = [
        data.event_label ? `<li><strong>Event:</strong> ${escapeHtml(data.event_label)}</li>` : "",
        data.team_name ? `<li><strong>Team:</strong> ${escapeHtml(data.team_name)}</li>` : "",
        data.leader_label ? `<li><strong>Invited by:</strong> ${escapeHtml(data.leader_label)}</li>` : "",
    ].filter(Boolean);
    const detailList = detailItems.length > 0 ? `<p>Verification details:</p><ul>${detailItems.join("")}</ul>` : "";
    const verifyUrl = `https://rankingstack.com/verify?tournamentId=${encodeURIComponent(
        data.tournament_id,
    )}&teamId=${encodeURIComponent(data.team_id)}&memberId=${encodeURIComponent(
        data.member_id,
    )}&registrationId=${encodeURIComponent(data.registration_id)}`;

    return `
        <p>Hello,</p>
        <p>Please verify your team membership for the <strong>RankingStack</strong> competition.</p>
        ${detailList}
        <p><a href="${verifyUrl.replace(/&/g, "&amp;")}" style="padding:10px 16px;background:#165DFF;color:white;text-decoration:none;border-radius:6px;font-weight:500;">Verify My Participation</a></p>
        <p>If you did not expect this email, you can reject the invitation from your RankingStack account.</p>
    `;
};

const deliverVerificationRequestEmail = async (
    requestRef: DocumentReference,
    recipientOverride?: string,
): Promise<EmailDeliveryResult> => {
    const claimed = await claimEmailDelivery(requestRef, "pending");
    if (!claimed) {
        return {success: true};
    }
    const data = claimed as VerificationRequestData;
    const email = recipientOverride?.trim() || (await resolveProfileEmail(data.target_global_id));
    if (!email) {
        await requestRef.set(
            {email_status: "skipped", email_error: "Recipient email is missing.", email_updated_at: FirestoreTimestamp.now()},
            {merge: true},
        );
        return {success: true};
    }

    const result = await sendHtmlEmail(email, "Please verify your competition registration", buildVerificationEmailHtml(data));
    await requestRef.set(
        result.success
            ? {
                  email_status: "accepted",
                  email_provider: result.provider ?? null,
                  email_message_id: result.messageId ?? null,
                  email_accepted_at: FirestoreTimestamp.now(),
                  email_updated_at: FirestoreTimestamp.now(),
              }
            : {
                  email_status: "failed",
                  email_error: result.error ?? "Email delivery failed.",
                  email_updated_at: FirestoreTimestamp.now(),
              },
        {merge: true},
    );
    return result;
};

const deliverUserNotificationEmail = async (notificationRef: DocumentReference): Promise<EmailDeliveryResult> => {
    const claimed = await claimEmailDelivery(notificationRef, "unread");
    if (!claimed) {
        return {success: true};
    }
    const data = claimed as UserNotificationData;
    const email = await resolveProfileEmail(data.target_global_id);
    if (!email) {
        await notificationRef.set(
            {email_status: "skipped", email_error: "Recipient email is missing.", email_updated_at: FirestoreTimestamp.now()},
            {merge: true},
        );
        return {success: true};
    }

    const actionUrl = data.action_url
        ? `<p><a href="${escapeHtml(data.action_url)}" style="padding:10px 16px;background:#165DFF;color:white;text-decoration:none;border-radius:6px;font-weight:500;">Open Registration</a></p>`
        : "";
    const result = await sendHtmlEmail(
        email,
        data.title,
        `<p>Hello,</p><p>${escapeHtml(data.message)}</p>${actionUrl}<p>Please sign in to RankingStack for details.</p>`,
    );
    await notificationRef.set(
        result.success
            ? {
                  email_status: "accepted",
                  email_provider: result.provider ?? null,
                  email_message_id: result.messageId ?? null,
                  email_accepted_at: FirestoreTimestamp.now(),
                  email_updated_at: FirestoreTimestamp.now(),
              }
            : {
                  email_status: "failed",
                  email_error: result.error ?? "Email delivery failed.",
                  email_updated_at: FirestoreTimestamp.now(),
              },
        {merge: true},
    );
    return result;
};

const PASSWORD_RESET_EMAIL_THROTTLE_MS = 60 * 1000;

async function enforcePasswordResetEmailThrottle(email: string): Promise<void> {
    const throttleRef = db.collection("passwordResetEmailThrottle").doc(encodeURIComponent(email));
    const nowMs = Date.now();

    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(throttleRef);
        const lastAttempt = snapshot.get("lastAttemptAt") as FirestoreTimestamp | undefined;
        const lastAttemptMs = lastAttempt?.toMillis() ?? 0;

        if (nowMs - lastAttemptMs < PASSWORD_RESET_EMAIL_THROTTLE_MS) {
            throw new HttpsError("resource-exhausted", "Too many password reset requests. Please wait before trying again.");
        }

        transaction.set(
            throttleRef,
            {
                email,
                lastAttemptAt: FirestoreTimestamp.now(),
            },
            {merge: true},
        );
    });
}

export const sendPasswordResetEmailWithCustomEmail = onCall(
    {
        ...callableFunctionOptions,
        secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD],
    },
    async (request) => {
        const email = normalizeEmail(request.data?.email);
        if (!email) {
            throw new HttpsError("invalid-argument", "Email is required.");
        }

        await enforcePasswordResetEmailThrottle(email);

        try {
            const resetLink = await getAuth().generatePasswordResetLink(email, {
                url: PASSWORD_RESET_CONTINUE_URL,
            });
            const subject = "Reset your password for Sport Stacking Website";
            const html = buildPasswordResetEmailHtml(resetLink, email);
            const resendResponse = await fetch(RESEND_API_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${RESEND_API_KEY.value()}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: RESEND_FROM_EMAIL,
                    to: [email],
                    subject,
                    html,
                }),
            });

            if (!resendResponse.ok) {
                const payload = await resendResponse.text().catch(() => "");
                console.error("Resend password reset email failed", resendResponse.status, payload);
                const sesResult = await sendEmailViaSES(
                    email,
                    subject,
                    html,
                    AWS_SES_SMTP_USERNAME.value(),
                    AWS_SES_SMTP_PASSWORD.value(),
                );

                if (!sesResult.success) {
                    console.error("AWS SES password reset email failed", sesResult.error);
                    throw new HttpsError("internal", "Failed to send password reset email.");
                }
            }
        } catch (error: unknown) {
            const authError = error as {code?: string; message?: string};
            if (authError.code === "auth/user-not-found") {
                console.info("Password reset requested for unknown email address.");
                return {success: true};
            }

            if (error instanceof HttpsError) {
                throw error;
            }

            console.error("Password reset email failed", error);
            throw new HttpsError("internal", "Failed to send password reset email.");
        }

        return {success: true};
    },
);

export const sendEmail = onRequest({secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD]}, (req, res) => {
    corsHandler(req, res, async () => {
        const auth = getAuth();

        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            res.status(401).json({error: "Missing or invalid Authorization header"});
            return;
        }

        const idToken = authHeader.split("Bearer ")[1];

        try {
            await auth.verifyIdToken(idToken);
        } catch (err) {
            console.error("❌ Token verification failed", err);
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        const {to, tournamentId, teamId, memberId, registrationId} = req.body;
        if (!tournamentId || !teamId || !memberId || !registrationId) {
            res.status(400).json({error: "Missing required fields"});
            return;
        }

        const teamSnap = await db.collection("teams").doc(teamId).get();
        const teamData = teamSnap.exists ? (teamSnap.data() as Team) : null;
        const teamEventReferences = teamData ? getTeamEventReferences(teamData) : [];
        const eventLabels = teamData ? await resolveEventLabels(tournamentId, teamEventReferences) : [];
        const eventLabel = eventLabels.length > 0 ? eventLabels.join(", ") : (teamEventReferences[0] ?? "");
        const teamName = teamData?.name ?? "";
        const leaderId = teamData?.leader_id ?? "";
        const leaderName = leaderId ? await resolveLeaderName(leaderId) : null;
        const leaderLabel = leaderName ? `${leaderName} (${leaderId})` : leaderId;

        const verificationRequestId = buildVerificationRequestId(tournamentId, teamId, memberId);
        const verificationRequestRef = db.collection("verification_requests").doc(verificationRequestId);
        const verificationRequestSnapshot = await verificationRequestRef.get();
        const now = FirestoreTimestamp.now();
        const verificationPayload = {
            target_global_id: memberId,
            member_id: memberId,
            tournament_id: tournamentId,
            team_id: teamId,
            registration_id: registrationId,
            status: "pending",
            event_label: eventLabel || null,
            team_name: teamName || null,
            leader_label: leaderLabel || null,
            updated_at: now,
            ...(verificationRequestSnapshot.exists ? {} : {created_at: now, email_status: "pending"}),
        };
        await verificationRequestRef.set(verificationPayload, {merge: true});
        const delivery = await deliverVerificationRequestEmail(
            verificationRequestRef,
            typeof to === "string" ? to : undefined,
        );
        if (!delivery.success) {
            res.status(500).json({error: delivery.error || "Email delivery failed"});
            return;
        }
        res.status(200).json({success: true, id: delivery.messageId, provider: delivery.provider});
    });
});

export const syncTeamVerificationRequests = onDocumentWritten(
    {
        document: "teams/{teamId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: true,
    },
    async (event) => {
        const teamId = event.params.teamId;
        const beforeTeam = event.data?.before.exists ? (event.data.before.data() as Team) : null;
        const afterTeam = event.data?.after.exists ? (event.data.after.data() as Team) : null;
        const beforeMembers = new Map((beforeTeam?.members ?? []).map((member) => [member.global_id, member]));
        const afterMembers = new Map((afterTeam?.members ?? []).map((member) => [member.global_id, member]));
        const tournamentId = afterTeam?.tournament_id ?? beforeTeam?.tournament_id ?? "";

        await syncRegistrationTeamSnapshots(teamId, beforeTeam, afterTeam);

        for (const [memberId] of beforeMembers) {
            if (afterMembers.has(memberId) || !tournamentId) {
                continue;
            }
            const requestRef = db
                .collection("verification_requests")
                .doc(buildVerificationRequestId(tournamentId, teamId, memberId));
            const requestSnapshot = await requestRef.get();
            if (requestSnapshot.exists && requestSnapshot.data()?.status === "pending") {
                await requestRef.set(
                    {status: "expired", updated_at: FirestoreTimestamp.now(), expired_at: FirestoreTimestamp.now()},
                    {merge: true},
                );
            }
        }

        if (!afterTeam || !tournamentId) {
            return;
        }

        const eventReferences = getTeamEventReferences(afterTeam);
        const eventLabels = await resolveEventLabels(tournamentId, eventReferences);
        const eventLabel = eventLabels.length > 0 ? eventLabels.join(", ") : (eventReferences[0] ?? "");
        const leaderId = afterTeam.leader_id ?? "";
        const leaderName = leaderId ? await resolveLeaderName(leaderId) : null;
        const leaderLabel = leaderName ? `${leaderName} (${leaderId})` : leaderId;

        for (const [memberId, member] of afterMembers) {
            const requestRef = db
                .collection("verification_requests")
                .doc(buildVerificationRequestId(tournamentId, teamId, memberId));
            const requestSnapshot = await requestRef.get();
            const requestData = requestSnapshot.data() as VerificationRequestData | undefined;

            if (member.verified) {
                if (requestSnapshot.exists && requestData?.status === "pending") {
                    await requestRef.set(
                        {status: "verified", verified_at: FirestoreTimestamp.now(), updated_at: FirestoreTimestamp.now()},
                        {merge: true},
                    );
                }
                continue;
            }

            const wasMember = beforeMembers.has(memberId);
            const shouldCreate = !requestSnapshot.exists || (!wasMember && requestData?.status !== "pending");
            if (!shouldCreate && requestData?.status !== "pending") {
                continue;
            }
            const now = FirestoreTimestamp.now();
            await requestRef.set(
                {
                    target_global_id: memberId,
                    member_id: memberId,
                    tournament_id: tournamentId,
                    team_id: teamId,
                    registration_id: afterTeam.registration_id,
                    status: "pending",
                    event_label: eventLabel || null,
                    team_name: afterTeam.name || null,
                    leader_label: leaderLabel || null,
                    updated_at: now,
                    ...(shouldCreate ? {created_at: now, email_status: "pending"} : {}),
                },
                {merge: true},
            );
        }
    },
);

export const deliverVerificationRequestEmails = onDocumentWritten(
    {
        document: "verification_requests/{requestId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
        secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD],
    },
    async (event) => {
        if (!event.data?.after.exists) {
            return;
        }
        const after = event.data.after.data() as VerificationRequestData;
        const before = event.data.before.exists ? (event.data.before.data() as VerificationRequestData) : null;
        const becamePending = before?.status !== "pending" && after.status === "pending";
        const emailBecamePending = before?.email_status !== "pending" && after.email_status === "pending";
        if (after.status !== "pending" || (!becamePending && !emailBecamePending && after.email_status !== undefined)) {
            return;
        }
        await deliverVerificationRequestEmail(event.data.after.ref);
    },
);

export const deliverUserNotificationEmails = onDocumentWritten(
    {
        document: "notifications/{notificationId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
        secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD],
    },
    async (event) => {
        if (!event.data?.after.exists) {
            return;
        }
        const after = event.data.after.data() as UserNotificationData;
        const before = event.data.before.exists ? (event.data.before.data() as UserNotificationData) : null;
        const becameUnread = before?.status !== "unread" && after.status === "unread";
        const emailBecamePending = before?.email_status !== "pending" && after.email_status === "pending";
        if (after.status !== "unread" || (!becameUnread && !emailBecamePending && after.email_status !== undefined)) {
            return;
        }
        await deliverUserNotificationEmail(event.data.after.ref);
    },
);

export const rejectTeamInvitation = onCall(callableFunctionOptions, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Sign in to reject an invitation.");
    }
    const requestId = typeof request.data?.requestId === "string" ? request.data.requestId.trim() : "";
    if (!requestId) {
        throw new HttpsError("invalid-argument", "Request ID is required.");
    }

    const requestRef = db.collection("verification_requests").doc(requestId);
    const initialRequestSnapshot = await requestRef.get();
    if (!initialRequestSnapshot.exists) {
        throw new HttpsError("not-found", "Invitation not found.");
    }
    const initialRequest = initialRequestSnapshot.data() as VerificationRequestData;
    const memberProfiles = await db.collection("users").where("global_id", "==", initialRequest.member_id).get();
    const ownsMember = memberProfiles.docs.some((docSnapshot) => {
        const data = docSnapshot.data() as {id?: string; owner_uids?: string[] | null};
        return (
            docSnapshot.id === request.auth?.uid ||
            data.id === request.auth?.uid ||
            (Array.isArray(data.owner_uids) && data.owner_uids.includes(request.auth?.uid ?? ""))
        );
    });
    if (!ownsMember) {
        throw new HttpsError("permission-denied", "You can only reject your own invitation.");
    }

    const teamRef = db.collection("teams").doc(initialRequest.team_id);
    const actorName = await resolveLeaderName(initialRequest.member_id);
    const result = await db.runTransaction(async (transaction) => {
        const [freshRequestSnapshot, teamSnapshot] = await Promise.all([
            transaction.get(requestRef),
            transaction.get(teamRef),
        ]);
        if (!freshRequestSnapshot.exists) {
            throw new HttpsError("not-found", "Invitation not found.");
        }
        const freshRequest = freshRequestSnapshot.data() as VerificationRequestData;
        if (freshRequest.status !== "pending") {
            throw new HttpsError("failed-precondition", "Only pending invitations can be rejected.");
        }
        if (!teamSnapshot.exists) {
            transaction.set(
                requestRef,
                {
                    status: "expired",
                    expired_at: FirestoreTimestamp.now(),
                    updated_at: FirestoreTimestamp.now(),
                },
                {merge: true},
            );
            return {teamDeleted: false, leaderId: ""};
        }

        const team = teamSnapshot.data() as Team;
        const member = (team.members ?? []).find((candidate) => candidate.global_id === freshRequest.member_id);
        if (!member) {
            throw new HttpsError("failed-precondition", "You are no longer a member of this team.");
        }
        if (member.verified) {
            throw new HttpsError("failed-precondition", "Verified membership cannot be rejected.");
        }

        const remainingMembers = (team.members ?? []).filter((candidate) => candidate.global_id !== freshRequest.member_id);
        const teamDeleted = remainingMembers.length === 0;
        if (teamDeleted) {
            transaction.delete(teamRef);
        } else {
            transaction.update(teamRef, {members: remainingMembers, updated_at: FirestoreTimestamp.now()});
        }

        const now = FirestoreTimestamp.now();
        transaction.set(
            requestRef,
            {
                status: "rejected",
                rejected_at: now,
                rejected_by: request.auth?.uid,
                updated_at: now,
            },
            {merge: true},
        );

        const notificationRef = db.collection("notifications").doc(`team-invitation-rejected-${requestId}`);
        const actorLabel = actorName ? `${actorName} (${freshRequest.member_id})` : freshRequest.member_id;
        transaction.set(
            notificationRef,
            {
                target_global_id: team.leader_id,
                type: "team_invitation_rejected",
                status: "unread",
                title: "Team invitation declined",
                message: `${actorLabel} declined the invitation for ${freshRequest.event_label || "a team event"}.`,
                tournament_id: freshRequest.tournament_id,
                team_id: freshRequest.team_id,
                actor_global_id: freshRequest.member_id,
                action_url: `https://rankingstack.com/tournaments/${encodeURIComponent(freshRequest.tournament_id)}`,
                email_status: "pending",
                created_at: now,
                updated_at: now,
            },
            {merge: true},
        );
        return {teamDeleted, leaderId: team.leader_id};
    });

    if (result.teamDeleted) {
        const recruitmentSnapshot = await db.collection("team_recruitment").where("team_id", "==", initialRequest.team_id).get();
        await Promise.all(recruitmentSnapshot.docs.map((docSnapshot) => docSnapshot.ref.delete()));
    }

    return {success: true, status: "rejected", ...result};
});

type AdminTeamMutationInput = {
    action?: "upsert" | "add-member" | "delete";
    tournamentId?: unknown;
    teamId?: unknown;
    memberId?: unknown;
    team?: Partial<Team>;
};

const normalizeAdminGlobalId = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const registrationEventsWith = (events: unknown, eventKeys: string[]): string[] =>
    Array.from(
        new Set([
            ...(Array.isArray(events) ? events.filter((event): event is string => typeof event === "string") : []),
            ...eventKeys,
        ]),
    );

const registrationEventsWithout = (events: unknown, eventKeys: string[]): string[] => {
    const eventKeySet = new Set(eventKeys.map((eventKey) => normalizeEventValue(eventKey)));
    return (Array.isArray(events) ? events : []).filter(
        (event): event is string => typeof event === "string" && !eventKeySet.has(normalizeEventValue(event)),
    );
};

const teamParticipantIds = (team: Team): string[] =>
    Array.from(
        new Set(
            [team.leader_id, ...(team.members ?? []).filter((member) => member.verified).map((member) => member.global_id)]
                .map((participantId) => normalizeAdminGlobalId(participantId))
                .filter(Boolean),
        ),
    );

const teamContainsConfirmedParticipant = (team: Team, participantId: string): boolean =>
    normalizeAdminGlobalId(team.leader_id) === participantId ||
    (team.members ?? []).some(
        (member) => normalizeAdminGlobalId(member.global_id) === participantId && member.verified === true,
    );

const hasSameConfirmedTeam = (left: Team, right: Team): boolean => {
    const leftParticipants = teamParticipantIds(left).sort();
    const rightParticipants = teamParticipantIds(right).sort();
    return (
        hasEventOverlap(
            buildNormalizedEventSet(getTeamEventReferences(left)),
            buildNormalizedEventSet(getTeamEventReferences(right)),
        ) &&
        leftParticipants.length === rightParticipants.length &&
        leftParticipants.every((participantId, index) => participantId === rightParticipants[index])
    );
};

const findUserDocumentForTournament = (
    userSnapshot: {docs: QueryDocumentSnapshot[]},
    tournamentId: string,
) =>
    userSnapshot.docs.find((userDoc) =>
        ((userDoc.data() as {registration_records?: UserRegistrationRecord[]}).registration_records ?? []).some(
            (record) => record.tournament_id === tournamentId,
        ),
    );

/**
 * The only admin path for creating, editing, directly confirming, or removing team members.
 * It keeps teams, registrations, and user registration records consistent in one transaction.
 */
export const mutateAdminTeam = onCall(callableFunctionOptions, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const input = request.data as AdminTeamMutationInput;
    const tournamentId = normalizeAdminGlobalId(input.tournamentId);
    const action = input.action ?? "upsert";
    const requestedTeamId = normalizeAdminGlobalId(input.teamId);
    if (!tournamentId) {
        throw new HttpsError("invalid-argument", "Tournament ID is required.");
    }
    if (!(await importIsAuthorized(request.auth.uid, tournamentId))) {
        throw new HttpsError("permission-denied", "You do not have permission to manage this tournament.");
    }
    if ((action === "add-member" || action === "delete") && !requestedTeamId) {
        throw new HttpsError("invalid-argument", "Team ID is required.");
    }

    return db.runTransaction(async (transaction) => {
        const existingTeamRef = requestedTeamId ? db.collection("teams").doc(requestedTeamId) : null;
        const existingTeamSnap = existingTeamRef ? await transaction.get(existingTeamRef) : null;
        if (existingTeamRef && !existingTeamSnap?.exists) {
            throw new HttpsError("not-found", "Team not found.");
        }
        const existingTeam = existingTeamSnap?.exists ? (existingTeamSnap.data() as Team) : null;
        if (existingTeam && existingTeam.tournament_id !== tournamentId) {
            throw new HttpsError("failed-precondition", "Team does not belong to this tournament.");
        }

        if (action === "delete") {
            if (!existingTeamRef || !existingTeam) {
                throw new HttpsError("not-found", "Team not found.");
            }
            const eventKeys = getPreferredTeamEventKeys(existingTeam, getTeamEventReferences(existingTeam));
            const previousParticipantIds = existingTeam ? teamParticipantIds(existingTeam) : [];
            const allTeamsSnapshot = await transaction.get(db.collection("teams").where("tournament_id", "==", tournamentId));
            const participantSnapshots = await Promise.all(
                previousParticipantIds.map(async (participantId) => {
                    const [registrationSnapshot, userSnapshot] = await Promise.all([
                        transaction.get(
                            db.collection("registrations").where("tournament_id", "==", tournamentId).where("user_global_id", "==", participantId),
                        ),
                        transaction.get(db.collection("users").where("global_id", "==", participantId)),
                    ]);
                    return {participantId, registrationSnapshot, userSnapshot};
                }),
            );

            for (const {participantId, registrationSnapshot, userSnapshot} of participantSnapshots) {
                const belongsToAnotherTeam = allTeamsSnapshot.docs.some((teamSnapshot) => {
                    if (teamSnapshot.id === existingTeamRef?.id) return false;
                    const candidate = teamSnapshot.data() as Team;
                    return (
                        teamContainsConfirmedParticipant(candidate, participantId) &&
                        hasEventOverlap(
                            buildNormalizedEventSet(getTeamEventReferences(candidate)),
                            buildNormalizedEventSet(getTeamEventReferences(existingTeam)),
                        )
                    );
                });
                if (belongsToAnotherTeam) continue;

                const registrationRef = registrationSnapshot.docs[0]?.ref;
                if (registrationRef) {
                    transaction.update(registrationRef, {
                        events_registered: registrationEventsWithout(registrationSnapshot.docs[0].data().events_registered, eventKeys),
                        updated_at: FirestoreTimestamp.now(),
                    });
                }
                const userDoc = findUserDocumentForTournament(userSnapshot, tournamentId);
                if (userDoc) {
                    const userData = userDoc.data() as {registration_records?: UserRegistrationRecord[]};
                    const registrationRecords = userData.registration_records ?? [];
                    transaction.update(userDoc.ref, {
                        registration_records: registrationRecords.map((record) =>
                            record.tournament_id === tournamentId
                                ? {...record, events: registrationEventsWithout(record.events, eventKeys), updated_at: FirestoreTimestamp.now()}
                                : record,
                        ),
                        updated_at: FirestoreTimestamp.now(),
                    });
                }
            }
            transaction.delete(existingTeamRef);
            return {teamId: requestedTeamId, deleted: true};
        }

        const rawTeam = input.team;
        let nextTeam: Team;
        if (action === "add-member") {
            if (!existingTeam) {
                throw new HttpsError("not-found", "Team not found.");
            }
            const memberId = normalizeAdminGlobalId(input.memberId);
            if (!memberId) {
                throw new HttpsError("invalid-argument", "Member Global ID is required.");
            }
            if (teamContainsConfirmedParticipant(existingTeam, memberId) || (existingTeam.members ?? []).some((member) => member.global_id === memberId)) {
                throw new HttpsError("already-exists", "Member is already in this team.");
            }
            nextTeam = {
                ...existingTeam,
                members: [...(existingTeam.members ?? []), {global_id: memberId, verified: true}],
            };
        } else {
            if (!rawTeam) {
                throw new HttpsError("invalid-argument", "Team data is required.");
            }
            const leaderId = normalizeAdminGlobalId(rawTeam.leader_id);
            const rawMembers = (rawTeam.members ?? [])
                .map((member) => ({
                    globalId: normalizeAdminGlobalId(member.global_id),
                    verified: member.verified === true,
                }))
                .filter((member) => Boolean(member.globalId));
            const memberIds = rawMembers.map((member) => member.globalId);
            const nextTeamId =
                normalizeAdminGlobalId(existingTeam?.id) ||
                requestedTeamId ||
                normalizeAdminGlobalId(rawTeam.id) ||
                db.collection("teams").doc().id;
            if (!leaderId || memberIds.length !== new Set(memberIds).size || memberIds.includes(leaderId)) {
                throw new HttpsError("invalid-argument", "Team members must be unique and cannot include the leader.");
            }
            nextTeam = {
                ...(existingTeam ?? {}),
                ...rawTeam,
                id: nextTeamId,
                tournament_id: tournamentId,
                name: typeof rawTeam.name === "string" ? rawTeam.name : "",
                leader_id: leaderId,
                registration_id: typeof rawTeam.registration_id === "string" ? rawTeam.registration_id : "",
                event_id: typeof rawTeam.event_id === "string" ? rawTeam.event_id : null,
                event: Array.isArray(rawTeam.event) ? rawTeam.event.filter((event): event is string => typeof event === "string") : [],
                // Editing a team must retain pending invitations. Only explicitly
                // confirmed members participate in registration validation below.
                members: rawMembers.map(({globalId, verified}) => ({
                    global_id: globalId,
                    verified: existingTeam?.members?.find((member) => member.global_id === globalId)?.verified === true || verified,
                })),
                team_age: typeof rawTeam.team_age === "number" ? rawTeam.team_age : 0,
                looking_for_member: rawTeam.looking_for_member === true,
            };
        }

        const teamRef = existingTeamRef ?? db.collection("teams").doc(nextTeam.id);
        const eventKeys = getPreferredTeamEventKeys(nextTeam, getTeamEventReferences(nextTeam));
        if (eventKeys.length === 0) {
            throw new HttpsError("invalid-argument", "Team event is required.");
        }
        const confirmedParticipantIds = teamParticipantIds(nextTeam);
        const previousConfirmedParticipantIds = existingTeam ? teamParticipantIds(existingTeam) : [];
        const allTeamsSnapshot = await transaction.get(db.collection("teams").where("tournament_id", "==", tournamentId));
        const duplicateTeam = allTeamsSnapshot.docs.find(
            (teamSnapshot) => teamSnapshot.id !== teamRef.id && hasSameConfirmedTeam(teamSnapshot.data() as Team, nextTeam),
        );
        if (duplicateTeam) {
            throw new HttpsError("already-exists", "These participants are already registered as a team for this event.");
        }
        const participantSnapshots = await Promise.all(
            confirmedParticipantIds.map(async (participantId) => {
                const [registrationSnapshot, userSnapshot] = await Promise.all([
                    transaction.get(
                        db.collection("registrations").where("tournament_id", "==", tournamentId).where("user_global_id", "==", participantId),
                    ),
                    transaction.get(db.collection("users").where("global_id", "==", participantId)),
                ]);
                return {participantId, registrationSnapshot, userSnapshot};
            }),
        );
        const invalidParticipantIds = participantSnapshots
            .filter(({registrationSnapshot, userSnapshot}) => registrationSnapshot.empty || userSnapshot.empty)
            .map(({participantId}) => participantId);
        const missingRegistrationRecordIds = participantSnapshots
            .filter(({userSnapshot}) => {
                return !findUserDocumentForTournament(userSnapshot, tournamentId);
            })
            .map(({participantId}) => participantId);
        if (invalidParticipantIds.length > 0 || missingRegistrationRecordIds.length > 0) {
            throw new HttpsError(
                "failed-precondition",
                `Each member must be registered for this tournament. Invalid: ${[...new Set([...invalidParticipantIds, ...missingRegistrationRecordIds])].join(", ")}`,
            );
        }

        const removedConfirmedParticipantIds = previousConfirmedParticipantIds.filter(
            (participantId) => !confirmedParticipantIds.includes(participantId),
        );
        const removedSnapshots = await Promise.all(
            removedConfirmedParticipantIds.map(async (participantId) => {
                const [registrationSnapshot, userSnapshot] = await Promise.all([
                    transaction.get(
                        db.collection("registrations").where("tournament_id", "==", tournamentId).where("user_global_id", "==", participantId),
                    ),
                    transaction.get(db.collection("users").where("global_id", "==", participantId)),
                ]);
                return {participantId, registrationSnapshot, userSnapshot};
            }),
        );
        const verificationEntries = [...new Set([...previousConfirmedParticipantIds, ...confirmedParticipantIds])].map(
            (participantId) => ({
                participantId,
                ref: db.collection("verification_requests").doc(buildVerificationRequestId(tournamentId, teamRef.id, participantId)),
            }),
        );
        const verificationSnapshots = await Promise.all(verificationEntries.map(({ref}) => transaction.get(ref)));
        const now = FirestoreTimestamp.now();

        for (const {registrationSnapshot, userSnapshot} of participantSnapshots) {
            const registrationDoc = registrationSnapshot.docs[0];
            const userDoc = findUserDocumentForTournament(userSnapshot, tournamentId);
            if (!userDoc) {
                throw new HttpsError("failed-precondition", "Member registration record is missing.");
            }
            const userData = userDoc.data() as {registration_records?: UserRegistrationRecord[]};
            transaction.update(registrationDoc.ref, {
                events_registered: registrationEventsWith(registrationDoc.data().events_registered, eventKeys),
                updated_at: now,
            });
            transaction.update(userDoc.ref, {
                registration_records: (userData.registration_records ?? []).map((record) =>
                    record.tournament_id === tournamentId
                        ? {...record, events: registrationEventsWith(record.events, eventKeys), updated_at: now}
                        : record,
                ),
                updated_at: now,
            });
        }

        for (const {participantId, registrationSnapshot, userSnapshot} of removedSnapshots) {
            const belongsToAnotherTeam = allTeamsSnapshot.docs.some((teamSnapshot) => {
                if (teamSnapshot.id === teamRef.id) return false;
                const candidate = teamSnapshot.data() as Team;
                return (
                    teamContainsConfirmedParticipant(candidate, participantId) &&
                    hasEventOverlap(
                        buildNormalizedEventSet(getTeamEventReferences(candidate)),
                        buildNormalizedEventSet(getTeamEventReferences(existingTeam)),
                    )
                );
            });
            if (belongsToAnotherTeam) continue;
            const registrationDoc = registrationSnapshot.docs[0];
            const userDoc = findUserDocumentForTournament(userSnapshot, tournamentId);
            if (registrationDoc) {
                transaction.update(registrationDoc.ref, {
                    events_registered: registrationEventsWithout(registrationDoc.data().events_registered, eventKeys),
                    updated_at: now,
                });
            }
            if (userDoc) {
                const userData = userDoc.data() as {registration_records?: UserRegistrationRecord[]};
                transaction.update(userDoc.ref, {
                    registration_records: (userData.registration_records ?? []).map((record) =>
                        record.tournament_id === tournamentId
                            ? {...record, events: registrationEventsWithout(record.events, eventKeys), updated_at: now}
                            : record,
                    ),
                    updated_at: now,
                });
            }
        }

        transaction.set(teamRef, {...nextTeam, id: teamRef.id, updated_at: now}, {merge: true});
        for (let index = 0; index < verificationEntries.length; index += 1) {
            const {participantId, ref} = verificationEntries[index];
            const isConfirmed = confirmedParticipantIds.includes(participantId);
            const verificationSnapshot = verificationSnapshots[index];
            if (isConfirmed) {
                transaction.set(
                    ref,
                    {status: "verified", verified_at: now, updated_at: now},
                    {merge: true},
                );
            } else if (verificationSnapshot.exists && verificationSnapshot.data()?.status === "pending") {
                transaction.set(
                    ref,
                    {status: "expired", expired_at: now, updated_at: now},
                    {merge: true},
                );
            }
        }
        return {teamId: teamRef.id, deleted: false};
    });
});

export const cacheGoogleAvatarCallable = onCall(callableFunctionOptions, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Unauthorized");
    }

    const photoURL = request.data?.photoURL;
    if (!photoURL || typeof photoURL !== "string") {
        throw new HttpsError("invalid-argument", "Missing photoURL");
    }

    const uid = request.auth.uid;
    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${uid}`);

    const buildDownloadUrl = (token: string) => {
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
    };

    const ensureDownloadUrl = async () => {
        const [metadata] = await file.getMetadata();
        let token = metadata.metadata?.firebaseStorageDownloadTokens;
        if (!token) {
            token = randomUUID();
            try {
                await file.setMetadata(
                    {metadata: {firebaseStorageDownloadTokens: token}},
                    {ifMetagenerationMatch: metadata.metageneration},
                );
            } catch {
                const [retryMetadata] = await file.getMetadata();
                token = retryMetadata.metadata?.firebaseStorageDownloadTokens ?? token;
            }
        }
        return buildDownloadUrl(String(token));
    };

    const [exists] = await file.exists();
    if (exists) {
        return {url: await ensureDownloadUrl()};
    }

    const response = await fetch(photoURL);
    if (!response.ok) {
        throw new HttpsError("internal", "Failed to fetch Google avatar");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const token = randomUUID();

    try {
        await file.save(buffer, {
            contentType,
            metadata: {
                firebaseStorageDownloadTokens: token,
            },
            preconditionOpts: {
                ifGenerationMatch: 0,
            },
        });
        return {url: buildDownloadUrl(token)};
    } catch (err: unknown) {
        const apiError = err as {code?: number};
        if (apiError?.code === 409 || apiError?.code === 412) {
            return {url: await ensureDownloadUrl()};
        }
        throw err;
    }
});

export const transferProfileOwnership = onCall(callableFunctionOptions, async (request) => {
    const requesterUid = request.auth?.uid;
    if (!requesterUid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const payload = request.data as {profileId?: unknown; targetEmail?: unknown};
    const profileId = typeof payload.profileId === "string" ? payload.profileId.trim() : "";
    const targetEmail = typeof payload.targetEmail === "string" ? payload.targetEmail.trim().toLowerCase() : "";

    if (!profileId) {
        throw new HttpsError("invalid-argument", "Profile ID is required.");
    }
    if (!targetEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
        throw new HttpsError("invalid-argument", "A valid target Gmail is required.");
    }

    const authorized = await requesterHasModifyAdmin(requesterUid);
    if (!authorized) {
        throw new HttpsError("permission-denied", "You do not have permission to transfer profile ownership.");
    }

    const profileRef = db.collection("users").doc(profileId);
    const profileSnap = await profileRef.get();
    if (!profileSnap.exists) {
        throw new HttpsError("not-found", "Profile not found.");
    }

    let targetUser: UserRecord;
    try {
        targetUser = await getAuth().getUserByEmail(targetEmail);
    } catch (error: unknown) {
        const authError = error as {code?: string};
        if (authError.code === "auth/user-not-found") {
            throw new HttpsError("not-found", "Target Gmail must already have a Firebase account.");
        }
        throw error;
    }

    const now = FirestoreTimestamp.now();
    const previousData = profileSnap.data() as {
        email?: string | null;
        primary_owner_email?: string | null;
        owner_uids?: string[] | null;
        account_status?: string | null;
    };
    const previousOwnerUids = Array.isArray(previousData.owner_uids) ? previousData.owner_uids : [];

    await db.runTransaction(async (transaction) => {
        transaction.update(profileRef, {
            owner_uids: [targetUser.uid],
            email: targetEmail,
            primary_owner_email: targetEmail,
            account_status: "claimed",
            updated_at: now,
        });

        const auditRef = db.collection("profile_ownership_audits").doc();
        transaction.set(auditRef, {
            profile_id: profileId,
            previous_owner_uids: previousOwnerUids,
            previous_email: previousData.email ?? null,
            previous_primary_owner_email: previousData.primary_owner_email ?? null,
            previous_account_status: previousData.account_status ?? null,
            new_owner_uid: targetUser.uid,
            new_owner_email: targetEmail,
            admin_uid: requesterUid,
            admin_email: request.auth?.token.email ?? null,
            created_at: now,
        });
    });

    return {
        profileId,
        owner_uids: [targetUser.uid],
        email: targetEmail,
        primary_owner_email: targetEmail,
        account_status: "claimed",
    };
});

const sanitizeProfileClaimText = (value: unknown, maxLength: number): string => {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().replace(/\s+/g, " ").slice(0, maxLength);
};

const parseProfileClaimDate = (value: unknown): FirestoreTimestamp | null => {
    if (!value) {
        return null;
    }
    if (value instanceof FirestoreTimestamp) {
        return value;
    }
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return FirestoreTimestamp.fromDate(value);
    }
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : FirestoreTimestamp.fromDate(parsed);
    }
    if (typeof value === "object") {
        const data = value as {seconds?: unknown; _seconds?: unknown; nanoseconds?: unknown; _nanoseconds?: unknown};
        const seconds = typeof data.seconds === "number" ? data.seconds : data._seconds;
        const nanoseconds = typeof data.nanoseconds === "number" ? data.nanoseconds : data._nanoseconds;
        if (typeof seconds === "number") {
            return new FirestoreTimestamp(seconds, typeof nanoseconds === "number" ? nanoseconds : 0);
        }
    }
    return null;
};

export const createProfileClaimRequest = onCall(callableFunctionOptions, async (request) => {
    const requesterUid = request.auth?.uid;
    const requesterEmail =
        typeof request.auth?.token.email === "string" ? request.auth.token.email.trim().toLowerCase() : "";
    if (!requesterUid || !requesterEmail) {
        throw new HttpsError("unauthenticated", "Please sign in with Google before requesting a profile claim.");
    }

    const payload = request.data as {
        profile_global_id?: unknown;
        profile_name?: unknown;
        identity_hint?: unknown;
        birthdate_hint?: unknown;
        tournament_hint?: unknown;
        note?: unknown;
    };
    const profileName = sanitizeProfileClaimText(payload.profile_name, 120);
    const profileGlobalId = sanitizeProfileClaimText(payload.profile_global_id, 32) || null;
    const identityHint = sanitizeProfileClaimText(payload.identity_hint, 64) || null;
    const tournamentHint = sanitizeProfileClaimText(payload.tournament_hint, 160) || null;
    const note = sanitizeProfileClaimText(payload.note, 1000) || null;
    const birthdateHint = parseProfileClaimDate(payload.birthdate_hint);

    if (!profileName) {
        throw new HttpsError("invalid-argument", "Participant name is required.");
    }
    if (!profileGlobalId && !identityHint && !birthdateHint && !tournamentHint && !note) {
        throw new HttpsError("invalid-argument", "Please provide at least one clue to help admins find the imported profile.");
    }

    const existingPending = await db
        .collection("profile_claim_requests")
        .where("requester_uid", "==", requesterUid)
        .where("status", "==", "pending")
        .limit(1)
        .get();
    if (!existingPending.empty) {
        await existingPending.docs[0].ref.update({
            profile_global_id: profileGlobalId,
            profile_name: profileName,
            identity_hint: identityHint,
            birthdate_hint: birthdateHint,
            tournament_hint: tournamentHint,
            note,
            updated_at: FirestoreTimestamp.now(),
        });
        return {requestId: existingPending.docs[0].id, status: "pending"};
    }

    const now = FirestoreTimestamp.now();
    const requestRef = db.collection("profile_claim_requests").doc();
    await requestRef.set({
        requester_uid: requesterUid,
        requester_email: requesterEmail,
        profile_global_id: profileGlobalId,
        profile_name: profileName,
        identity_hint: identityHint,
        birthdate_hint: birthdateHint,
        tournament_hint: tournamentHint,
        note,
        status: "pending",
        matched_profile_id: null,
        rejection_reason: null,
        created_at: now,
        updated_at: now,
        reviewed_at: null,
    } satisfies ProfileClaimRequestData);

    return {requestId: requestRef.id, status: "pending"};
});

export const approveProfileClaimRequest = onCall(callableFunctionOptions, async (request) => {
    const requesterUid = request.auth?.uid;
    if (!requesterUid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const authorized = await requesterHasModifyAdmin(requesterUid);
    if (!authorized) {
        throw new HttpsError("permission-denied", "You do not have permission to approve profile claims.");
    }

    const payload = request.data as {requestId?: unknown; profileId?: unknown};
    const requestId = sanitizeProfileClaimText(payload.requestId, 128);
    const profileId = sanitizeProfileClaimText(payload.profileId, 128);
    if (!requestId || !profileId) {
        throw new HttpsError("invalid-argument", "Claim request ID and profile ID are required.");
    }

    const requestRef = db.collection("profile_claim_requests").doc(requestId);
    const profileRef = db.collection("users").doc(profileId);
    const now = FirestoreTimestamp.now();

    let requesterEmail = "";
    let requesterOwnerUid = "";
    await db.runTransaction(async (transaction) => {
        const [requestSnap, profileSnap] = await Promise.all([transaction.get(requestRef), transaction.get(profileRef)]);
        if (!requestSnap.exists) {
            throw new HttpsError("not-found", "Claim request not found.");
        }
        if (!profileSnap.exists) {
            throw new HttpsError("not-found", "Profile not found.");
        }

        const claimData = requestSnap.data() as ProfileClaimRequestData;
        if (claimData.status !== "pending") {
            throw new HttpsError("failed-precondition", "Only pending claim requests can be approved.");
        }
        requesterEmail = claimData.requester_email;
        requesterOwnerUid = claimData.requester_uid;
        if (!requesterEmail || !requesterOwnerUid) {
            throw new HttpsError("failed-precondition", "Claim request is missing requester account details.");
        }

        const previousData = profileSnap.data() as {
            email?: string | null;
            owner_uids?: string[] | null;
            primary_owner_email?: string | null;
            account_status?: string | null;
        };
        const previousOwnerUids = Array.isArray(previousData.owner_uids) ? previousData.owner_uids : [];

        transaction.update(profileRef, {
            owner_uids: [requesterOwnerUid],
            email: requesterEmail,
            primary_owner_email: requesterEmail,
            account_status: "claimed",
            claim_method: "admin_review",
            updated_at: now,
        });
        transaction.update(requestRef, {
            status: "approved",
            matched_profile_id: profileId,
            reviewed_by_uid: requesterUid,
            reviewed_by_email: request.auth?.token.email ?? null,
            updated_at: now,
            reviewed_at: now,
        });
        transaction.set(db.collection("profile_ownership_audits").doc(), {
            profile_id: profileId,
            claim_request_id: requestId,
            previous_owner_uids: previousOwnerUids,
            previous_email: previousData.email ?? null,
            previous_primary_owner_email: previousData.primary_owner_email ?? null,
            previous_account_status: previousData.account_status ?? null,
            new_owner_uid: requesterOwnerUid,
            new_owner_email: requesterEmail,
            admin_uid: requesterUid,
            admin_email: request.auth?.token.email ?? null,
            method: "claim_request_approval",
            created_at: now,
        });
    });

    return {requestId, status: "approved", matched_profile_id: profileId};
});

export const rejectProfileClaimRequest = onCall(callableFunctionOptions, async (request) => {
    const requesterUid = request.auth?.uid;
    if (!requesterUid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }
    const authorized = await requesterHasModifyAdmin(requesterUid);
    if (!authorized) {
        throw new HttpsError("permission-denied", "You do not have permission to reject profile claims.");
    }

    const payload = request.data as {requestId?: unknown; rejectionReason?: unknown};
    const requestId = sanitizeProfileClaimText(payload.requestId, 128);
    const rejectionReason = sanitizeProfileClaimText(payload.rejectionReason, 500);
    if (!requestId || !rejectionReason) {
        throw new HttpsError("invalid-argument", "Claim request ID and rejection reason are required.");
    }

    const requestRef = db.collection("profile_claim_requests").doc(requestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) {
        throw new HttpsError("not-found", "Claim request not found.");
    }
    const claimData = requestSnap.data() as ProfileClaimRequestData;
    if (claimData.status !== "pending") {
        throw new HttpsError("failed-precondition", "Only pending claim requests can be rejected.");
    }

    const now = FirestoreTimestamp.now();
    await requestRef.update({
        status: "rejected",
        rejection_reason: rejectionReason,
        reviewed_by_uid: requesterUid,
        reviewed_by_email: request.auth?.token.email ?? null,
        updated_at: now,
        reviewed_at: now,
    });

    return {requestId, status: "rejected", matched_profile_id: null};
});

export const importTournamentWorkbook = onCall(importWorkbookFunctionOptions, async (request) => {
    const importStartedAt = Date.now();
    const importBatchRef = db.collection("import_batches").doc();
    const logImportStage = (stage: string, details: Record<string, unknown> = {}) => {
        console.info("importTournamentWorkbook checkpoint", {
            stage,
            databaseId: firestoreTriggerDatabase,
            functionsEmulator: process.env.FUNCTIONS_EMULATOR === "true",
            importBatchId: importBatchRef.id,
            elapsedMs: Date.now() - importStartedAt,
            ...details,
        });
    };

    if (!request.auth?.uid) {
        logImportStage("unauthenticated");
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const payload = request.data as ImportRequestPayload;
    const tournamentId = typeof payload.tournamentId === "string" ? payload.tournamentId.trim() : "";
    const fileBase64 = typeof payload.fileBase64 === "string" ? payload.fileBase64 : "";
    const mode: ImportMode = payload.mode === "commit" ? "commit" : "preview";
    const defaultCountry =
        typeof payload.defaultCountry === "string" && payload.defaultCountry.trim() ? payload.defaultCountry.trim() : "Malaysia";
    const defaultState =
        typeof payload.defaultState === "string" && payload.defaultState.trim() ? payload.defaultState.trim() : "-";
    const sheetMappings =
        payload.sheetMappings && typeof payload.sheetMappings === "object"
            ? (payload.sheetMappings as Record<string, string>)
            : {};

    logImportStage("request received", {
        mode,
        tournamentId,
        fileName: typeof payload.fileName === "string" ? payload.fileName : null,
        fileBase64Length: fileBase64.length,
        uid: request.auth.uid,
    });

    if (!tournamentId || !fileBase64) {
        logImportStage("invalid argument", {hasTournamentId: Boolean(tournamentId), hasFileBase64: Boolean(fileBase64)});
        throw new HttpsError("invalid-argument", "Tournament ID and workbook file are required.");
    }

    const authorized = await importIsAuthorized(request.auth.uid, tournamentId);
    if (!authorized) {
        logImportStage("authorization failed");
        throw new HttpsError("permission-denied", "You do not have permission to import registrations for this tournament.");
    }
    logImportStage("authorization complete");

    const [tournamentSnap, eventsSnap] = await Promise.all([
        db.collection("tournaments").doc(tournamentId).get(),
        db.collection("events").where("tournament_id", "==", tournamentId).get(),
    ]);
    logImportStage("tournament/events loaded", {
        tournamentExists: tournamentSnap.exists,
        events: eventsSnap.size,
    });
    if (!tournamentSnap.exists) {
        throw new HttpsError("not-found", "Tournament not found.");
    }

    const tournamentData = tournamentSnap.data() as {start_date?: FirestoreTimestamp | Date | string | number} | undefined;
    const tournamentStart =
        tournamentData?.start_date instanceof FirestoreTimestamp
            ? tournamentData.start_date.toDate()
            : tournamentData?.start_date instanceof Date
              ? tournamentData.start_date
              : new Date(tournamentData?.start_date ?? Date.now());
    if (Number.isNaN(tournamentStart.getTime())) {
        throw new HttpsError("failed-precondition", "Tournament start date is invalid.");
    }

    const events: ImportEvent[] = eventsSnap.docs.map((docSnap) => {
        const data = docSnap.data() as {id?: string; type?: string; gender?: string; teamSize?: number; team_size?: number};
        return {
            id: data.id ?? docSnap.id,
            type: data.type ?? "",
            gender: data.gender,
            teamSize: data.teamSize ?? data.team_size,
        };
    });

    const workbook = new ExcelJS.Workbook();
    const base64Payload = fileBase64.includes(",") ? (fileBase64.split(",").pop() ?? "") : fileBase64;
    const workbookBuffer = Buffer.from(base64Payload, "base64");
    const workbookArrayBuffer = workbookBuffer.buffer.slice(
        workbookBuffer.byteOffset,
        workbookBuffer.byteOffset + workbookBuffer.byteLength,
    );
    await workbook.xlsx.load(workbookArrayBuffer);
    logImportStage("workbook loaded", {
        bufferBytes: workbookBuffer.byteLength,
        worksheets: workbook.worksheets.length,
    });
    const parsed = importParseWorkbook(workbook, events, {defaultCountry, defaultState, sheetMappings});
    const errors = parsed.rows.filter((row) => row.level === "error");
    logImportStage("workbook parsed", {
        athletes: parsed.athletes.size,
        baseRoster: parsed.baseRosterKeys.size,
        registrations: parsed.registrationsByAthleteKey.size,
        teams: parsed.teams.length,
        issues: parsed.rows.length,
        errors: errors.length,
        warnings: parsed.rows.filter((row) => row.level === "warning").length,
    });
    const reportRows = importBuildReportRows(parsed, events);
    const summary = {
        mode,
        importBatchId: importBatchRef.id,
        athletes: parsed.athletes.size,
        baseRoster: parsed.baseRosterKeys.size,
        registrations: parsed.registrationsByAthleteKey.size,
        teams: parsed.teams.length,
        errors: errors.length,
        warnings: parsed.rows.filter((row) => row.level === "warning").length,
        createdRegistrations: 0,
        updatedRegistrations: 0,
        createdTeams: 0,
    };
    logImportStage("report rows built", {
        reportRows: reportRows.length,
        summary,
    });

    if (mode === "commit") {
        if (errors.length > 0) {
            logImportStage("commit skipped due to errors", {errors: errors.length});
            return {
                summary,
                rows: reportRows,
                committed: false,
            };
        }
        logImportStage("commit started");
        await importResolveUsers(parsed.athletes.values(), importBatchRef.id);
        logImportStage("users resolved");
        const commitSummary = await importCommitRegistrationsAndTeams({
            tournamentId,
            tournamentStartDate: tournamentStart,
            parsed,
            importBatchId: importBatchRef.id,
        });
        Object.assign(summary, commitSummary);
        logImportStage("registrations and teams committed", {commitSummary});
        await importBatchRef.set({
            tournament_id: tournamentId,
            file_name: typeof payload.fileName === "string" ? payload.fileName : null,
            mode,
            summary,
            rows: reportRows,
            created_at: FirestoreTimestamp.now(),
            created_by_uid: request.auth.uid,
        });
        logImportStage("import batch saved", {summary});
        return {
            summary,
            rows: reportRows,
            committed: true,
        };
    }

    logImportStage("preview complete", {summary});
    return {
        summary,
        rows: reportRows,
        committed: false,
    };
});

export const updateVerification = onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        let requesterUid: string | null = null;
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            res.status(401).json({error: "Missing or invalid auth header"});
            return;
        }

        const idToken = authHeader.split("Bearer ")[1];

        try {
            const decoded = await getAuth().verifyIdToken(idToken);
            if (!decoded.uid) {
                res.status(401).json({error: "Invalid token"});
                return;
            }
            requesterUid = decoded.uid;
        } catch (err) {
            console.error("❌ Token verification failed", err);
            res.status(401).json({error: "Invalid token"});
            return;
        }

        const {tournamentId, teamId, memberId, registrationId} = req.body;

        if (!tournamentId || !teamId || !memberId || !registrationId) {
            res.status(400).json({error: "Missing fields"});
            return;
        }

        try {
            if (!requesterUid) {
                res.status(401).json({error: "Invalid token"});
                return;
            }

            const usersRef = db.collection("users");
            const userQuery = usersRef.where("global_id", "==", memberId);
            const userSnap = await userQuery.get();

            if (userSnap.empty) {
                res.status(404).json({error: "User not found"});
                return;
            }

            const ownedMemberDoc = userSnap.docs.find((docSnap) => {
                const data = docSnap.data() as {id?: string; owner_uids?: string[] | null};
                const ownerUids = Array.isArray(data.owner_uids) ? data.owner_uids : [];
                return ownerUids.includes(requesterUid) || docSnap.id === requesterUid || data.id === requesterUid;
            });

            if (!ownedMemberDoc) {
                res.status(403).json({error: "You can only verify your own invitation."});
                return;
            }

            const userDocRef = ownedMemberDoc.ref;

            // Find registration by registrationId, but fall back to member's registration if needed
            let regRef = db.collection("registrations").doc(registrationId);
            let regSnap = await regRef.get();
            let registrationData: Registration | null = regSnap.exists ? (regSnap.data() as Registration) : null;

            const registrationMatchesMember =
                registrationData?.user_global_id === memberId || registrationData?.user_id === memberId;

            if (!registrationData || !registrationMatchesMember) {
                const registrationQuery = db
                    .collection("registrations")
                    .where("tournament_id", "==", tournamentId)
                    .where("user_global_id", "==", memberId);
                const registrationSnapshot = await registrationQuery.get();

                if (registrationSnapshot.empty) {
                    res.status(409).json({
                        error: "You must register for this tournament before verification.",
                        code: "MEMBER_NOT_REGISTERED",
                    });
                    return;
                }

                regSnap = registrationSnapshot.docs[0];
                regRef = regSnap.ref;
                registrationData = regSnap.data() as Registration;
            }

            await db.runTransaction(async (transaction) => {
                // 'team_recruitments' is now a top-level collection, not under tournaments
                const teamRef = db.collection("teams").doc(teamId);
                const teamDoc = await transaction.get(teamRef);
                const userDoc = await transaction.get(userDocRef);

                if (!teamDoc.exists) {
                    throw new Error("Team not found");
                }
                if (!userDoc.exists) {
                    throw new Error("User not found");
                }

                const teamData = teamDoc.data() as Team;
                if (teamData.tournament_id !== tournamentId) {
                    throw new Error("Team does not belong to this tournament.");
                }
                const memberIndex = teamData.members.findIndex((m: TeamMember) => m.global_id === memberId);
                const teamEventReferences = getTeamEventReferences(teamData);
                const normalizedTeamEventReferences = buildNormalizedEventSet(teamEventReferences);
                const eventKeysToRegister = getPreferredTeamEventKeys(teamData, teamEventReferences);

                if (memberIndex === -1) {
                    throw new Error("You are not a member of this team.");
                }

                const userData = userDoc.data();
                const registrationRecords: UserRegistrationRecord[] = userData?.registration_records ?? [];
                const recordIndex = registrationRecords.findIndex((record) => record.tournament_id === tournamentId);

                if (recordIndex === -1) {
                    throw new Error("You are not registered for this tournament.");
                }

                const record = registrationRecords[recordIndex];
                const existingEvents = Array.isArray(record.events) ? record.events : [];

                if (normalizedTeamEventReferences.size > 0) {
                    const teamsQuery = db.collection("teams").where("tournament_id", "==", tournamentId);
                    const teamsSnapshot = await transaction.get(teamsQuery);
                    let conflictingTeamName: string | null = null;

                    for (const teamDocSnap of teamsSnapshot.docs) {
                        if (teamDocSnap.id === teamId) {
                            continue;
                        }

                        const otherTeam = teamDocSnap.data() as Team;
                        const isLeader = otherTeam.leader_id === memberId;
                        const memberRecord = Array.isArray(otherTeam.members)
                            ? otherTeam.members.find((member) => member.global_id === memberId)
                            : undefined;
                        const isVerifiedMember = Boolean(memberRecord?.verified);

                        if (!isLeader && !isVerifiedMember) {
                            continue;
                        }

                        const otherTeamReferences = getTeamEventReferences(otherTeam);
                        const normalizedOtherTeamReferences = buildNormalizedEventSet(otherTeamReferences);
                        if (hasEventOverlap(normalizedTeamEventReferences, normalizedOtherTeamReferences)) {
                            conflictingTeamName = otherTeam.name ?? "another team";
                            break;
                        }
                    }

                    if (conflictingTeamName) {
                        throw new Error(`You are already participating in ${conflictingTeamName} for this event.`);
                    }
                }

                if (normalizedTeamEventReferences.size > 0) {
                    const normalizedExistingEvents = buildNormalizedEventSet(existingEvents);
                    if (hasEventOverlap(normalizedTeamEventReferences, normalizedExistingEvents)) {
                        throw new Error("You are already registered for one or more of these team events.");
                    }
                }

                const updatedEvents =
                    eventKeysToRegister.length > 0
                        ? [...new Set([...existingEvents, ...eventKeysToRegister])]
                        : [...new Set(existingEvents)];
                const newRegistrationRecords = [...registrationRecords];
                newRegistrationRecords[recordIndex] = {...record, events: updatedEvents};

                const updatedMembers = [...teamData.members];
                updatedMembers[memberIndex].verified = true;

                // Update the registration document with the new events
                const registrationEvents = Array.isArray(registrationData.events_registered)
                    ? registrationData.events_registered
                    : [];
                // Update the registration document with the new events
                await transaction.update(regRef, {
                    events_registered:
                        eventKeysToRegister.length > 0
                            ? [...new Set([...registrationEvents, ...eventKeysToRegister])]
                            : [...new Set(registrationEvents)],
                    updated_at: new Date(),
                });

                transaction.update(userDocRef, {registration_records: newRegistrationRecords});
                transaction.update(teamRef, {members: updatedMembers});
            });

            const verificationRequestId = buildVerificationRequestId(tournamentId, teamId, memberId);
            await db.collection("verification_requests").doc(verificationRequestId).set(
                {
                    status: "verified",
                    verified_at: new Date(),
                    updated_at: new Date(),
                },
                {merge: true},
            );

            try {
                await deleteRecruitmentsForVerifiedMember({
                    tournamentId,
                    memberId,
                    registrationId: regRef.id,
                });
            } catch (cleanupError) {
                console.error("Failed to clean up recruitments after verification:", cleanupError);
            }

            res.status(200).json({success: true});
        } catch (err: unknown) {
            console.error("Error updating verification:", err);
            const errorMessage = (err as Error).message;
            if (errorMessage === "Team not found") {
                res.status(404).json({error: errorMessage});
            } else if (errorMessage === "User not found") {
                res.status(404).json({error: errorMessage});
            } else if (errorMessage === "You are not a member of this team.") {
                res.status(400).json({error: errorMessage});
            } else if (errorMessage === "You are not registered for this tournament.") {
                res.status(400).json({error: errorMessage});
            } else if (errorMessage === "Team does not belong to this tournament.") {
                res.status(400).json({error: errorMessage});
            } else if (errorMessage === "You are already registered for one or more of these team events.") {
                res.status(409).json({error: errorMessage});
            } else if (errorMessage.startsWith("You are already participating in")) {
                res.status(409).json({error: errorMessage});
            } else {
                res.status(500).json({error: errorMessage});
            }
        }
    });
});

/**
 * Cloud Function to recalculate user best times when final records are created, updated, or deleted.
 */
export const updateUserBestTimes = onDocumentWritten(
    {
        document: "records/{recordId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
    },
    async (event) => {
        const beforeData = event.data?.before?.data() as Record<string, unknown> | undefined;
        const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
        const affectedGlobalIds = collectParticipantGlobalIds(beforeData, afterData);
        if (affectedGlobalIds.length === 0) {
            return;
        }

        try {
            await Promise.all(affectedGlobalIds.map((globalId) => recalculateUserBestTimesByGlobalId(globalId)));
        } catch (error) {
            console.error(`Failed to recalculate best times for record ${event.params.recordId}:`, error);
        }
    },
);

export const syncUserTournamentHistoryFromRecords = onDocumentWritten(
    {
        document: "records/{recordId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
    },
    async (event) => {
        const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
        if (!afterData) {
            return;
        }

        const affectedGlobalIds = collectAffectedGlobalIds(afterData);
        if (affectedGlobalIds.length === 0) {
            return;
        }

        await Promise.all(affectedGlobalIds.map((globalId) => syncUserTournamentHistoryByGlobalId(globalId)));
    },
);

export const syncUserTournamentHistoryFromPrelimRecords = onDocumentWritten(
    {
        document: "prelim_records/{recordId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
    },
    async (event) => {
        const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
        if (!afterData) {
            return;
        }

        const affectedGlobalIds = collectAffectedGlobalIds(afterData);
        if (affectedGlobalIds.length === 0) {
            return;
        }

        await Promise.all(affectedGlobalIds.map((globalId) => syncUserTournamentHistoryByGlobalId(globalId)));
    },
);

export const syncUserTournamentHistoryFromOverallRecords = onDocumentWritten(
    {
        document: "overall_records/{recordId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
    },
    async (event) => {
        const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
        if (!afterData) {
            return;
        }

        const participantGlobalId = toStringOrNull(afterData.participant_global_id);
        if (!participantGlobalId) {
            return;
        }

        await syncUserTournamentHistoryByGlobalId(participantGlobalId);
    },
);

export const updateUserBestTimesFromOverall = onDocumentWritten(
    {
        document: "overall_records/{recordId}",
        database: firestoreTriggerDatabase,
        region: functionsRegion,
        retry: false,
    },
    async (event) => {
        const beforeData = event.data?.before?.data() as Record<string, unknown> | undefined;
        const afterData = event.data?.after?.data() as Record<string, unknown> | undefined;
        const affectedGlobalIds = collectParticipantGlobalIds(beforeData, afterData);
        if (affectedGlobalIds.length === 0) {
            return;
        }

        try {
            await Promise.all(affectedGlobalIds.map((globalId) => recalculateUserBestTimesByGlobalId(globalId)));
        } catch (error) {
            console.error(`Failed to recalculate best times for overall record ${event.params.recordId}:`, error);
        }
    },
);
