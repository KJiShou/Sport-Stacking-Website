// src/utils/pdfExportUtils.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {nanoid} from "nanoid";
import type {AgeBracket, Registration, Team, Tournament} from "../../schema";

// Types
interface ExportPDFOptions {
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

interface ExportMasterListOptions {
    tournament: Tournament;
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>;
}

interface EventData {
    event: Tournament["events"][number];
    bracket: Tournament["events"][number]["age_brackets"][number];
    isTeamEvent: boolean;
    registrations: Registration[];
}

// Utility Functions
const isTeamEventType = (type: string): boolean => ["double", "team relay", "parent & child"].includes(type.toLowerCase());

const createPDFFilename = (parts: string[]): string =>
    parts
        .join("_")
        .replace(/[^a-z0-9_.-]/gi, "_")
        .toLowerCase();

const openPDFInNewTab = (doc: jsPDF, filename: string): void => {
    const pdfOutput = doc.output("bloburl");
    const newWindow = window.open("", "_blank");
    if (newWindow) {
        newWindow.location.href = pdfOutput.toString();
        newWindow.document.title = filename;
    } else {
        throw new Error("Please allow popups to preview PDF");
    }
};

const addPDFFooter = (doc: jsPDF): void => {
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
            `Generated on ${new Date().toLocaleString()} - Page ${i} of ${pageCount}`,
            14,
            doc.internal.pageSize.height - 10,
        );
    }
};

async function fetchImageFixedOrientation(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            // 创建canvas
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) return reject("Cannot get 2D context");

            // 直接以图像尺寸创建canvas
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);

            // 将画好的canvas导出
            const dataURL = canvas.toDataURL("image/png");
            resolve(dataURL);
        };
        img.onerror = reject;
        img.src = URL.createObjectURL(blob);
    });
}

// Core PDF Generation Functions
const generateTeamTableData = (
    teams: Team[],
    eventKey: string,
    bracket: AgeBracket,
    ageMap: Record<string, number>,
    phoneMap: Record<string, string>,
): string[][] => {
    return teams
        .filter((team) => {
            if (!team.events.includes(eventKey)) return false;
            const ages: number[] = [];
            if (team.leader_id && ageMap[team.leader_id] != null) {
                ages.push(ageMap[team.leader_id]);
            }
            for (const m of team.members) {
                if (m.global_id && ageMap[m.global_id] != null) {
                    ages.push(ageMap[m.global_id]);
                }
            }
            const maxAge = ages.length > 0 ? Math.max(...ages) : -1;
            return maxAge >= bracket.min_age && maxAge <= bracket.max_age;
        })
        .map((team, index) => {
            const leaderPhone = team.leader_id ? phoneMap[team.leader_id] || "N/A" : "N/A";
            const ages: number[] = [];
            if (team.leader_id && ageMap[team.leader_id] != null) {
                ages.push(ageMap[team.leader_id]);
            }
            for (const m of team.members) {
                if (m.global_id && ageMap[m.global_id] != null) {
                    ages.push(ageMap[m.global_id]);
                }
            }
            const maxAge = ages.length > 0 ? Math.max(...ages) : -1;
            return [
                (index + 1).toString(),
                team.leader_id ?? "N/A",
                team.name,
                team.members.map((m) => m.global_id).join(", "),
                leaderPhone,
                maxAge === -1 ? "N/A" : maxAge.toString(),
            ];
        });
};

const generateIndividualTableData = (
    registrations: Registration[],
    bracket: AgeBracket,
    phoneMap: Record<string, string>,
): string[][] => {
    return registrations
        .filter((r) => r.age >= bracket.min_age && r.age <= bracket.max_age)
        .map((r, index) => [(index + 1).toString(), r.user_id, r.user_name, r.age.toString(), phoneMap[r.user_id] || "N/A"]);
};

const generateSingleTeamTableData = (team: Team, phoneMap: Record<string, string>): string[][] => {
    const teamData: string[][] = [];

    // Add leader
    teamData.push([
        "1",
        team.leader_id,
        "Leader", // Role
        phoneMap[team.leader_id] || "N/A",
    ]);

    // Add members
    team.members.forEach((member, index) => {
        teamData.push([
            (index + 2).toString(),
            member.global_id,
            "Member", // Role
            phoneMap[member.global_id] || "N/A",
        ]);
    });

    return teamData;
};

