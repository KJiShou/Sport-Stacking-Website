import type {Tournament, TournamentEvent} from "@/schema";
import {getEventLabel, getEventTypeOrderIndex, sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import type {Workbook, Worksheet} from "exceljs";

const TEMPLATE_ROW_COUNT = 120;
const TEAM_BLOCK_COUNT = 40;
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEMPLATE_MAPPING_SHEET_NAME = "__TemplateMapping";
const HEADER_FILL = "FFF4B183";
const EXAMPLE_FILL = "FFB4C6E7";
const INDIVIDUAL_EXAMPLE_FILL = "FFFFF2CC";
const AUTO_BORDER_COLOR = "FFFF0000";

type TemplateSheet = {
    sheetName: string;
    event: TournamentEvent;
    kind: "single" | "team" | "parent-child";
    teamSize?: number;
};

const toDate = (value: unknown): Date | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value;
    }
    if (value && typeof value === "object" && typeof (value as {toDate?: unknown}).toDate === "function") {
        const date = (value as {toDate: () => Date}).toDate();
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
};

const columnLetter = (column: number): string => {
    let current = column;
    let letter = "";
    while (current > 0) {
        const modulo = (current - 1) % 26;
        letter = String.fromCharCode(65 + modulo) + letter;
        current = Math.floor((current - modulo) / 26);
    }
    return letter;
};

const escapeFormulaText = (value: string): string => value.replace(/"/g, '""');

const sanitizeFilename = (value: string): string =>
    value
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);

