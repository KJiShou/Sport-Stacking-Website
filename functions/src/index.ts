import {randomUUID} from "node:crypto";
import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import type {UserRecord} from "firebase-admin/auth";
import {getAuth} from "firebase-admin/auth";
import {
    FieldValue,
    type QueryDocumentSnapshot,
    Timestamp as FirestoreTimestamp,
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
const functionsRegion = process.env.FUNCTIONS_REGION ?? "asia-southeast1";
const callableFunctionOptions = {
    cors: allowedOriginList,
    region: functionsRegion,
};

const corsHandler = cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.has(origin)) {
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

// AWS SES Secrets for backup email delivery
const AWS_SES_SMTP_USERNAME = defineSecret("AWS_SES_SMTP_USERNAME");
const AWS_SES_SMTP_PASSWORD = defineSecret("AWS_SES_SMTP_PASSWORD");
const AWS_SES_REGION = "ap-southeast-2";
const AWS_SES_FROM_EMAIL = process.env.AWS_SES_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";

if (!getApps().length) {
    initializeApp();
}

const firebaseApp = getApps()[0] ?? initializeApp();
const firestoreDatabaseId =
    process.env.FIRESTORE_DATABASE_ID?.trim() || (process.env.FUNCTIONS_EMULATOR === "true" ? "develop2" : "");
const db = firestoreDatabaseId ? getFirestore(firebaseApp, firestoreDatabaseId) : getFirestore(firebaseApp);

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

type ParsedWorkbookImport = {
    athletes: Map<string, ImportAthlete>;
    baseRosterKeys: Set<string>;
    registrationsByAthleteKey: Map<string, Set<string>>;
    teams: ImportTeam[];
    rows: ImportReportRow[];
};

type ImportUserProfileData = {
    id?: string;
    global_id?: string;
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
            return value.richText.map((item) => item.text).join("").trim();
        }
        if ("hyperlink" in value && "text" in value && typeof value.text === "string") {
            return value.text.trim();
        }
    }
    return String(value).trim();
};

const importNormalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const importNormalizeCompact = (value: string): string => value.trim().replace(/\s+/g, "").toUpperCase();

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