// Main Export Functions
export const exportParticipantListToPDF = async (options: ExportPDFOptions): Promise<void> => {
    const {
        tournament,
        eventKey,
        bracketName,
        registrations,
        ageMap,
        phoneMap,
        searchTerm = "",
        isTeamEvent,
        team,
        teams = [],
    } = options;
    const marginY = 10;

    try {
        const event = tournament.events?.find((evt) => `${evt.code}-${evt.type}` === eventKey);
        const bracket = event?.age_brackets.find((br) => br.name === bracketName);

        if (!event || !bracket) throw new Error("Event or bracket not found");

        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginX = 14;
        const logoWidth = 40;
        const titleMaxWidth = pageWidth - marginX * 2 - logoWidth;

        // Header
        doc.setFont("times", "bold");
        doc.setFontSize(25);
        const title = team ? `${team.name} Member List` : `${event.type} ${bracket.name} Name List`;
        const titleLines = doc.splitTextToSize(title, titleMaxWidth);
        doc.text(titleLines, marginX, marginY + 20);

        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        if (logoDataUrl) {
            try {
                doc.addImage(logoDataUrl, undefined, pageWidth - marginX - logoWidth + 5, marginY + 5, 30, 30);
            } catch (error) {
                console.error("Error adding logo to PDF:", error);
                doc.setFontSize(8);
                doc.text("LOGO", pageWidth - marginX - logoWidth + 15, marginY + 20);
            }
        } else {
            doc.setFontSize(8);
            doc.text("LOGO", pageWidth - marginX - logoWidth + 15, marginY + 20);
        }

        const titleHeight = titleLines.length * 10; // Approximate height of the title
        let currentY = marginY + 20 + titleHeight;

        if (searchTerm && !team) {
            doc.setFontSize(10);
            doc.text(`Filtered by: "${searchTerm}"`, 14, currentY);
        }
        currentY += 10;

        doc.line(14, currentY, doc.internal.pageSize.width - 14, currentY);
        currentY += 10;
        doc.setFontSize(12);
        doc.text(`${tournament.venue} ${tournament.name}`, 14, currentY);
        currentY += 10;

        const startY = currentY;

        // Generate table data
        const tableData = team
            ? generateSingleTeamTableData(team, phoneMap)
            : isTeamEvent
              ? generateTeamTableData(teams, eventKey, bracket, ageMap, phoneMap)
              : generateIndividualTableData(registrations, bracket, phoneMap);

        const headers = team
            ? [["No.", "Global ID", "Role", "Phone Number"]]
            : isTeamEvent
              ? [["No.", "Team Leader", "Team Name", "Members", "Leader Phone", "Largest Age"]]
              : [["No.", "Global ID", "Name", "Age", "Phone Number"]];

        const columnStyles = team
            ? {0: {cellWidth: 10}, 1: {cellWidth: 40}, 2: {cellWidth: 40}, 3: {cellWidth: 40}}
            : isTeamEvent
              ? {
                    0: {cellWidth: 10},
                    1: {cellWidth: 25},
                    2: {cellWidth: 35},
                    3: {cellWidth: 50},
                    4: {cellWidth: 30},
                    5: {cellWidth: 20},
                }
              : {0: {cellWidth: 10}, 1: {cellWidth: 32}, 2: {cellWidth: 90}, 3: {cellWidth: 20}, 4: {cellWidth: 30}};

        autoTable(doc, {
            startY,
            head: headers,
            body: tableData,
            theme: "plain",
            styles: {
                fontSize: isTeamEvent || team ? 9 : 10,
                lineColor: [0, 0, 0],
                lineWidth: 0.1,
                textColor: [0, 0, 0],
                font: "times",
            },
            headStyles: {
                fillColor: [255, 255, 255],
                textColor: [0, 0, 0],
                lineColor: [0, 0, 0],
                lineWidth: 0.1,
                font: "times",
                fontStyle: "bold",
            },
            columnStyles,
        });

        addPDFFooter(doc);
        const filename = team
            ? createPDFFilename([tournament.name, team.name, "member_list.pdf"])
            : createPDFFilename([tournament.name, event.code, bracket.name, "participants.pdf"]);
        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating PDF:", error);
        throw error;
    }
};

