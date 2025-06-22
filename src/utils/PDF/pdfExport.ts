// src/utils/pdfExportUtils.ts
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {nanoid} from "nanoid";
import type {Registration, Tournament} from "../../schema";

interface TeamRow {
    team_id: string;
    label?: string | null;
    name: string;
    member: {global_id?: string | null; verified?: boolean}[];
    leader: {global_id?: string | null; verified?: boolean};
    registrationId: string;
}

interface ExportPDFOptions {
    tournament: Tournament;
    eventKey: string;
    bracketName: string;
    registrations: Registration[];
    ageMap: Record<string, number>;
    phoneMap: Record<string, string>; // Add phone map parameter
    searchTerm?: string;
    isTeamEvent: boolean;
}

interface EventData {
    event: Tournament["events"][number];
    bracket: Tournament["events"][number]["age_brackets"][number];
    isTeamEvent: boolean;
    registrations: Registration[];
}

export const exportParticipantListToPDF = (options: ExportPDFOptions): void => {
    const {tournament, eventKey, bracketName, registrations, ageMap, phoneMap, searchTerm = "", isTeamEvent} = options;

    try {
        // Find the event and bracket
        const event = tournament.events?.find((evt) => `${evt.code}-${evt.type}` === eventKey);
        const bracket = event?.age_brackets.find((br) => br.name === bracketName);

        if (!event || !bracket) {
            throw new Error("Event or bracket not found");
        }

        const doc = new jsPDF();

        // Add title
        doc.setFontSize(18);
        doc.text(`${tournament.name}`, 14, 20);

        doc.setFontSize(14);
        doc.text(`Event: ${event.code} (${event.type})`, 14, 30);
        doc.text(`Age Bracket: ${bracket.name} (${bracket.min_age}-${bracket.max_age})`, 14, 40);

        if (searchTerm) {
            doc.setFontSize(10);
            doc.text(`Filtered by: "${searchTerm}"`, 14, 50);
        }

        const startY = searchTerm ? 60 : 50;

        if (isTeamEvent) {
            // Generate team data
            const teamRows: TeamRow[] = [];
            for (const r of registrations) {
                if (r.teams) {
                    for (const team of r.teams) {
                        if (team.team_id === eventKey) {
                            teamRows.push({
                                team_id: team.team_id ?? "",
                                name: team.name ?? "",
                                label: team.label ?? null,
                                member: team.member ?? [],
                                leader: team.leader ?? {global_id: "", verified: false},
                                registrationId: r.id ?? nanoid(),
                            });
                        }
                    }
                }
            }

            const rowsForBracket = teamRows.filter((record) => {
                const ages: number[] = [];
                if (record.leader.global_id && ageMap[record.leader.global_id] != null) {
                    ages.push(ageMap[record.leader.global_id]);
                }
                for (const m of record.member) {
                    if (m.global_id && ageMap[m.global_id] != null) {
                        ages.push(ageMap[m.global_id]);
                    }
                }
                const maxAge = ages.length > 0 ? Math.max(...ages) : -1;
                return maxAge >= bracket.min_age && maxAge <= bracket.max_age;
            });

            // Prepare team table data with phone numbers
            const tableData = rowsForBracket.map((record) => {
                const ages: number[] = [];
                if (record.leader.global_id && ageMap[record.leader.global_id] != null) {
                    ages.push(ageMap[record.leader.global_id]);
                }
                for (const m of record.member) {
                    if (m.global_id && ageMap[m.global_id] != null) {
                        ages.push(ageMap[m.global_id]);
                    }
                }
                const maxAge = ages.length ? Math.max(...ages) : "-";
                const leaderPhone = record.leader.global_id ? phoneMap[record.leader.global_id] || "N/A" : "N/A";

                return [
                    record.leader.global_id ?? "N/A",
                    record.name,
                    record.member.map((m) => m.global_id).join(", "),
                    leaderPhone, // Add leader phone number
                    maxAge.toString(),
                ];
            });

            autoTable(doc, {
                startY: startY,
                head: [["Team Leader", "Team Name", "Members", "Leader Phone", "Largest Age"]],
                body: tableData,
                theme: "grid",
                styles: {fontSize: 9}, // Reduced font size to fit extra column
                headStyles: {fillColor: [0, 0, 0]},
                columnStyles: {
                    0: {cellWidth: 25}, // Team Leader
                    1: {cellWidth: 35}, // Team Name
                    2: {cellWidth: 50}, // Members
                    3: {cellWidth: 30}, // Leader Phone
                    4: {cellWidth: 20}, // Largest Age
                },
            });
        } else {
            // Individual event
            const individualRows = registrations.filter((r) => r.age >= bracket.min_age && r.age <= bracket.max_age);

            const tableData = individualRows.map((record) => [
                record.user_id,
                record.user_name,
                record.age.toString(),
                record.phone_number || "N/A", // Add phone number
            ]);

            autoTable(doc, {
                startY: startY,
                head: [["Global ID", "Name", "Age", "Phone Number"]],
                body: tableData,
                theme: "grid",
                styles: {fontSize: 10},
                headStyles: {fillColor: [0, 0, 0]},
                columnStyles: {
                    0: {cellWidth: 30}, // Global ID
                    1: {cellWidth: 50}, // Name
                    2: {cellWidth: 20}, // Age
                    3: {cellWidth: 40}, // Phone Number
                },
            });
        }

        // Add footer with generation date
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

        // Generate filename
        const filename = `${tournament.name}_${event.code}_${bracket.name}_participants.pdf`
            .replace(/[^a-z0-9]/gi, "_")
            .toLowerCase();

        // Create blob URL for preview only
        const pdfOutput = doc.output("bloburl");

        // Open PDF in new tab for preview
        const newWindow = window.open("", "_blank");
        if (newWindow) {
            newWindow.location.href = pdfOutput.toString();
            newWindow.document.title = filename;
        } else {
            throw new Error("Please allow popups to preview PDF");
        }

        return; // Success - no exception thrown
    } catch (error) {
        console.error("Error generating PDF:", error);
        throw error; // Re-throw to let the caller handle the error
    }
};