const sanitizeSheetName = (value: string): string =>
    value
        .replace(/[\\/*?:[\]]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 31);

const uniqueSheetName = (baseName: string, usedSheetNames: Set<string>): string => {
    const sanitizedBase = sanitizeSheetName(baseName) || "Event";
    let candidate = sanitizedBase;
    let suffix = 2;

    while (usedSheetNames.has(candidate.toLowerCase())) {
        const suffixText = ` (${suffix})`;
        candidate = `${sanitizedBase.slice(0, 31 - suffixText.length)}${suffixText}`;
        suffix += 1;
    }

    usedSheetNames.add(candidate.toLowerCase());
    return candidate;
};

const getPreferredBaseSheetName = (event: TournamentEvent, duplicateTypeCount: number): string => {
    const baseNameByType: Partial<Record<TournamentEvent["type"], string>> = {
        Individual: "Individual",
        "Open Age Individual": "Individual",
        Double: "Doubles",
        "Team Relay": "Time Relay",
        "Parent & Child": "Child and Parent",
        "StackOut Champion": "StackOut Champion",
        "Stack Up Champion": "Stack Up Champion",
    };
    const baseName = baseNameByType[event.type] ?? event.type;
    if (duplicateTypeCount <= 1 || event.type.includes("Individual")) {
        return baseName;
    }

    const gender = event.gender === "Male" || event.gender === "Female" ? event.gender : "Mixed";
    const codes = sanitizeEventCodes(event.codes).join("-");
    return [baseName, gender, codes].filter(Boolean).join(" - ");
};

const getDefaultTeamSize = (event: TournamentEvent): number => {
    if (typeof event.teamSize === "number" && event.teamSize > 0) {
        return event.teamSize;
    }
    if (event.type === "Double" || event.type === "Parent & Child") {
        return 2;
    }
    if (event.type === "Team Relay") {
        return 4;
    }
    return 1;
};

const buildTemplateSheets = (events: TournamentEvent[]): TemplateSheet[] => {
    const sortedEvents = [...events].sort((a, b) => {
        const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
        if (orderDiff !== 0) {
            return orderDiff;
        }
        return getEventLabel(a).localeCompare(getEventLabel(b));
    });

    const individualEvent =
        sortedEvents.find((event) => event.type === "Individual") ??
        sortedEvents.find((event) => event.type.includes("Individual"));
    if (!individualEvent) {
        throw new Error("This tournament needs an Individual event before an import template can be generated.");
    }

    const typeCounts = sortedEvents.reduce(
        (counts, event) => {
            counts[event.type] = (counts[event.type] ?? 0) + 1;
            return counts;
        },
        {} as Record<string, number>,
    );
    const usedSheetNames = new Set<string>();
    const sheets: TemplateSheet[] = [
        {
            sheetName: uniqueSheetName("Individual", usedSheetNames),
            event: individualEvent,
            kind: "single",
        },
    ];

    for (const event of sortedEvents) {
        if (event === individualEvent || event.type.includes("Individual")) {
            continue;
        }

        const kind =
            event.type === "Parent & Child"
                ? "parent-child"
                : event.type === "Double" || event.type === "Team Relay"
                  ? "team"
                  : "single";
        const baseName = getPreferredBaseSheetName(event, typeCounts[event.type] ?? 1);
        sheets.push({
            sheetName: uniqueSheetName(baseName, usedSheetNames),
            event,
            kind,
            teamSize: getDefaultTeamSize(event),
        });
    }

    return sheets;
};

const buildDobDateFormula = (dobCell: string): string =>
    `IF(ISNUMBER(${dobCell}),${dobCell},DATE(VALUE(RIGHT(${dobCell},4)),VALUE(MID(${dobCell},4,2)),VALUE(LEFT(${dobCell},2))))`;

const buildAgeFormula = (dobCell: string, tournamentStartDate: Date): string =>
    `IF(${dobCell}="","",IFERROR(DATEDIF(${buildDobDateFormula(dobCell)},DATE(${tournamentStartDate.getFullYear()},${tournamentStartDate.getMonth() + 1},${tournamentStartDate.getDate()}),"Y"),""))`;

const buildAverageAgeFormula = (ageRange: string): string => `IFERROR(ROUND(AVERAGE(${ageRange}),0),"")`;

const buildGroupFormula = (ageCell: string, event: TournamentEvent): string => {
    const brackets = [...(event.age_brackets ?? [])]
        .filter((bracket) => Number.isFinite(bracket.min_age) && Number.isFinite(bracket.max_age) && bracket.name)
        .sort((a, b) => a.min_age - b.min_age);

    if (brackets.length === 0) {
        return `IF(${ageCell}="","",${ageCell})`;
    }

    // Use nested IF for Excel 2013+ compatibility (IFS requires Excel 2016+)
    let ageGroupFormula = "";
    for (const bracket of brackets) {
        const cond = `AND(${ageCell}>=${bracket.min_age},${ageCell}<=${bracket.max_age})`;
        const escapedName = escapeFormulaText(bracket.name);
        ageGroupFormula += `IF(${cond},"${escapedName}",`;
    }
    ageGroupFormula += `""${")".repeat(brackets.length)}`;
    return `IF(${ageCell}="","",IFERROR(${ageGroupFormula},""))`;
};

const styleTitleRow = (worksheet: Worksheet, title: string, lastColumn: number): void => {
    worksheet.mergeCells(1, 1, 1, lastColumn);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = title;
    titleCell.font = {bold: false, size: 20};
    titleCell.alignment = {horizontal: "center", vertical: "middle", wrapText: true};
    worksheet.getRow(1).height = 36;
};

const styleExampleRow = (worksheet: Worksheet, lastColumn: number, ageCol: number, groupCol: number): void => {
    const exampleRow = worksheet.getRow(2);
    exampleRow.height = 22;
    exampleRow.eachCell((cell) => {
        cell.font = {bold: false, color: {argb: "FF666666"}, size: 10};
        cell.alignment = {horizontal: "center", vertical: "middle"};
        cell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: "FFF2F2F2"}};
    });
    // Age and Group are auto-calculated, mark with a distinct grey
    worksheet.getCell(2, ageCol).fill = {type: "pattern", pattern: "solid", fgColor: {argb: "FFD9D9D9"}};
    worksheet.getCell(2, groupCol).fill = {type: "pattern", pattern: "solid", fgColor: {argb: "FFD9D9D9"}};
};

const styleHeaderRow = (worksheet: Worksheet, rowNumber: number): void => {
    const row = worksheet.getRow(rowNumber);
    row.height = 46;
    row.eachCell((cell) => {
        cell.font = {bold: true, color: {argb: "FF000000"}};
        cell.alignment = {horizontal: "center", vertical: "middle", wrapText: true};
        cell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: "FFF4B183"}};
        cell.border = {
            top: {style: "thin"},
            left: {style: "thin"},
            bottom: {style: "thin"},
            right: {style: "thin"},
        };
    });
};

const styleTeamRelayHeaderRow = (worksheet: Worksheet, rowNumber: number): void => {
    const row = worksheet.getRow(rowNumber);
    row.height = 76;
    row.eachCell((cell) => {
        cell.font = {bold: true, color: {argb: "FF000000"}};
        cell.alignment = {horizontal: "center", vertical: "middle", wrapText: true};
        cell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: HEADER_FILL}};
        cell.border = {
            top: {style: "thin"},
            left: {style: "thin"},
            bottom: {style: "thin"},
            right: {style: "thin"},
        };
    });
};

const styleClassicHeaderRow = (worksheet: Worksheet, rowNumber: number): void => {
    const row = worksheet.getRow(rowNumber);
    row.height = 106;
    row.eachCell((cell) => {
        cell.font = {bold: true, color: {argb: "FF000000"}, size: 12};
        cell.alignment = {horizontal: "center", vertical: "middle", wrapText: true};
        cell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: HEADER_FILL}};
        cell.border = {
            top: {style: "thin", color: {argb: "FF000000"}},
            left: {style: "thin", color: {argb: "FF000000"}},
            bottom: {style: "thin", color: {argb: "FF000000"}},
            right: {style: "thin", color: {argb: "FF000000"}},
        };
    });
};

const styleClassicDataCells = (worksheet: Worksheet, fromRow: number, toRow: number, toColumn: number): void => {
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 24;
        for (let column = 1; column <= toColumn; column += 1) {
            const cell = row.getCell(column);
            cell.alignment = {vertical: "middle", horizontal: column === 2 || column === 3 ? "left" : "center", wrapText: true};
            cell.border = {
                top: {style: "thin", color: {argb: "FF000000"}},
                left: {style: "thin", color: {argb: "FF000000"}},
                bottom: {style: "thin", color: {argb: "FF000000"}},
                right: {style: "thin", color: {argb: "FF000000"}},
            };
        }
    }
};

const fillRow = (worksheet: Worksheet, rowNumber: number, toColumn: number, color: string): void => {
    const row = worksheet.getRow(rowNumber);
    for (let column = 1; column <= toColumn; column += 1) {
        row.getCell(column).fill = {type: "pattern", pattern: "solid", fgColor: {argb: color}};
    }
};

const applyAutoAreaBorder = (
    worksheet: Worksheet,
    fromRow: number,
    toRow: number,
    fromColumn: number,
    toColumn: number,
): void => {
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        for (let column = fromColumn; column <= toColumn; column += 1) {
            const cell = worksheet.getCell(rowNumber, column);
            const border = cell.border ?? {};
            cell.border = {
                ...border,
                top: rowNumber === fromRow ? {style: "medium", color: {argb: AUTO_BORDER_COLOR}} : border.top,
                bottom: rowNumber === toRow ? {style: "medium", color: {argb: AUTO_BORDER_COLOR}} : border.bottom,
                left: column === fromColumn ? {style: "medium", color: {argb: AUTO_BORDER_COLOR}} : border.left,
                right: column === toColumn ? {style: "medium", color: {argb: AUTO_BORDER_COLOR}} : border.right,
            };
        }
    }
};

const styleDataCells = (worksheet: Worksheet, fromRow: number, toRow: number, toColumn: number): void => {
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 24;
        for (let column = 1; column <= toColumn; column += 1) {
            const cell = row.getCell(column);
            cell.alignment = {vertical: "middle", horizontal: column === 2 || column === 3 ? "left" : "center"};
            cell.border = {
                top: {style: "thin", color: {argb: "FFD9D9D9"}},
                left: {style: "thin", color: {argb: "FFD9D9D9"}},
                bottom: {style: "thin", color: {argb: "FFD9D9D9"}},
                right: {style: "thin", color: {argb: "FFD9D9D9"}},
            };
        }
    }
};

const styleTeamRelayDataCells = (worksheet: Worksheet, fromRow: number, toRow: number, toColumn: number): void => {
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.height = 24;
        for (let column = 1; column <= toColumn; column += 1) {
            const cell = row.getCell(column);
            cell.alignment = {vertical: "middle", horizontal: column === 3 || column === 4 ? "left" : "center", wrapText: true};
            cell.border = {
                top: {style: "thin", color: {argb: "FF000000"}},
                left: {style: "thin", color: {argb: "FF000000"}},
                bottom: {style: "thin", color: {argb: "FF000000"}},
                right: {style: "thin", color: {argb: "FF000000"}},
            };
        }
    }
};

const applyCommonWorksheetSettings = (worksheet: Worksheet): void => {
    worksheet.views = [{state: "frozen", ySplit: 3}];
    worksheet.pageSetup = {orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0};
};

const applyTeamRelayWorksheetSettings = (worksheet: Worksheet): void => {
    worksheet.views = [{state: "frozen", ySplit: 2}];
    worksheet.pageSetup = {orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0};
};

const addGenderValidation = (worksheet: Worksheet, column: number, fromRow: number, toRow: number): void => {
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        worksheet.getCell(rowNumber, column).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: ['"Male,Female"'],
            showErrorMessage: true,
            errorTitle: "Invalid gender",
            error: "Choose Male or Female.",
        };
    }
};

const addDobValidation = (worksheet: Worksheet, column: number, fromRow: number, toRow: number): void => {
    const columnName = columnLetter(column);
    for (let rowNumber = fromRow; rowNumber <= toRow; rowNumber += 1) {
        const cellAddress = `${columnName}${rowNumber}`;
        const parsedDate = `DATE(VALUE(RIGHT(${cellAddress},4)),VALUE(MID(${cellAddress},4,2)),VALUE(LEFT(${cellAddress},2)))`;
        worksheet.getCell(rowNumber, column).dataValidation = {
            type: "custom",
            allowBlank: true,
            formulae: [
                `OR(${cellAddress}="",ISNUMBER(${cellAddress}),AND(LEN(${cellAddress})=10,MID(${cellAddress},3,1)="/",MID(${cellAddress},6,1)="/",DAY(${parsedDate})=VALUE(LEFT(${cellAddress},2)),MONTH(${parsedDate})=VALUE(MID(${cellAddress},4,2)),YEAR(${parsedDate})=VALUE(RIGHT(${cellAddress},4))))`,
            ],
            showErrorMessage: true,
            errorTitle: "Invalid date of birth",
            error: "Enter Date of Birth as DD/MM/YYYY.",
        };
    }
};

const addSingleAthleteSheet = (
    workbook: Workbook,
    templateSheet: TemplateSheet,
    tournamentName: string,
    tournamentStartDate: Date,
): Worksheet => {
    const worksheet = workbook.addWorksheet(templateSheet.sheetName);
    const headers = [
        "No.",
        "Name\n(Please use name written on the Passport as standard name)",
        "Passport/IC",
        "Date of Birth\n(DD/MM/YYYY)",
        "Gender",
        "Age\n(Please do not fill in; it will be generated automatically)",
        "Group\n(Please do not fill in; it will be generated automatically)",
    ];
    const headerRowNumber = 2;
    const exampleRowNumber = 3;
    const firstDataRow = 4;
    const lastDataRow = firstDataRow + TEMPLATE_ROW_COUNT - 1;

    styleTitleRow(worksheet, `${tournamentName} Registration (${templateSheet.sheetName})`, headers.length);
    worksheet.getRow(headerRowNumber).values = headers;
    styleClassicHeaderRow(worksheet, headerRowNumber);
    worksheet.getRow(exampleRowNumber).values = ["EX:", "CHU AI SHEN", "A8909090", "14/06/2018", "Female", "", ""];
    worksheet.columns = [{width: 8}, {width: 28}, {width: 18}, {width: 18}, {width: 12}, {width: 18}, {width: 22}];

    worksheet.getCell(exampleRowNumber, 3).numFmt = "@";
    worksheet.getCell(exampleRowNumber, 4).numFmt = "@";
    worksheet.getCell(exampleRowNumber, 6).value = {
        formula: buildAgeFormula(`${columnLetter(4)}${exampleRowNumber}`, tournamentStartDate),
    };
    worksheet.getCell(exampleRowNumber, 7).value = {
        formula: buildGroupFormula(`${columnLetter(6)}${exampleRowNumber}`, templateSheet.event),
    };

    for (let rowNumber = firstDataRow; rowNumber <= lastDataRow; rowNumber += 1) {
        const row = worksheet.getRow(rowNumber);
        row.getCell(1).value = rowNumber - firstDataRow + 1;
        row.getCell(3).numFmt = "@"; // Force text format to preserve leading zeros (e.g. IC numbers)
        row.getCell(4).numFmt = "@"; // Accept DD/MM/YYYY as typed, independent of Excel locale
        const dobCell = `${columnLetter(4)}${rowNumber}`;
        const ageCell = `${columnLetter(6)}${rowNumber}`;
        row.getCell(6).value = {formula: buildAgeFormula(dobCell, tournamentStartDate)};
        row.getCell(7).value = {formula: buildGroupFormula(ageCell, templateSheet.event)};
    }

    addGenderValidation(worksheet, 5, exampleRowNumber, lastDataRow);
    addDobValidation(worksheet, 4, exampleRowNumber, lastDataRow);
    styleClassicDataCells(worksheet, exampleRowNumber, lastDataRow, headers.length);
    fillRow(worksheet, exampleRowNumber, headers.length, INDIVIDUAL_EXAMPLE_FILL);
    applyAutoAreaBorder(worksheet, headerRowNumber, lastDataRow, 6, 7);
    applyTeamRelayWorksheetSettings(worksheet);
    return worksheet;
};

const addTeamSheet = (
    workbook: Workbook,
    templateSheet: TemplateSheet,
    tournamentName: string,
    tournamentStartDate: Date,
): Worksheet => {
    const worksheet = workbook.addWorksheet(templateSheet.sheetName);
    const headers = ["No.", "Role", "Name", "Passport/IC", "Date of Birth", "Gender", "Country", "Age", "Group"];
    const headerRowNumber = 3;
    const exampleRowNumber = 2;
    const firstDataRow = 4;
    const teamSize = templateSheet.teamSize ?? 2;
    const lastDataRow = firstDataRow + TEAM_BLOCK_COUNT * teamSize - 1;

    styleTitleRow(worksheet, `${tournamentName} Registration - ${templateSheet.sheetName}`, headers.length);
    worksheet.getRow(headerRowNumber).values = headers;
    styleHeaderRow(worksheet, headerRowNumber);
    // Row 2: example values
    worksheet.getRow(exampleRowNumber).values = [
        0,
        templateSheet.kind === "parent-child" ? "Child:" : "Team Member",
        "Example Name",
        "A123456789",
        "",
        "Male",
        "Malaysia",
        "Auto",
        "Auto",
    ];
    worksheet.getCell(exampleRowNumber, 5).value = "DD/MM/YYYY";
    worksheet.getCell(exampleRowNumber, 5).font = {bold: false, color: {argb: "FF666666"}, size: 10};
    styleExampleRow(worksheet, headers.length, 8, 9);
    worksheet.columns = [
        {width: 8},
        {width: 14},
        {width: 28},
        {width: 20},
        {width: 18},
        {width: 12},
        {width: 18},
        {width: 10},
        {width: 22},
    ];

    for (let blockIndex = 0; blockIndex < TEAM_BLOCK_COUNT; blockIndex += 1) {
        const blockStartRow = firstDataRow + blockIndex * teamSize;
        const blockEndRow = blockStartRow + teamSize - 1;
        for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
            const rowNumber = blockStartRow + memberIndex;
            const row = worksheet.getRow(rowNumber);
            if (memberIndex === 0) {
                row.getCell(1).value = blockIndex + 1;
            }
            row.getCell(4).numFmt = "@"; // Force text format to preserve leading zeros (e.g. IC numbers)
            if (templateSheet.kind === "parent-child") {
                row.getCell(2).value = memberIndex === 0 ? "Child:" : "Parent:";
            }
            row.getCell(5).numFmt = "@"; // Accept DD/MM/YYYY as typed, independent of Excel locale
            const dobCell = `${columnLetter(5)}${rowNumber}`;
            const ageCell = `${columnLetter(8)}${rowNumber}`;
            row.getCell(8).value = {formula: buildAgeFormula(dobCell, tournamentStartDate)};
            row.getCell(9).value = {formula: buildGroupFormula(ageCell, templateSheet.event)};
        }
        if (teamSize > 1) {
            worksheet.mergeCells(blockStartRow, 1, blockEndRow, 1);
            worksheet.getCell(blockStartRow, 1).alignment = {vertical: "middle", horizontal: "center"};
        }
    }

    addGenderValidation(worksheet, 6, firstDataRow, lastDataRow);
    addDobValidation(worksheet, 5, firstDataRow, lastDataRow);
    styleDataCells(worksheet, firstDataRow, lastDataRow, headers.length);
    applyCommonWorksheetSettings(worksheet);
    return worksheet;
};

const addDoublesSheet = (
    workbook: Workbook,
    templateSheet: TemplateSheet,
    tournamentName: string,
    tournamentStartDate: Date,
): Worksheet => {
    const worksheet = workbook.addWorksheet(templateSheet.sheetName);
    const headers = [
        "No.",
        "Role",
        "Name\n(Please use name written on the Passport as standard name)",
        "Passport/IC",
        "Date of Birth\n(DD/MM/YYYY)",
        "Gender",
        "Age\n(Please do not fill in; it will be generated automatically)",
        "Average\n(Please do not fill in; it will be generated automatically)",
        "Group\n(Please do not fill in; it will be generated automatically)",
    ];
    const headerRowNumber = 2;
    const exampleStartRow = 3;
    const firstDataRow = 5;
    const teamSize = templateSheet.teamSize ?? 2;
    const lastDataRow = firstDataRow + TEAM_BLOCK_COUNT * teamSize - 1;

    styleTitleRow(worksheet, `${tournamentName} Registration (${templateSheet.sheetName})`, headers.length);
    worksheet.getRow(headerRowNumber).values = headers;
    styleClassicHeaderRow(worksheet, headerRowNumber);
    worksheet.columns = [
        {width: 8},
        {width: 14},
        {width: 30},
        {width: 18},
        {width: 18},
        {width: 12},
        {width: 18},
        {width: 18},
        {width: 28},
    ];

    const writeBlock = (blockIndex: number, blockStartRow: number, isExample: boolean): void => {
        const blockEndRow = blockStartRow + teamSize - 1;
        const averageCell = `${columnLetter(8)}${blockStartRow}`;
        const ageRange = `${columnLetter(7)}${blockStartRow}:${columnLetter(7)}${blockEndRow}`;
        for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
            const rowNumber = blockStartRow + memberIndex;
            const row = worksheet.getRow(rowNumber);
            if (memberIndex === 0) {
                row.getCell(1).value = isExample ? "EX:" : blockIndex + 1;
                row.getCell(8).value = {formula: buildAverageAgeFormula(ageRange)};
                row.getCell(9).value = {formula: buildGroupFormula(averageCell, templateSheet.event)};
            }
            row.getCell(2).value = `Player ${memberIndex + 1}:`;
            row.getCell(4).numFmt = "@";
            row.getCell(5).numFmt = "@";
            const dobCell = `${columnLetter(5)}${rowNumber}`;
            row.getCell(7).value = {formula: buildAgeFormula(dobCell, tournamentStartDate)};
        }
        worksheet.mergeCells(blockStartRow, 1, blockEndRow, 1);
        worksheet.mergeCells(blockStartRow, 8, blockEndRow, 8);
        worksheet.mergeCells(blockStartRow, 9, blockEndRow, 9);
        for (const column of [1, 8, 9]) {
            worksheet.getCell(blockStartRow, column).alignment = {vertical: "middle", horizontal: "center", wrapText: true};
        }
    };

    writeBlock(0, exampleStartRow, true);
    worksheet.getCell(exampleStartRow, 3).value = "KEITH WEE JIA SHENG";
    worksheet.getCell(exampleStartRow, 4).value = "A8909090";
    worksheet.getCell(exampleStartRow, 5).value = "06/06/2017";
    worksheet.getCell(exampleStartRow, 6).value = "Male";
    worksheet.getCell(exampleStartRow + 1, 3).value = "LEE KA SHING";
    worksheet.getCell(exampleStartRow + 1, 4).value = "051223109999";
    worksheet.getCell(exampleStartRow + 1, 5).value = "23/12/2014";
    worksheet.getCell(exampleStartRow + 1, 6).value = "Male";

    for (let blockIndex = 0; blockIndex < TEAM_BLOCK_COUNT; blockIndex += 1) {
        writeBlock(blockIndex, firstDataRow + blockIndex * teamSize, false);
    }

    addGenderValidation(worksheet, 6, exampleStartRow, lastDataRow);
    addDobValidation(worksheet, 5, exampleStartRow, lastDataRow);
    styleClassicDataCells(worksheet, exampleStartRow, lastDataRow, headers.length);
    for (let rowNumber = exampleStartRow; rowNumber < firstDataRow; rowNumber += 1) {
        fillRow(worksheet, rowNumber, headers.length, EXAMPLE_FILL);
    }
    applyAutoAreaBorder(worksheet, headerRowNumber, lastDataRow, 7, 9);
    applyTeamRelayWorksheetSettings(worksheet);
    return worksheet;
};

const addParentChildSheet = (
    workbook: Workbook,
    templateSheet: TemplateSheet,
    tournamentName: string,
    tournamentStartDate: Date,
): Worksheet => {
    const worksheet = workbook.addWorksheet(templateSheet.sheetName);
    const headers = [
        "No.",
        "Role",
        "Name\n(Please use name written on the Passport as standard name)",
        "Passport/IC",
        "Date of Birth\n(DD/MM/YYYY)",
        "Gender",
        "Age\n(Please do not fill in; it will be generated automatically)",
        "Group\n(Please do not fill in; it will be generated automatically)",
    ];
    const headerRowNumber = 2;
    const exampleStartRow = 3;
    const firstDataRow = 5;
    const teamSize = 2;
    const lastDataRow = firstDataRow + TEAM_BLOCK_COUNT * teamSize - 1;

    styleTitleRow(worksheet, `${tournamentName} Registration (${templateSheet.sheetName})`, headers.length);
    worksheet.getRow(headerRowNumber).values = headers;
    styleClassicHeaderRow(worksheet, headerRowNumber);
    worksheet.columns = [{width: 8}, {width: 18}, {width: 30}, {width: 18}, {width: 18}, {width: 12}, {width: 18}, {width: 24}];

    const writeBlock = (blockIndex: number, blockStartRow: number, isExample: boolean): void => {
        const blockEndRow = blockStartRow + teamSize - 1;
        const childAgeCell = `${columnLetter(7)}${blockStartRow}`;
        for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
            const rowNumber = blockStartRow + memberIndex;
            const row = worksheet.getRow(rowNumber);
            if (memberIndex === 0) {
                row.getCell(1).value = isExample ? "EX:" : blockIndex + 1;
                row.getCell(7).value = {formula: buildAgeFormula(`${columnLetter(5)}${rowNumber}`, tournamentStartDate)};
                row.getCell(8).value = {formula: buildGroupFormula(childAgeCell, templateSheet.event)};
            }
            row.getCell(2).value = memberIndex === 0 ? "Child:" : "Parent:";
            row.getCell(4).numFmt = "@";
            row.getCell(5).numFmt = "@";
        }
        worksheet.mergeCells(blockStartRow, 1, blockEndRow, 1);
        worksheet.mergeCells(blockStartRow, 8, blockEndRow, 8);
        for (const column of [1, 8]) {
            worksheet.getCell(blockStartRow, column).alignment = {vertical: "middle", horizontal: "center", wrapText: true};
        }
    };

    writeBlock(0, exampleStartRow, true);
    worksheet.getCell(exampleStartRow, 3).value = "KEITH WEE JIA SHENG";
    worksheet.getCell(exampleStartRow, 4).value = "A8909090";
    worksheet.getCell(exampleStartRow, 5).value = "06/06/2017";
    worksheet.getCell(exampleStartRow, 6).value = "Male";
    worksheet.getCell(exampleStartRow + 1, 3).value = "WEE WEI KIAT";
    worksheet.getCell(exampleStartRow + 1, 4).value = "701010109999";
    worksheet.getCell(exampleStartRow + 1, 6).value = "Male";

    for (let blockIndex = 0; blockIndex < TEAM_BLOCK_COUNT; blockIndex += 1) {
        writeBlock(blockIndex, firstDataRow + blockIndex * teamSize, false);
    }

    addGenderValidation(worksheet, 6, exampleStartRow, lastDataRow);
    addDobValidation(worksheet, 5, exampleStartRow, lastDataRow);
    styleClassicDataCells(worksheet, exampleStartRow, lastDataRow, headers.length);
    for (let rowNumber = exampleStartRow; rowNumber < firstDataRow; rowNumber += 1) {
        fillRow(worksheet, rowNumber, headers.length, EXAMPLE_FILL);
    }
    applyAutoAreaBorder(worksheet, headerRowNumber, lastDataRow, 7, 8);
    applyTeamRelayWorksheetSettings(worksheet);
    return worksheet;
};

const addTeamRelaySheet = (
    workbook: Workbook,
    templateSheet: TemplateSheet,
    tournamentName: string,
    tournamentStartDate: Date,
): Worksheet => {
    const worksheet = workbook.addWorksheet(templateSheet.sheetName);
    const headers = [
        "No.",
        "Member",
        "Team Name",
        "Name",
        "Passport/IC",
        "Date of Birth\n(DD/MM/YYYY)",
        "Gender",
        "Age\n(Do not fill in; it will be generated automatically)",
        "Average\n(Do not fill in; it will be generated automatically)",
        "Group\n(Do not fill in; it will be generated automatically)",
    ];
    const headerRowNumber = 2;
    const teamSize = templateSheet.teamSize ?? 4;
    const exampleStartRow = 3;
    const firstDataRow = exampleStartRow + teamSize;
    const lastDataRow = firstDataRow + TEAM_BLOCK_COUNT * teamSize - 1;

    styleTitleRow(worksheet, `${tournamentName} Registration (${templateSheet.sheetName})`, headers.length);
    worksheet.getRow(headerRowNumber).values = headers;
    styleClassicHeaderRow(worksheet, headerRowNumber);
    worksheet.columns = [
        {width: 8},
        {width: 10},
        {width: 24},
        {width: 30},
        {width: 18},
        {width: 18},
        {width: 12},
        {width: 18},
        {width: 14},
        {width: 28},
    ];

    const writeBlock = (blockIndex: number, blockStartRow: number, isExample: boolean): void => {
        const blockEndRow = blockStartRow + teamSize - 1;
        const averageCell = `${columnLetter(9)}${blockStartRow}`;
        const ageRange = `${columnLetter(8)}${blockStartRow}:${columnLetter(8)}${blockEndRow}`;

        for (let memberIndex = 0; memberIndex < teamSize; memberIndex += 1) {
            const rowNumber = blockStartRow + memberIndex;
            const row = worksheet.getRow(rowNumber);
            if (memberIndex === 0) {
                row.getCell(1).value = isExample ? "EX:" : blockIndex + 1;
                row.getCell(9).value = {formula: buildAverageAgeFormula(ageRange)};
                row.getCell(10).value = {formula: buildGroupFormula(averageCell, templateSheet.event)};
            }
            row.getCell(2).value = memberIndex + 1;
            row.getCell(5).numFmt = "@"; // Force text format to preserve leading zeros (e.g. IC numbers)
            row.getCell(6).numFmt = "@"; // Accept DD/MM/YYYY as typed, independent of Excel locale
            const dobCell = `${columnLetter(6)}${rowNumber}`;
            row.getCell(8).value = {formula: buildAgeFormula(dobCell, tournamentStartDate)};
        }

        worksheet.mergeCells(blockStartRow, 1, blockEndRow, 1);
        worksheet.mergeCells(blockStartRow, 3, blockEndRow, 3);
        worksheet.mergeCells(blockStartRow, 9, blockEndRow, 9);
        worksheet.mergeCells(blockStartRow, 10, blockEndRow, 10);
        for (const column of [1, 3, 9, 10]) {
            worksheet.getCell(blockStartRow, column).alignment = {vertical: "middle", horizontal: "center", wrapText: true};
        }
    };

    writeBlock(0, exampleStartRow, true);
    const exampleNames = ["KEITH WEE JIA SHENG", "LEE KA SHING", "CHU AI SHEN", "VINNY KOO QIAN EE", "WOO CHEN XI"];
    const exampleIdentityNumbers = ["A8909090", "051223109999", "120614109999", "971025109999", "060414109999"];
    const exampleDobs = ["06/06/2017", "23/12/2014", "14/06/2018", "25/10/1997", "14/04/2006"];
    const exampleGenders = ["Male", "Male", "Female", "Female", "Female"];
    worksheet.getCell(exampleStartRow, 3).value = "MY ALL STAR";
    for (let memberIndex = 0; memberIndex < Math.min(teamSize, exampleNames.length); memberIndex += 1) {
        worksheet.getCell(exampleStartRow + memberIndex, 4).value = exampleNames[memberIndex];
        worksheet.getCell(exampleStartRow + memberIndex, 5).value = exampleIdentityNumbers[memberIndex];
        worksheet.getCell(exampleStartRow + memberIndex, 6).value = exampleDobs[memberIndex];
        worksheet.getCell(exampleStartRow + memberIndex, 7).value = exampleGenders[memberIndex];
    }

    for (let blockIndex = 0; blockIndex < TEAM_BLOCK_COUNT; blockIndex += 1) {
        writeBlock(blockIndex, firstDataRow + blockIndex * teamSize, false);
    }

    addGenderValidation(worksheet, 7, exampleStartRow, lastDataRow);
    addDobValidation(worksheet, 6, exampleStartRow, lastDataRow);
    styleTeamRelayDataCells(worksheet, exampleStartRow, lastDataRow, headers.length);
    for (let rowNumber = exampleStartRow; rowNumber < firstDataRow; rowNumber += 1) {
        fillRow(worksheet, rowNumber, headers.length, EXAMPLE_FILL);
    }
    applyAutoAreaBorder(worksheet, headerRowNumber, lastDataRow, 8, 10);
    applyTeamRelayWorksheetSettings(worksheet);
    return worksheet;
};

const addMappingSheet = (workbook: Workbook, templateSheets: TemplateSheet[]): void => {
    const worksheet = workbook.addWorksheet(TEMPLATE_MAPPING_SHEET_NAME, {state: "veryHidden"});
    worksheet.addRow(["sheet_name", "event_id", "event_type"]);
    for (const templateSheet of templateSheets) {
        worksheet.addRow([templateSheet.sheetName, templateSheet.event.id ?? "", templateSheet.event.type]);
    }
};

const triggerWorkbookDownload = async (workbook: Workbook, fileName: string): Promise<void> => {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as BlobPart], {type: MIME_XLSX});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

export const downloadTournamentImportTemplate = async ({
    tournament,
    events,
}: {
    tournament: Tournament | null;
    events: TournamentEvent[];
}): Promise<void> => {
    const tournamentName = tournament?.name?.trim() || "Tournament";
    const tournamentStartDate = toDate(tournament?.start_date) ?? new Date();
    const templateSheets = buildTemplateSheets(events);
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "RankingStack";
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;

    for (const templateSheet of templateSheets) {
        if (templateSheet.kind === "single") {
            addSingleAthleteSheet(workbook, templateSheet, tournamentName, tournamentStartDate);
        } else if (templateSheet.event.type === "Double") {
            addDoublesSheet(workbook, templateSheet, tournamentName, tournamentStartDate);
        } else if (templateSheet.event.type === "Team Relay") {
            addTeamRelaySheet(workbook, templateSheet, tournamentName, tournamentStartDate);
        } else if (templateSheet.event.type === "Parent & Child") {
            addParentChildSheet(workbook, templateSheet, tournamentName, tournamentStartDate);
        } else {
            addTeamSheet(workbook, templateSheet, tournamentName, tournamentStartDate);
        }
    }

    addMappingSheet(workbook, templateSheets);

    const safeTournamentName = sanitizeFilename(tournamentName) || "tournament";
    await triggerWorkbookDownload(workbook, `${safeTournamentName}-import-template.xlsx`);
};