export const exportMasterListToPDF = async (options: ExportMasterListOptions): Promise<void> => {
    const {tournament, registrations, ageMap, phoneMap} = options;
    const marginY = 10;

    try {
        const doc = new jsPDF();
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginX = 14;
        const logoWidth = 40;
        const titleMaxWidth = pageWidth - marginX * 2 - logoWidth;

        // Header
        doc.setFont("times", "bold");
        doc.setFontSize(25);
        const title = `${tournament.venue} ${tournament.name} - Master Participant List`;
        const titleLines = doc.splitTextToSize(title, titleMaxWidth);
        doc.text(titleLines, marginX, marginY + 20);

        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        if (logoDataUrl) {
            try {
                doc.addImage(logoDataUrl, undefined, pageWidth - marginX - logoWidth + 5, marginY + 5, 30, 30);
            } catch (error) {
                console.error("Error adding logo to PDF:", error);
                doc.setFontSize(8);
                doc.text("LOGO", pageWidth - marginX - logoWidth + 15, marginY + 20);
            }
        } else {
            doc.setFontSize(8);
            doc.text("LOGO", pageWidth - marginX - logoWidth + 15, marginY + 20);
        }

        const titleHeight = titleLines.length * 10; // Approximate height of the title
        let currentY = marginY + 20 + titleHeight;

        doc.line(14, currentY, doc.internal.pageSize.width - 14, currentY);
        currentY += 10;
        doc.setFontSize(12);
        doc.text(`Total Participants: ${registrations.length}`, 14, currentY);
        currentY += 7;

        const startY = currentY;

        const tableData = registrations.map((r, index) => [
            (index + 1).toString(),
            r.user_id || "N/A",
            r.user_name || "N/A",
            ageMap[r.user_id]?.toString() || "N/A",
            phoneMap[r.user_id] || "N/A",
            (r.events_registered || []).join(", ") || "None",
        ]);

        autoTable(doc, {
            startY,
            head: [["No.", "Global ID", "Name", "Age", "Phone", "Events Registered"]],
            body: tableData,
            theme: "plain",
            styles: {
                fontSize: 9,
                lineColor: [0, 0, 0],
                lineWidth: 0.1,
                textColor: [0, 0, 0],
                font: "times",
            },
            headStyles: {
                fillColor: [255, 255, 255],
                textColor: [0, 0, 0],
                lineColor: [0, 0, 0],
                lineWidth: 0.1,
                font: "times",
                fontStyle: "bold",
            },
            columnStyles: {
                0: {cellWidth: 10},
                1: {cellWidth: 25},
                2: {cellWidth: 40},
                3: {cellWidth: 15},
                4: {cellWidth: 30},
                5: {cellWidth: 60},
            },
        });

        addPDFFooter(doc);
        const filename = createPDFFilename([tournament.name, "master_participant_list.pdf"]);
        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating master list PDF:", error);
        throw error;
    }
};