// Utility function to get current event data
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

    const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());

    // Filter registrations based on event type and search term
    const regs = filterRegistrations(registrationList, currentEventTab, isTeamEvent, searchTerm);

    return {
        event,
        bracket,
        isTeamEvent,
        registrations: regs,
    };
};

// Helper function to filter registrations
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

export const exportMasterListToPDF = (
    tournament: Tournament,
    registrations: Registration[],
    ageMap: Record<string, number>,
    phoneMap: Record<string, string>,
): void => {
    try {
        const doc = new jsPDF();

        // Add title
        doc.setFontSize(18);
        doc.text(`${tournament.name} - Master Participant List`, 14, 20);

        // Add summary info
        doc.setFontSize(12);
        doc.text(`Total Participants: ${registrations.length}`, 14, 35);

        // Prepare table data - all participants with their basic info
        const tableData = registrations.map((r) => [
            r.user_id || "N/A",
            r.user_name || "N/A",
            ageMap[r.user_id]?.toString() || "N/A",
            phoneMap[r.user_id] || "N/A",
            (r.events_registered || []).join(", ") || "None",
        ]);

        // Create the table
        autoTable(doc, {
            startY: 45,
            head: [["Global ID", "Name", "Age", "Phone", "Events Registered"]],
            body: tableData,
            theme: "grid",
            styles: {fontSize: 9},
            headStyles: {fillColor: [0, 0, 0]},
            columnStyles: {
                0: {cellWidth: 25}, // Global ID
                1: {cellWidth: 40}, // Name
                2: {cellWidth: 15}, // Age
                3: {cellWidth: 30}, // Phone
                4: {cellWidth: 70}, // Events (wider for multiple events)
            },
        });

        // Add footer with generation date
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

        // Generate filename
        const filename = `${tournament.name}_master_participant_list.pdf`.replace(/[^a-z0-9]/gi, "_").toLowerCase();

        // Create blob URL and open in new tab
        const pdfOutput = doc.output("bloburl");
        const newWindow = window.open("", "_blank");
        if (newWindow) {
            newWindow.location.href = pdfOutput.toString();
            newWindow.document.title = filename;
        } else {
            throw new Error("Please allow popups to preview PDF");
        }
    } catch (error) {
        console.error("Error generating master list PDF:", error);
        throw error;
    }
};

/**
 * Export a comprehensive list of all event-bracket combinations with participant details.
 */
