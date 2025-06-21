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