export const exportAllBracketsListToPDF = async (
    tournament: Tournament,
    registrations: Registration[],
    teams: Team[],
    ageMap: Record<string, number>,
    phoneMap: Record<string, string>,
): Promise<void> => {
    try {
        const doc = new jsPDF();
        doc.setFont("times");
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginX = 14;
        const logoWidth = 40;
        const titleMaxWidth = pageWidth - marginX * 2 - logoWidth;

        // Header
        doc.setFont("times", "bold");
        doc.setFontSize(25);
        const title = `${tournament.name} - All Events & Brackets`;
        const titleLines = doc.splitTextToSize(title, titleMaxWidth);
        doc.text(titleLines, marginX, 20);

        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        if (logoDataUrl) {
            try {
                doc.addImage(logoDataUrl, undefined, pageWidth - marginX - logoWidth + 5, 10, 30, 30);
            } catch (error) {
                console.error("Error adding logo to PDF:", error);
                doc.setFontSize(8);
                doc.text("LOGO", pageWidth - marginX - logoWidth + 15, 20);
            }
        } else {
            doc.setFontSize(8);
            doc.text("LOGO", pageWidth - marginX - logoWidth + 15, 20);
        }

        const titleHeight = titleLines.length * 10; // Approximate height of the title
        let currentY = 25 + titleHeight;

        doc.line(14, currentY, doc.internal.pageSize.width - 14, currentY);
        currentY += 10;
        doc.setFontSize(12);
        doc.text(`Total Events: ${tournament.events.length}`, 14, currentY);
        currentY += 7;

        let startY = currentY;
        let isFirstEvent = true;

        for (const event of tournament.events) {
            const eventKey = `${event.code}-${event.type}`;
            const isTeamEvent = isTeamEventType(event.type);

            if (!isFirstEvent) {
                doc.addPage();
                startY = 20;
            }
            isFirstEvent = false;

            doc.setFontSize(16);
            doc.setFont(undefined, "bold");
            doc.text(`${event.code} - ${event.type}`, 14, startY);
            startY += 10;

            for (const bracket of event.age_brackets) {
                doc.setFontSize(14);
                doc.text(`${bracket.name} (Ages ${bracket.min_age}-${bracket.max_age})`, 20, startY);
                startY += 8;

                const tableData = isTeamEvent
                    ? generateTeamTableData(teams, eventKey, bracket, ageMap, phoneMap)
                    : registrations
                          .filter(
                              (r) =>
                                  r.events_registered.includes(eventKey) && r.age >= bracket.min_age && r.age <= bracket.max_age,
                          )
                          .map((r, index) => [
                              (index + 1).toString(),
                              r.user_name || "N/A",
                              r.user_id || "N/A",
                              r.age?.toString() || "N/A",
                              phoneMap[r.user_id] || "N/A",
                          ]);

                if (tableData.length > 0) {
                    const headers = isTeamEvent
                        ? [["No.", "Team Leader", "Team Name", "Members", "Leader Phone", "Largest Age"]]
                        : [["No.", "Name", "Global ID", "Age", "Phone"]];

                    const columnStyles = isTeamEvent
                        ? {
                              0: {cellWidth: 10},
                              1: {cellWidth: 25},
                              2: {cellWidth: 35},
                              3: {cellWidth: 50},
                              4: {cellWidth: 30},
                              5: {cellWidth: 20},
                          }
                        : {0: {cellWidth: 10}, 1: {cellWidth: 60}, 2: {cellWidth: 40}, 3: {cellWidth: 20}, 4: {cellWidth: 30}};

                    autoTable(doc, {
                        startY,
                        head: headers,
                        body: tableData,
                        theme: "plain",
                        styles: {
                            fontSize: 9,
                            lineColor: [0, 0, 0],
                            lineWidth: 0.1,
                            textColor: [0, 0, 0],
                            font: "times",
                        },
                        headStyles: {
                            fillColor: [255, 255, 255],
                            textColor: [0, 0, 0],
                            lineColor: [0, 0, 0],
                            lineWidth: 0.1,
                            font: "times",
                            fontStyle: "bold",
                        },
                        columnStyles,
                        margin: {left: 20},
                    });

                    startY = (doc as jsPDF & {lastAutoTable?: {finalY: number}}).lastAutoTable?.finalY + 10 || startY + 20;
                } else {
                    doc.setFontSize(10);
                    doc.text("No participants registered", 25, startY);
                    startY += 10;
                }

                if (startY > doc.internal.pageSize.height - 40) {
                    doc.addPage();
                    startY = 20;
                }
            }
        }

        addPDFFooter(doc);
        const filename = createPDFFilename([tournament.name, "all_brackets_list.pdf"]);
        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating all brackets PDF:", error);
        throw error;
    }
};

// Stacking Sheet Functions
export const generateStackingSheetPDF = async (
    tournament: Tournament,
    participants: Registration[],
    ageMap: Record<string, number>,
    division: string,
    options: {logoUrl?: string; includeAllParticipants?: boolean; participantId?: string} = {},
    sheetType = "Individual",
): Promise<void> => {
    try {
        const doc = new jsPDF();
        const targetParticipants = options.participantId
            ? participants.filter((p) => p.user_id === options.participantId)
            : participants;

        if (targetParticipants.length === 0) {
            throw new Error("No participants found to generate sheets for");
        }

        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        targetParticipants.forEach((participant, index) => {
            if (index > 0) doc.addPage();
            generateSingleStackingSheet(doc, tournament, participant, ageMap, logoDataUrl, division, sheetType);
        });

        const filename = options.participantId
            ? createPDFFilename([tournament.name, options.participantId, "timesheet.pdf"])
            : createPDFFilename([tournament.name, "all_timesheets.pdf"]);

        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating stacking sheet PDF:", error);
        throw error;
    }
};