const importFindHeaderRow = (worksheet: ExcelJS.Worksheet): number => {
    for (let rowNumber = 1; rowNumber <= Math.min(worksheet.rowCount, 12); rowNumber += 1) {
        const rowText = worksheet
            .getRow(rowNumber)
            .values.toString()
            .toLowerCase();
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
        const headerTokens = value.replace(/[^a-z0-9]+/g, " ").split(" ").filter(Boolean);
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

const importRowHasParticipantContent = (row: ExcelJS.Row, columns: ReturnType<typeof importFindColumns>): boolean => {
    const checkedColumns = [columns.name, columns.identity, columns.birthdate].filter((column) => column > 0);
    return checkedColumns.some((column) => importCellToString(row.getCell(column).value).trim().length > 0);
};

const importGetLastRelevantRow = (worksheet: ExcelJS.Worksheet, headerRowNumber: number, columns: ReturnType<typeof importFindColumns>): number => {
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
        return events.find((event) => event.id === mapped || event.type === mapped) ?? null;
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
    ];
    const alias = aliases.find(([name]) => normalizedSheet.includes(name))?.[1];
    if (alias) {
        return events.find((event) => event.type === alias || (alias === "Individual" && event.type.includes("Individual"))) ?? null;
    }

    return events.find((event) => normalizedSheet.includes(importNormalize(event.type).replace(/&/g, "and"))) ?? null;
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
    fallbackBirthdate,
    allowMissingBirthdate,
}: {
    worksheet: ExcelJS.Worksheet;
    rowNumber: number;
    columns: ReturnType<typeof importFindColumns>;
    roleCol?: number;
    defaultCountry: string;
    defaultState: string;
    eventGender?: string;
    fallbackBirthdate?: Date;
    allowMissingBirthdate?: boolean;
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
    if (!parsedBirthdate && !allowMissingBirthdate) {
        return {athlete: null, warnings: [`${name}: missing or invalid date of birth.`]};
    }
    const birthdate = parsedBirthdate ?? fallbackBirthdate ?? new Date(Date.UTC(1900, 0, 1));
    if (!parsedBirthdate && allowMissingBirthdate) {
        warnings.push(`${name}: DOB missing; parent-only account used a placeholder date.`);
    }

    const genderText = columns.gender > 0 ? importNormalize(importCellToString(row.getCell(columns.gender).value)) : "";
    const inferredGender = importInferGender(identityType, identityNumber);
    const gender =
        genderText.startsWith("f") || genderText.includes("female")
            ? "Female"
            : genderText.startsWith("m") || genderText.includes("male")
              ? "Male"
              : inferredGender ?? (eventGender === "Female" ? "Female" : "Male");
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

const importMergeAthlete = (
    parsed: ParsedWorkbookImport,
    athlete: ImportAthlete,
    rows: ImportReportRow[],
): ImportAthlete => {
    const existing = parsed.athletes.get(athlete.workbookKey);
    if (!existing) {
        parsed.athletes.set(athlete.workbookKey, athlete);
        return athlete;
    }
    if (existing.name !== athlete.name) {
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
        baseRosterKeys: new Set(),
        registrationsByAthleteKey: new Map(),
        teams: [],
        rows: [],
    };
    const individualEvent = events.find((event) => event.type === "Individual") ?? events.find((event) => event.type.includes("Individual"));
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
        const isIndividualSheet = event.id === individualEvent.id || event.type.includes("Individual");
        const isParentChildSheet = event.type === "Parent & Child";
        const isTeamSheet = event.type === "Double" || event.type === "Team Relay" || isParentChildSheet;
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
                    importAddEventForAthlete(parsed, merged.workbookKey, individualEvent.id);
                } else if (!parsed.baseRosterKeys.has(merged.workbookKey)) {
                    parsed.rows.push({
                        sheet: worksheet.name,
                        row: rowNumber,
                        level: "error",
                        message: `${merged.name} must appear in the Individual sheet before joining ${event.type}.`,
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
                    fallbackBirthdate: childResult.athlete?.birthdate,
                    allowMissingBirthdate: true,
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
        const expectedSize = event.teamSize ?? (event.type === "Double" ? 2 : event.type === "Team Relay" ? 4 : 1);
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
            } else {
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
        };

        for (let rowNumber = headerRowNumber + 1; rowNumber <= lastRelevantRow; rowNumber += 1) {
            const row = worksheet.getRow(rowNumber);
            const noText = importCellToString(row.getCell(columns.no).value);
            if (importIsExampleMarker(noText)) {
                flushBlock();
                rowNumber += expectedSize - 1;
                continue;
            }
            if (!importRowHasParticipantContent(row, columns)) {
                continue;
            }
            const startsBlock = noText.trim().length > 0 && noText.toLowerCase() !== "ex:";
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
            if (!parsed.baseRosterKeys.has(merged.workbookKey)) {
                parsed.rows.push({
                    sheet: worksheet.name,
                    row: rowNumber,
                    level: "error",
                    message: `${merged.name} must appear in the Individual sheet before joining ${event.type}.`,
                });
                continue;
            }
            currentBlock.push(merged.workbookKey);
        }
        flushBlock();
    }

    if (parsed.baseRosterKeys.size === 0) {
        parsed.rows.push({sheet: "Individual", row: 0, level: "error", message: "Individual sheet has no valid athletes."});
    }

    return parsed;
};

const importGetNextGlobalId = async (): Promise<string> => {
    const counterRef = db.collection("counters").doc("userCounter");
    const next = await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(counterRef);
        const nextAvailableCount = (current: number) => {
            let candidate = current + 1;
            while (String(candidate).includes("4")) {
                candidate += 1;
            }
            return candidate;
        };
        const current = snap.exists ? ((snap.data()?.count as number | undefined) ?? 0) : 0;
        const resolved = nextAvailableCount(current);
        transaction.set(counterRef, {count: resolved}, {merge: true});
        return resolved;
    });
    return String(next).padStart(5, "0");
};