export const exportAllBracketsListToPDF = (
    tournament: Tournament,
    registrations: Registration[],
    ageMap: Record<string, number>,
    phoneMap: Record<string, string>, // Added phone map parameter
): void => {
    try {
        const doc = new jsPDF();

        // Add title
        doc.setFontSize(18);
        doc.text(`${tournament.name} - All Events & Brackets`, 14, 20);

        doc.setFontSize(12);
        doc.text(`Total Events: ${tournament.events.length}`, 14, 35);

        let startY = 45;
        let isFirstEvent = true;

        // Process each event and its brackets
        for (const event of tournament.events) {
            const eventKey = `${event.code}-${event.type}`;
            const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());

            // Add new page for each event (except the first one)
            if (!isFirstEvent) {
                doc.addPage();
                startY = 20;
            }
            isFirstEvent = false;

            // Add event header
            doc.setFontSize(16);
            doc.setFont(undefined, "bold");
            doc.text(`${event.code} - ${event.type}`, 14, startY);
            startY += 10;

            // Process each bracket in the event
            for (const bracket of event.age_brackets) {
                // Add bracket header
                doc.setFontSize(14);
                doc.setFont(undefined, "bold");
                doc.text(`${bracket.name} (Ages ${bracket.min_age}-${bracket.max_age})`, 20, startY);
                startY += 8;

                // Get participants for this bracket
                let participants: string[][] = [];

                if (isTeamEvent) {
                    // Handle team events
                    const teamRows: TeamRow[] = [];
                    for (const r of registrations) {
                        if (r.teams) {
                            for (const team of r.teams) {
                                if (team.team_id === eventKey) {
                                    teamRows.push({
                                        team_id: team.team_id ?? "",
                                        name: team.name ?? "",
                                        label: team.label ?? null,
                                        member: team.member ?? [],
                                        leader: team.leader ?? {global_id: "", verified: false},
                                        registrationId: r.id ?? nanoid(),
                                    });
                                }
                            }
                        }
                    }

                    // Filter teams by bracket age
                    const teamsForBracket = teamRows.filter((record) => {
                        const ages: number[] = [];
                        if (record.leader.global_id && ageMap[record.leader.global_id] != null) {
                            ages.push(ageMap[record.leader.global_id]);
                        }
                        for (const m of record.member) {
                            if (m.global_id && ageMap[m.global_id] != null) {
                                ages.push(ageMap[m.global_id]);
                            }
                        }
                        const maxAge = ages.length > 0 ? Math.max(...ages) : -1;
                        return maxAge >= bracket.min_age && maxAge <= bracket.max_age;
                    });

                    participants = teamsForBracket.map((team) => [
                        team.name,
                        `${team.leader.global_id || "N/A"}`,
                        `${team.member.map((m) => m.global_id).join(", ") || "None"}`,
                        phoneMap[team.leader.global_id || ""] || "N/A",
                    ]);
                } else {
                    // Handle individual events
                    const individualsForBracket = registrations.filter(
                        (r) => r.events_registered.includes(eventKey) && r.age >= bracket.min_age && r.age <= bracket.max_age,
                    );

                    participants = individualsForBracket.map((r) => [
                        r.user_name || "N/A",
                        r.user_id || "N/A",
                        r.age?.toString() || "N/A",
                        phoneMap[r.user_id] || "N/A",
                    ]);
                }

                if (participants.length > 0) {
                    // Create table for participants
                    const headers = isTeamEvent
                        ? [["Team Name", "Leader", "Members", "Phone"]]
                        : [["Name", "Global ID", "Age", "Phone"]];

                    autoTable(doc, {
                        startY: startY,
                        head: headers,
                        body: participants,
                        theme: "striped",
                        styles: {fontSize: 8},
                        headStyles: {fillColor: [70, 70, 70]},
                        margin: {left: 25},
                        columnStyles: isTeamEvent
                            ? {
                                  0: {cellWidth: 40}, // Team Name
                                  1: {cellWidth: 35}, // Leader
                                  2: {cellWidth: 50}, // Members
                                  3: {cellWidth: 25}, // Phone
                              }
                            : {
                                  0: {cellWidth: 45}, // Name
                                  1: {cellWidth: 30}, // Global ID
                                  2: {cellWidth: 20}, // Age
                                  3: {cellWidth: 30}, // Phone
                              },
                    });

                    // Update startY position after table
                    startY = (doc as unknown as {lastAutoTable?: {finalY: number}}).lastAutoTable?.finalY
                        ? (doc as unknown as {lastAutoTable: {finalY: number}}).lastAutoTable.finalY + 10
                        : startY + 10;
                } else {
                    // No participants message
                    doc.setFontSize(10);
                    doc.setFont(undefined, "normal");
                    doc.text("No participants registered", 25, startY);
                    startY += 10;
                }

                // Check if we need a new page within same event
                if (startY > doc.internal.pageSize.height - 40) {
                    doc.addPage();
                    startY = 20;
                    // Re-add event header on new page
                    doc.setFontSize(14);
                    doc.setFont(undefined, "bold");
                    doc.text(`${event.code} - ${event.type} (continued)`, 14, startY);
                    startY += 15;
                }
            }
        }

        // Add footer with generation date
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

        // Generate filename
        const filename = `${tournament.name}_all_brackets_list.pdf`.replace(/[^a-z0-9]/gi, "_").toLowerCase();

        // Create blob URL and open in new tab
        const pdfOutput = doc.output("bloburl");
        const newWindow = window.open("", "_blank");
        if (newWindow) {
            newWindow.location.href = pdfOutput.toString();
            newWindow.document.title = filename;
        } else {
            throw new Error("Please allow popups to preview PDF");
        }
    } catch (error) {
        console.error("Error generating all brackets PDF:", error);
        throw error;
    }
};