export const generateTeamStackingSheetPDF = async (
    tournament: Tournament,
    team: Team,
    ageMap: Record<string, number>,
    division: string,
    options: {logoUrl?: string} = {},
    sheetType = "Team",
): Promise<void> => {
    try {
        const doc = new jsPDF();
        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        generateSingleStackingSheet(doc, tournament, team, ageMap, logoDataUrl, division, sheetType);

        const filename = createPDFFilename([tournament.name, team.name, "timesheet.pdf"]);
        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating stacking sheet PDF:", error);
        throw error;
    }
};

const generateSingleStackingSheet = (
    doc: jsPDF,
    tournament: Tournament,
    participant: Registration | Team,
    ageMap: Record<string, number>,
    logoDataUrl: string,
    division: string,
    sheetType = "",
): void => {
    const pageWidth = doc.internal.pageSize.getWidth();
    const marginX = 5;
    const contentMaxHeight = 148; // Upper half of A4
    const startY = 5;
    const sectionSpacing = 6;

    doc.setFont("times", "normal");

    // === 1. Outer Title Frame ===
    const titleHeight = 25;
    doc.setLineWidth(0.1);
    doc.rect(marginX, startY, pageWidth - 2 * marginX, titleHeight);

    // Logo placeholder (left box)
    doc.rect(marginX, startY, 40, titleHeight);
    // Add logo image if available
    if (logoDataUrl) {
        try {
            doc.addImage(logoDataUrl, undefined, marginX + 2, startY + 2, 36, titleHeight - 4);
        } catch (error) {
            console.error("Error adding logo to PDF:", error);
            doc.setFontSize(8);
            doc.text("LOGO", marginX + 15, startY + 14);
        }
    } else {
        doc.setFontSize(8);
        doc.text("LOGO", marginX + 15, startY + 14);
    }

    // Title text (right side)
    doc.setFont("times", "bold");
    doc.setFontSize(16);
    doc.text(`${tournament.venue}`, pageWidth / 2 + 20, startY + 10, {align: "center"});
    doc.text(`${tournament.name}`, pageWidth / 2 + 20, startY + 18, {align: "center"});

    // === 2. Subtitle ===
    doc.setFontSize(11);
    doc.setFont("times", "bold");
    doc.text(`${sheetType} Prelim`, marginX, startY + titleHeight + 8);
    const sheetTypeWidth = marginX + doc.getTextWidth(`${sheetType} Prelim`);
    doc.setFont("times", "normal");
    doc.text("Time Sheet", sheetTypeWidth + 1, startY + titleHeight + 8);

    // === 3. Participant Info ===
    const infoY = startY + titleHeight + 15;

    // Name and ID based on sheet type
    if (sheetType !== "Individual") {
        const team = participant as Team;
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text("Team Name: ", marginX, infoY);
        const nameX = marginX + doc.getTextWidth("Team Name: ");
        doc.setFont("times", "bold");
        doc.setFontSize(14);
        doc.text(team.name || "________________________", nameX, infoY);

        const nameHeight = 8;
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text(`Division: ${division || "___"}`, marginX, infoY + sectionSpacing);
        const allMembers = [team.leader_id, ...(team.members || []).map((m) => m.global_id)];
        doc.text(`IDs: ${allMembers.join(", ")}`, marginX, infoY + sectionSpacing * 2);

        // ID box (right top)
        const idBoxW = 30;
        const idBoxH = 10;
        doc.setLineWidth(0.1);
        doc.rect(pageWidth - marginX - idBoxW, startY + titleHeight + 2, idBoxW, idBoxH);
        doc.setFont("times", "bold");
        doc.setFontSize(14);
        doc.text("ID:", pageWidth - marginX - idBoxW + 3, startY + titleHeight + 9);
        doc.text(team.leader_id || "____", pageWidth - marginX - idBoxW + 10, startY + titleHeight + 9);
    } else {
        const individual = participant as Registration;
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text("Name: ", marginX, infoY);

        const nameX = marginX + doc.getTextWidth("Name: ");
        doc.setFont("times", "bold");
        doc.setFontSize(14); // Increased from 10
        doc.text(`${individual.user_name || "________________________"}`, nameX, infoY);

        // Other information - normal size, positioned below the name
        const nameHeight = 8; // Account for the larger name font
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text(`Division: ${division || "___"}`, marginX, infoY + sectionSpacing);
        doc.text(`Age: ${(ageMap[individual.user_id] || "___").toString()}`, marginX + 80, infoY + sectionSpacing);
        doc.text(`School & Organizer// ${individual.organizer ?? " - "}`, marginX + 120, infoY + sectionSpacing);

        // ID box (right top)
        const idBoxW = 30;
        const idBoxH = 10;
        doc.setLineWidth(0.1);
        doc.rect(pageWidth - marginX - idBoxW, startY + titleHeight + 2, idBoxW, idBoxH);
        doc.setFont("times", "bold");
        doc.setFontSize(14);
        doc.text("ID:", pageWidth - marginX - idBoxW + 3, startY + titleHeight + 9);
        doc.text(individual.user_id || "____", pageWidth - marginX - idBoxW + 10, startY + titleHeight + 9);
    }

    // === 4. Time Table ===
    const tableY = infoY + 15;
    const tableWidth = 47 + 37 + 37 + 37 + 5 + 37; // Total width of the table
    const colWidths = [47, 37, 37, 37, 5, 37];
    const tableX = (pageWidth - tableWidth) / 2;
    const rowHeight = 12;

    // Header row
    const headers = ["Stack", "Try 1", "Try 2", "Try 3", "", "Best Time"];
    let currentX = tableX;
    doc.setFontSize(9);
    doc.setFont("times", "bold");
    headers.forEach((header, i) => {
        doc.rect(currentX, tableY, colWidths[i], 5);
        if (i === 4) {
            doc.setFillColor(0, 0, 0);
            doc.rect(currentX, tableY, colWidths[i], rowHeight, "F");
            doc.setTextColor(255, 255, 255);
        }
        doc.text(header, currentX + colWidths[i] / 2, tableY + 4, {align: "center"});
        doc.setTextColor(0, 0, 0);
        currentX += colWidths[i];
    });

    // Stack rows
    const getStacks = () => {
        switch (sheetType) {
            case "Individual":
                return ["3-3-3", "3-6-3", "Cycle"];
            case "Double":
            case "Parent & Child":
            case "Team Relay":
                return ["Cycle"];
            default:
                return ["Cycle"];
        }
    };
    const stacks = getStacks();
    doc.setFont("times", "normal");
    doc.setFontSize(15);
    stacks.forEach((label, rowIndex) => {
        const y = tableY - 7 + rowHeight * (rowIndex + 1);
        currentX = tableX;
        colWidths.forEach((w, colIdx) => {
            doc.rect(currentX, y, w, rowHeight);
            if (colIdx === 0) {
                doc.text(label, currentX + w / 2, y + 8, {align: "center"});
            }
            if (colIdx === 4) {
                doc.setFillColor(0, 0, 0);
                doc.rect(currentX, y, w, rowHeight, "F"); // Changed tableY to y
            }
            currentX += w;
        });
    });

    // === 5. Notes / Instructions ===
    const notesY = tableY - 3 + rowHeight * 4;
    doc.setFontSize(7.5);
    const lines = [
        "*Allow up to 2 warm-ups prior to the first “try” of each stack. (Warm-ups must match the stack)",
        "*The Stacks are done IN this order: 3-3-3, 3-6-3, Cycle",
        "*After the warm-ups, the next 3 stacks must be used as their 1st, 2nd, 3rd tries.",
        "( No warm-ups between tries. A single up stack of any type constitutes a warm-up and is counted as scratched try.)",
        "*No time is recorded for an infraction that results in a Scratch. Instead record the appropriate code (S1,S2,S3,S4,S5,S6) from Scratch key below.",
        "*Indicate time to the 1/1000th of a second as displayed on the StackMat and Timer",
        "*Transfer the fastest time in each stack to the “Best Time” column.",
        "*Judge keeps this sheet. (Division Manager or Runner will pick up. )",
    ];
    lines.forEach((line, i) => {
        doc.text(line, marginX, notesY + i * 4);
    });

    // === 6. Single Judge/Table Signature Box ===
    const signY = notesY - 7 + lines.length * 4 + 6;
    const boxW = 200;
    const boxH = 6;
    const judgeColW = boxW * 0.7; // Judge column takes 70% of width
    const tableColW = boxW * 0.3; // Table column takes 30% of width

    doc.setLineWidth(0.1);
    // Draw the main rectangle
    doc.rect(marginX, signY, boxW, boxH);
    // Draw vertical line to separate columns
    doc.line(marginX + judgeColW, signY, marginX + judgeColW, signY + boxH);

    doc.setFontSize(9);
    doc.setFont("times", "bold");
    doc.text("Judge:", marginX + 3, signY + 4);
    doc.text("Table:", marginX + judgeColW + 3, signY + 4);

    // === 7. Scratch Key ===
    const scratchY = signY + boxH + 6;
    doc.setFontSize(7);
    doc.setFont("times", "bold");
    doc.text("Scratch Key:", marginX, scratchY);

    doc.setFontSize(7);
    const scratchItems = [
        {label: "S1:", text: " Starting/Stopping hand positions"},
        {label: "S2:", text: " Surface"},
        {label: "S3:", text: " Stacking Sequence"},
        {label: "S4:", text: " Fumble not fixed properly"},
        {label: "S5:", text: " Hands on 2 stacks"},
        {label: "S6:", text: " False stop"},
    ];

    let tempCurrentX = marginX + 25;
    const maxWidth = 200; // Adjust based on your page width
    let currentY = scratchY;

    scratchItems.forEach((item, index) => {
        // Calculate text width to check if we need to wrap
        const itemWidth = doc.getTextWidth(item.label + item.text);

        if (tempCurrentX + itemWidth > marginX + maxWidth && index > 0) {
            // Move to next line
            currentY += 10;
            tempCurrentX = marginX + 25;
        }

        // Draw bold label
        doc.setFont("times", "bold");
        doc.text(item.label, tempCurrentX, currentY);
        tempCurrentX += doc.getTextWidth(item.label);

        // Draw normal text
        doc.setFont("times", "normal");
        doc.text(item.text, tempCurrentX, currentY);
        tempCurrentX += doc.getTextWidth(item.text);

        // Add spacing between items
        if (index < scratchItems.length - 1) {
            tempCurrentX += 4; // Space between items
        }
    });
};