const importIsAuthorized = async (uid: string, tournamentId: string): Promise<boolean> => {
    const tournamentSnap = await db.collection("tournaments").doc(tournamentId).get();
    const tournamentData = tournamentSnap.data() as {editor?: string; recorder?: string} | undefined;
    const ownedProfilesSnap = await db.collection("users").where("owner_uids", "array-contains", uid).get();
    const legacyProfileSnap = await db.collection("users").doc(uid).get();
    const profiles = [...ownedProfilesSnap.docs, ...(legacyProfileSnap.exists ? [legacyProfileSnap] : [])];
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
    if (legacyProfileSnap.exists) {
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

const importFindExistingUserForAthlete = async (
    athlete: ImportAthlete,
): Promise<QueryDocumentSnapshot | null> => {
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

const importUseExistingUserForAthlete = async (
    athlete: ImportAthlete,
    existingDoc: QueryDocumentSnapshot,
): Promise<void> => {
    const data = existingDoc.data() as ImportUserProfileData;
    const nextGlobalId = data.global_id ?? (await importGetNextGlobalId());
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

    await existingDoc.ref.update(patch);
};

const importResolveUsers = async (athletes: Iterable<ImportAthlete>, importBatchId: string): Promise<void> => {
    for (const athlete of athletes) {
        const existingDoc = await importFindExistingUserForAthlete(athlete);
        if (existingDoc) {
            await importUseExistingUserForAthlete(athlete, existingDoc);
            continue;
        }

        const userRef = db.collection("users").doc();
        const globalId = await importGetNextGlobalId();
        athlete.userDocId = userRef.id;
        athlete.globalId = globalId;
        await userRef.set({
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
            created_at: FirestoreTimestamp.now(),
            updated_at: FirestoreTimestamp.now(),
        });
    }
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

    for (const [athleteKey, eventIds] of parsed.registrationsByAthleteKey.entries()) {
        const athlete = parsed.athletes.get(athleteKey);
        if (!athlete?.userDocId || !athlete.globalId || athlete.parentOnly) {
            continue;
        }
        const existingRegistrationSnap = await db
            .collection("registrations")
            .where("tournament_id", "==", tournamentId)
            .where("user_global_id", "==", athlete.globalId)
            .limit(1)
            .get();
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

        if (existingRegistrationSnap.empty) {
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
            await registrationRef.set(payload);
            registrationIdByAthleteKey.set(athleteKey, registrationRef.id);
            createdRegistrations += 1;
        } else {
            const registrationDoc = existingRegistrationSnap.docs[0];
            const existingData = registrationDoc.data() as {events_registered?: string[]; registration_status?: string};
            const mergedEvents = Array.from(new Set([...(existingData.events_registered ?? []), ...eventsRegistered]));
            recordEvents = mergedEvents;
            await registrationDoc.ref.update({
                events_registered: mergedEvents,
                registration_status: "approved",
                import_batch_id: importBatchId,
                updated_at: now,
            });
            registrationIdByAthleteKey.set(athleteKey, registrationDoc.id);
            updatedRegistrations += 1;
            if (existingData.registration_status !== "approved") {
                createdRegistrations += 1;
            }
        }

        const userRef = db.collection("users").doc(athlete.userDocId);
        const userSnap = await userRef.get();
        const existingRecords = (userSnap.data()?.registration_records as Array<{tournament_id?: string}> | undefined) ?? [];
        const syncedRegistrationRecord = {
            ...registrationRecord,
            events: recordEvents,
        };
        const nextRecords = [
            ...existingRecords.filter((record) => record.tournament_id !== tournamentId),
            syncedRegistrationRecord,
        ];
        await userRef.update({
            registration_records: nextRecords,
            updated_at: now,
        });
    }

    if (createdRegistrations > 0) {
        await db.collection("tournaments").doc(tournamentId).update({participants: FieldValue.increment(createdRegistrations)});
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
        const athletes = team.members.map((memberKey) => parsed.athletes.get(memberKey)).filter((value): value is ImportAthlete => Boolean(value));
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
        const teamKey = `${team.eventId}|${leader.globalId}|${members.map((member) => member.global_id).sort().join(",")}`;
        if (existingTeamKeys.has(teamKey)) {
            continue;
        }
        const ages = athletes.map((athlete) => importAgeAtTournament(athlete.birthdate, tournamentStartDate));
        const teamAge =
            team.eventType === "Team Relay"
                ? Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length)
                : team.eventType === "Double"
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
    const issueRows = parsed.rows.map((row) => ({
        ...row,
        category: row.level === "warning" ? ("warnings" as const) : ("errors" as const),
    }));
    const athleteRows = Array.from(parsed.athletes.values()).map((athlete) => ({
        sheet: athlete.sourceSheet,
        row: athlete.sourceRow,
        level: "info" as const,
        category: "athletes" as const,
        message: `${athlete.name} | ${athlete.gender} | ${athlete.identityNumber ?? "No Passport/IC"} | ${importFormatDateKey(athlete.birthdate)}`,
    }));
    const registrationRows = Array.from(parsed.registrationsByAthleteKey.entries()).flatMap(([athleteKey, eventIds]) => {
        const athlete = parsed.athletes.get(athleteKey);
        if (!athlete) {
            return [];
        }
        const eventLabels = Array.from(eventIds).map((eventId) => eventLabelById.get(eventId) ?? eventId);
        return [
            {
                sheet: athlete.sourceSheet,
                row: athlete.sourceRow,
                level: "info" as const,
                category: "registrations" as const,
                message: `${athlete.name} | ${eventLabels.join(", ")}`,
            },
        ];
    });
    const teamRows = parsed.teams.map((team) => {
        const memberNames = team.members.map((memberKey) => parsed.athletes.get(memberKey)?.name ?? memberKey);
        return {
            sheet: team.sheetName,
            row: team.sourceRow,
            level: "info" as const,
            category: "teams" as const,
            message: `${team.eventType} | ${memberNames.join(" / ")}`,
        };
    });

    return [...issueRows, ...athleteRows, ...registrationRows, ...teamRows];
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
        db.collection("individual_recruitment")
            .where("tournament_id", "==", tournamentId)
            .where("participant_id", "==", memberId)
            .get(),
        db.collection("double_recruitment")
            .where("tournament_id", "==", tournamentId)
            .where("participant_id", "==", memberId)
            .get(),
        teamRecruitmentRef.where("tournament_id", "==", tournamentId).where("leader_id", "==", memberId).get(),
        normalizedRegistrationId.length > 0
            ? teamRecruitmentRef.where("tournament_id", "==", tournamentId).where("registration_id", "==", normalizedRegistrationId).get()
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

export const sendEmail = onRequest({secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD]}, (req, res) => {
    corsHandler(req, res, async () => {
        const apiKey = RESEND_API_KEY.value();
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

        // Step 2: 校验必要参数
        const {to, tournamentId, teamId, memberId, registrationId} = req.body;
        if (!to || !tournamentId || !teamId || !memberId || !registrationId) {
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

        const detailItems: string[] = [];
        if (eventLabel) {
            detailItems.push(`<li><strong>Event:</strong> ${escapeHtml(eventLabel)}</li>`);
        }
        if (teamName) {
            detailItems.push(`<li><strong>Team:</strong> ${escapeHtml(teamName)}</li>`);
        }
        if (leaderLabel) {
            detailItems.push(`<li><strong>Invited by:</strong> ${escapeHtml(leaderLabel)}</li>`);
        }

        const detailList = detailItems.length > 0 ? `<p>Verification details:</p><ul>${detailItems.join("")}</ul>` : "";

        const verificationRequestId = buildVerificationRequestId(tournamentId, teamId, memberId);
        const verificationRequestRef = db.collection("verification_requests").doc(verificationRequestId);
        const verificationRequestSnapshot = await verificationRequestRef.get();
        const now = new Date();
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
            ...(verificationRequestSnapshot.exists ? {} : {created_at: now}),
        };
        await verificationRequestRef.set(verificationPayload, {merge: true});

        // Step 3: 构造验证链接，包含 registrationId
        const verifyUrl = `https://rankingstack.com/verify?tournamentId=${tournamentId}&teamId=${teamId}&memberId=${memberId}&registrationId=${registrationId}`;
        const safeVerifyUrl = verifyUrl.replace(/&/g, "&amp;");

        const html = `
    <p>Hello,</p>
    <p>Please click the button below to verify your team membership for the <strong>RankingStack</strong> competition.</p>
    ${detailList}
    <p>
        <a href="${safeVerifyUrl}"
   style="padding: 10px 16px; background-color: #165DFF; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
   🔐 Verify My Participation
</a>
    </p>
    <p>If you did not expect this email, you can safely ignore it.</p>
    <p>Thank you!</p>
`;

        // Step 4: 发送邮件 (Resend primary, AWS SES backup)
        try {
            const resendResponse = await fetch(RESEND_API_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: RESEND_FROM_EMAIL,
                    to: [to],
                    subject: "Please verify your competition registration",
                    html,
                }),
            });

            const payload = await resendResponse.json().catch((err) => {
                console.error("❌ Failed to parse Resend response JSON:", err);
                return undefined;
            });

            if (!resendResponse.ok) {
                const message = typeof payload === "object" && payload?.error ? payload.error : "Send failed";
                console.error("❌ Resend error:", payload || resendResponse.statusText);

                // Try AWS SES as backup
                console.info("⚡ Attempting AWS SES as backup...");
                const sesResult = await sendEmailViaSES(
                    to,
                    "Please verify your competition registration",
                    html,
                    AWS_SES_SMTP_USERNAME.value(),
                    AWS_SES_SMTP_PASSWORD.value(),
                );

                if (sesResult.success) {
                    console.info("✅ Email sent successfully via AWS SES backup");
                    res.status(200).json({success: true, id: sesResult.messageId, provider: "aws-ses"});
                    return;
                }

                // Both services failed
                console.error("❌ Both Resend and AWS SES failed");
                res.status(500).json({
                    error: message,
                    backup_error: sesResult.error,
                });
                return;
            }

            res.status(200).json({success: true, id: payload?.id, provider: "resend"});
        } catch (err: unknown) {
            console.error("❌ Resend send attempt failed:", err);

            // Try AWS SES as backup
            console.info("⚡ Attempting AWS SES as backup after Resend exception...");
            try {
                const sesResult = await sendEmailViaSES(
                    to,
                    "Please verify your competition registration",
                    html,
                    AWS_SES_SMTP_USERNAME.value(),
                    AWS_SES_SMTP_PASSWORD.value(),
                );

                if (sesResult.success) {
                    console.info("✅ Email sent successfully via AWS SES backup");
                    res.status(200).json({success: true, id: sesResult.messageId, provider: "aws-ses"});
                    return;
                }

                // Both services failed
                console.error("❌ Both Resend and AWS SES failed");
                res.status(500).json({
                    error: (err as Error).message || "Send failed",
                    backup_error: sesResult.error,
                });
            } catch (sesErr: unknown) {
                console.error("❌ AWS SES backup also threw exception:", sesErr);
                res.status(500).json({
                    error: (err as Error).message || "Send failed",
                    backup_error: (sesErr as Error).message || "AWS SES backup failed",
                });
            }
        }
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

export const importTournamentWorkbook = onCall(callableFunctionOptions, async (request) => {
    if (!request.auth?.uid) {
        throw new HttpsError("unauthenticated", "Authentication required.");
    }

    const payload = request.data as ImportRequestPayload;
    const tournamentId = typeof payload.tournamentId === "string" ? payload.tournamentId.trim() : "";
    const fileBase64 = typeof payload.fileBase64 === "string" ? payload.fileBase64 : "";
    const mode: ImportMode = payload.mode === "commit" ? "commit" : "preview";
    const defaultCountry = typeof payload.defaultCountry === "string" && payload.defaultCountry.trim() ? payload.defaultCountry.trim() : "Malaysia";
    const defaultState = typeof payload.defaultState === "string" && payload.defaultState.trim() ? payload.defaultState.trim() : "-";
    const sheetMappings =
        payload.sheetMappings && typeof payload.sheetMappings === "object"
            ? (payload.sheetMappings as Record<string, string>)
            : {};

    if (!tournamentId || !fileBase64) {
        throw new HttpsError("invalid-argument", "Tournament ID and workbook file are required.");
    }

    const authorized = await importIsAuthorized(request.auth.uid, tournamentId);
    if (!authorized) {
        throw new HttpsError("permission-denied", "You do not have permission to import registrations for this tournament.");
    }

    const [tournamentSnap, eventsSnap] = await Promise.all([
        db.collection("tournaments").doc(tournamentId).get(),
        db.collection("events").where("tournament_id", "==", tournamentId).get(),
    ]);
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
    const base64Payload = fileBase64.includes(",") ? fileBase64.split(",").pop() ?? "" : fileBase64;
    const workbookBuffer = Buffer.from(base64Payload, "base64");
    const workbookArrayBuffer = workbookBuffer.buffer.slice(
        workbookBuffer.byteOffset,
        workbookBuffer.byteOffset + workbookBuffer.byteLength,
    );
    await workbook.xlsx.load(workbookArrayBuffer);
    const parsed = importParseWorkbook(workbook, events, {defaultCountry, defaultState, sheetMappings});
    const errors = parsed.rows.filter((row) => row.level === "error");
    const reportRows = importBuildReportRows(parsed, events);
    const importBatchRef = db.collection("import_batches").doc();
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

    if (mode === "commit") {
        if (errors.length > 0) {
            return {
                summary,
                rows: reportRows,
                committed: false,
            };
        }
        await importResolveUsers(parsed.athletes.values(), importBatchRef.id);
        const commitSummary = await importCommitRegistrationsAndTeams({
            tournamentId,
            tournamentStartDate: tournamentStart,
            parsed,
            importBatchId: importBatchRef.id,
        });
        Object.assign(summary, commitSummary);
        await importBatchRef.set({
            tournament_id: tournamentId,
            file_name: typeof payload.fileName === "string" ? payload.fileName : null,
            mode,
            summary,
            rows: reportRows,
            created_at: FirestoreTimestamp.now(),
            created_by_uid: request.auth.uid,
        });
        return {
            summary,
            rows: reportRows,
            committed: true,
        };
    }

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

                if (teamData.members[memberIndex].verified) {
                    // Member is already verified, so we can just return success.
                    return;
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
                if (normalizedTeamEventReferences.size > 0) {
                    const normalizedRegisteredEvents = buildNormalizedEventSet(registrationEvents);
                    if (hasEventOverlap(normalizedTeamEventReferences, normalizedRegisteredEvents)) {
                        throw new Error("You are already registered for one or more of these team events.");
                    }
                }

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