// Helper functions for filtering and data processing
export const getCurrentEventData = (
    tournament: Tournament | null,
    currentEventTab: string,
    currentBracketTab: string,
    registrationList: Registration[],
    searchTerm: string,
): EventData | null => {
    if (!tournament || !currentEventTab || !currentBracketTab) return null;

    const event = tournament.events?.find((evt) => `${evt.code}-${evt.type}` === currentEventTab);
    const bracket = event?.age_brackets.find((br) => br.name === currentBracketTab);

    if (!event || !bracket) return null;

    const isTeamEvent = isTeamEventType(event.type);
    const regs = filterRegistrations(registrationList, currentEventTab, isTeamEvent, searchTerm);

    return {event, bracket, isTeamEvent, registrations: regs};
};

const filterRegistrations = (
    registrationList: Registration[],
    evtKey: string,
    isTeam: boolean,
    searchTerm: string,
): Registration[] => {
    if (isTeam) {
        return registrationList.filter((r) =>
            r.teams?.some(
                (team) =>
                    team.team_id === evtKey &&
                    ((team.leader.global_id?.includes(searchTerm) ?? false) ||
                        team.member.some((m) => m.global_id?.includes(searchTerm) ?? false)),
            ),
        );
    }
    return registrationList.filter(
        (r) => r.events_registered.includes(evtKey) && (r.user_name.includes(searchTerm) || r.user_id.includes(searchTerm)),
    );
};

// Convenience exports
export const generateAllStackingSheets = (
    tournament: Tournament,
    participants: Registration[],
    ageMap: Record<string, number>,
    division: string,
    logoUrl?: string,
): void => {
    generateStackingSheetPDF(tournament, participants, ageMap, division, {logoUrl, includeAllParticipants: true});
};

export const generateAllTeamStackingSheetsPDF = async (
    tournament: Tournament,
    teams: Team[],
    ageMap: Record<string, number>,
    division: string,
    options: {logoUrl?: string} = {},
    sheetType = "Team",
): Promise<void> => {
    try {
        const doc = new jsPDF();
        let logoDataUrl: string | undefined;
        if (tournament.logo) {
            try {
                logoDataUrl = await fetchImageFixedOrientation(tournament.logo);
            } catch (error) {
                console.error("Error loading logo:", error);
            }
        }

        teams.forEach((team, index) => {
            if (index > 0) doc.addPage();
            generateSingleStackingSheet(doc, tournament, team, ageMap, logoDataUrl, division, sheetType);
        });

        const filename = createPDFFilename([tournament.name, division, "all_team_timesheets.pdf"]);
        openPDFInNewTab(doc, filename);
    } catch (error) {
        console.error("Error generating stacking sheet PDF:", error);
        throw error;
    }
};
