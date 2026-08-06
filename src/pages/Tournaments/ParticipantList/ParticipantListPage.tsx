import type {AgeBracket, Registration, Team, TeamRow, Tournament, TournamentEvent} from "@/schema";
import TeamNameUpdatePreviewModal from "@/components/common/TeamNameUpdatePreviewModal";
import {fetchUsersByGlobalIds} from "@/services/firebase/authService";
import {fetchApprovedRegistrations} from "@/services/firebase/registerService";
import {
    fetchTeamsByTournament,
    fetchTournamentById,
    fetchTournamentEvents,
} from "@/services/firebase/tournamentsService";
import {
    applyTeamNameUpdatesForTournament,
    previewTeamNameUpdatesForTournament,
    type TeamNameUpdatePreview,
} from "@/services/firebase/teamNameMaintenanceService";
import {
    exportAllBracketsListToPDF,
    exportCombinedTimeSheetsPDF,
    exportCurrentEventNameListToPDF,
    exportLargeNameListStickerPDF,
    exportMasterListToPDF,
    exportNameListStickerPDF,
    exportParticipantListToPDF,
    generateStackingSheetPDF,
    generateTeamStackingSheetPDF,
} from "@/utils/PDF/pdfExport";
import {formatTeamLeaderId, stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {
    getEventKey,
    getEventLabel,
    getEventTypeOrderIndex,
    isTeamEvent,
    matchesAnyEventKey,
    sanitizeEventCodes,
    teamMatchesEventKey,
} from "@/utils/tournament/eventUtils";
import {Button, Card, Dropdown, Input, Message, Pagination, Table, Tabs, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconArrowLeft, IconDown} from "@arco-design/web-react/icon";
import {nanoid} from "nanoid";
// src/pages/ParticipantListPage.tsx
import type React from "react";
import {useEffect, useRef, useState} from "react";
import {useLocation, useNavigate, useParams, useSearchParams} from "react-router-dom";
import {useMount} from "react-use";
import {MobilePageHeader, ResponsiveTabs} from "@/components/responsive";

const {Text} = Typography;
const {TabPane} = Tabs;
const PAGE_SIZE_INDIVIDUAL = 10;
const PAGE_SIZE_TEAM = 5;

const parsePositivePage = (value: string | null): number => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export default function ParticipantListPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const location = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [registrationList, setRegistrationList] = useState<Registration[]>([]);
    const [teamList, setTeamList] = useState<Team[]>([]);
    const [supplementalNameMap, setSupplementalNameMap] = useState<Record<string, string>>({});
    const [teamNamePreview, setTeamNamePreview] = useState<TeamNameUpdatePreview | null>(null);
    const [teamNamePreviewVisible, setTeamNamePreviewVisible] = useState(false);
    const [teamNameConfirmLoading, setTeamNameConfirmLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState(() => searchParams.get("search") ?? "");
    const [currentEventTab, setCurrentEventTab] = useState<string>(() => searchParams.get("event") ?? "");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>(() => searchParams.get("bracket") ?? "");
    const [currentPage, setCurrentPage] = useState<number>(() => parsePositivePage(searchParams.get("page")));
    const mountedRef = useRef(false);
    const sortedEvents = [...events].sort((a, b) => {
        const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
        if (orderDiff !== 0) return orderDiff;
        return a.type.localeCompare(b.type);
    });

    const ageMap: Record<string, number> = registrationList.reduce(
        (acc, r) => {
            acc[r.user_id] = r.age;
            return acc;
        },
        {} as Record<string, number>,
    );

    // Create phone number map for easy lookup
    const phoneMap: Record<string, string> = registrationList.reduce(
        (acc, r) => {
            acc[r.user_global_id] = r.phone_number || "N/A";
            return acc;
        },
        {} as Record<string, string>,
    );
    const nameMap: Record<string, string> = registrationList.reduce(
        (acc, r) => {
            acc[r.user_global_id] = r.user_name || r.user_global_id;
            return acc;
        },
        {} as Record<string, string>,
    );
    const combinedNameMap: Record<string, string> = {...nameMap, ...supplementalNameMap};
    const isStackOutChampionEvent = (event: TournamentEvent): boolean =>
        event.type.toLowerCase() === "stackout champion" || event.type.toLowerCase() === "stack up champion";
    const registrationMatchesParticipantId = (registration: Registration, participantId: string): boolean =>
        registration.user_id === participantId || registration.user_global_id === participantId;
    const normalizeSearchValue = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? "";
    const valueMatchesSearch = (value: string | null | undefined, normalizedSearch: string): boolean =>
        normalizeSearchValue(value).includes(normalizedSearch);
    const registrationMatchesSearch = (registration: Registration, normalizedSearch: string): boolean =>
        valueMatchesSearch(registration.user_name, normalizedSearch) ||
        valueMatchesSearch(registration.user_id, normalizedSearch) ||
        valueMatchesSearch(registration.user_global_id, normalizedSearch);
    const getTeamParticipantIds = (team: Team): string[] => [
        stripTeamLeaderPrefix(team.leader_id),
        ...(team.members?.map((member) => member.global_id) ?? []),
    ];
    const teamMatchesSearch = (team: Team, normalizedSearch: string): boolean => {
        if (normalizedSearch.length === 0) {
            return true;
        }

        if (valueMatchesSearch(team.name, normalizedSearch)) {
            return true;
        }

        return getTeamParticipantIds(team).some(
            (participantId) =>
                valueMatchesSearch(participantId, normalizedSearch) ||
                valueMatchesSearch(combinedNameMap[participantId], normalizedSearch),
        );
    };
    const filterTeams = (evtKey: string): Team[] => {
        const normalizedSearch = normalizeSearchValue(searchTerm);

        return teamList.filter(
            (team) => teamMatchesEventKey(team, evtKey, events ?? []) && teamMatchesSearch(team, normalizedSearch),
        );
    };

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            const events = await fetchTournamentEvents(tournamentId);
            setEvents(events);
            const sortedEventList = [...events].sort((a, b) => {
                const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
                if (orderDiff !== 0) return orderDiff;
                return a.type.localeCompare(b.type);
            });

            const requestedEventTab = searchParams.get("event") ?? currentEventTab;
            const selectedEvent =
                sortedEventList.find((evt) => evt.id === requestedEventTab) ||
                sortedEventList.find((evt) => evt.type === requestedEventTab) ||
                sortedEventList[0];
            const resolvedEventTab = selectedEvent?.id ?? selectedEvent?.type ?? "";
            setCurrentEventTab(resolvedEventTab);

            const requestedBracketTab = searchParams.get("bracket") ?? currentBracketTab;
            const selectedBracket =
                selectedEvent?.age_brackets?.find((bracket) => bracket.name === requestedBracketTab) ??
                selectedEvent?.age_brackets?.[0];
            setCurrentBracketTab(selectedBracket?.name ?? "");

            const regs = await fetchApprovedRegistrations(tournamentId);
            const teams = await fetchTeamsByTournament(tournamentId);
            const verifiedTeams = teams.filter((team) => {
                if (!isTeamFullyVerified(team)) {
                    return false;
                }
                const leaderId = stripTeamLeaderPrefix(team.leader_id);
                return regs.some((r) => r.user_global_id === leaderId || r.user_id === leaderId);
            });
            setRegistrationList(regs);
            setTeamList(verifiedTeams);

            const approvedNameMap = regs.reduce(
                (acc, registration) => {
                    if (registration.user_global_id) {
                        acc[registration.user_global_id] = registration.user_name || registration.user_global_id;
                    }
                    return acc;
                },
                {} as Record<string, string>,
            );
            const missingGlobalIds = Array.from(
                new Set(
                    verifiedTeams.flatMap((team) => [
                        stripTeamLeaderPrefix(team.leader_id),
                        ...(team.members ?? []).map((member) => member.global_id),
                    ]),
                ),
            ).filter((globalId) => globalId && !approvedNameMap[globalId]);

            if (missingGlobalIds.length > 0) {
                const usersByGlobalId = await fetchUsersByGlobalIds(missingGlobalIds);
                const fetchedNameMap: Record<string, string> = {};
                for (const [globalId, user] of Object.entries(usersByGlobalId)) {
                    fetchedNameMap[globalId] = user.name || globalId;
                }
                setSupplementalNameMap(fetchedNameMap);
            } else {
                setSupplementalNameMap({});
            }
        } catch {
            Message.error("Unable to fetch participants");
        } finally {
            setLoading(false);
        }
    };

    const handleLargeNameListSticker = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportLargeNameListStickerPDF({
                tournament,
                registrations: registrationList,
            });
            Message.success("Large name list sticker PDF opened");
        } catch (error) {
            Message.error("Failed to generate large sticker PDF");
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        refreshParticipantList();
    });

    useEffect(() => {
        const nextParams = new URLSearchParams(searchParams);

        if (searchTerm.trim()) {
            nextParams.set("search", searchTerm.trim());
        } else {
            nextParams.delete("search");
        }

        if (currentEventTab) {
            nextParams.set("event", currentEventTab);
        } else {
            nextParams.delete("event");
        }

        if (currentBracketTab) {
            nextParams.set("bracket", currentBracketTab);
        } else {
            nextParams.delete("bracket");
        }

        if (currentPage > 1) {
            nextParams.set("page", `${currentPage}`);
        } else {
            nextParams.delete("page");
        }

        if (nextParams.toString() !== searchParams.toString()) {
            setSearchParams(nextParams, {replace: true});
        }
    }, [currentBracketTab, currentEventTab, currentPage, searchParams, searchTerm, setSearchParams]);

    const filterRegistrations = (evtKey: string, isTeam: boolean, event?: TournamentEvent) => {
        const normalizedSearch = normalizeSearchValue(searchTerm);

        if (isTeam) {
            const teamUserIds = new Set(filterTeams(evtKey).flatMap(getTeamParticipantIds));

            return registrationList.filter(
                (registration) => teamUserIds.has(registration.user_id) || teamUserIds.has(registration.user_global_id ?? ""),
            );
        }

        return registrationList.filter((r) => {
            const matchesEvent =
                r.events_registered.includes(evtKey) || (event ? matchesAnyEventKey(r.events_registered, event) : false);
            if (!matchesEvent) {
                return false;
            }

            if (normalizedSearch.length === 0) {
                return true;
            }

            return registrationMatchesSearch(r, normalizedSearch);
        });
    };

    const handleEventSelect = (key: string) => {
        setCurrentEventTab(key);
        setCurrentPage(1);

        const selectedEvent = events.find((evt) => evt.id === key) || events.find((evt) => evt.type === key);

        const nextBracket = selectedEvent?.age_brackets?.[0]?.name ?? "";
        setCurrentBracketTab(nextBracket);
    };

    const handleBracketSelect = (key: string) => {
        setCurrentBracketTab(key);
        setCurrentPage(1);
    };

    const handleExportNameListSticker = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportNameListStickerPDF({
                tournament,
                registrations: registrationList,
            });
            Message.success("Name list sticker PDF opened");
        } catch (error) {
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    };

    const handlePrintAllTimeSheets = async () => {
        if (!tournament || events.length === 0) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            const entries = [];
            for (const event of events) {
                if (isStackOutChampionEvent(event)) {
                    continue;
                }
                const eventCodes = sanitizeEventCodes(event.codes);
                const eventKey = getEventKey(event);
                const isTeam = isTeamEvent(event);

                for (const bracket of event.age_brackets ?? []) {
                    if (isTeam) {
                        const teamsForBracket = teamList.filter((team) => {
                            const matchesEvent =
                                teamMatchesEventKey(team, eventKey, events ?? []) ||
                                teamMatchesEventKey(team, event.id ?? "", events ?? []) ||
                                teamMatchesEventKey(team, event.type, events ?? []);
                            if (!matchesEvent) return false;
                            const age = team.team_age;
                            return age === undefined || (age >= bracket.min_age && age <= bracket.max_age);
                        });
                        for (const team of teamsForBracket) {
                            entries.push({
                                participant: team,
                                division: bracket.name,
                                sheetType: event.type,
                                eventCodes: eventCodes,
                            });
                        }
                    } else {
                        const participantsForBracket = registrationList.filter((r) => {
                            const matches =
                                r.events_registered.includes(eventKey) || matchesAnyEventKey(r.events_registered, event);
                            return matches && r.age >= bracket.min_age && r.age <= bracket.max_age;
                        });
                        for (const participant of participantsForBracket) {
                            entries.push({
                                participant,
                                division: bracket.name,
                                sheetType: event.type,
                                eventCodes: eventCodes,
                            });
                        }
                    }
                }
            }
            if (entries.length === 0) {
                Message.warning("No participants found to print time sheets.");
                setLoading(false);
                return;
            }
            await exportCombinedTimeSheetsPDF({
                tournament,
                entries,
                ageMap,
                nameMap: combinedNameMap,
                logoUrl: tournament.logo ?? "",
            });
            Message.success("Time sheets opened for all events");
        } catch (error) {
            Message.error("Failed to generate time sheets");
        } finally {
            setLoading(false);
        }
    };

    const handlePreviewMasterList = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportMasterListToPDF({
                tournament,
                events: events ?? [],
                registrations: registrationList,
                ageMap,
                phoneMap,
                logoDataUrl: tournament.logo ?? undefined,
            });
            Message.success("Master list PDF opened");
        } catch (error) {
            Message.error("Failed to generate master list PDF");
        } finally {
            setLoading(false);
        }
    };

    const handlePreviewAllBrackets = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportAllBracketsListToPDF(
                tournament,
                events ?? [],
                registrationList,
                teamList,
                ageMap,
                phoneMap,
                combinedNameMap,
            );
            Message.success("All brackets list PDF opened");
        } catch (error) {
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    };

    const handlePreviewCurrentEvent = async () => {
        if (!tournament || !currentEvent) {
            Message.warning("Tournament event data not loaded");
            return;
        }

        setLoading(true);
        try {
            await exportCurrentEventNameListToPDF(
                tournament,
                currentEvent,
                registrationList,
                teamList,
                ageMap,
                phoneMap,
                combinedNameMap,
            );
            Message.success("Current event name list PDF opened");
        } catch (error) {
            Message.error("Failed to generate current event name list PDF");
        } finally {
            setLoading(false);
        }
    };

    const handlePrepareTeamNameUpdate = async () => {
        if (!tournamentId) {
            Message.warning("Tournament ID is missing");
            return;
        }

        setLoading(true);
        try {
            const preview = await previewTeamNameUpdatesForTournament(tournamentId);
            const {summary} = preview;
            const hasChanges =
                summary.teamDocuments > 0 || summary.registrationDocuments > 0 || summary.cleanupDocuments > 0;
            if (!hasChanges) {
                Message.success("All team names are already up to date.");
            } else {
                setTeamNamePreview(preview);
                setTeamNamePreviewVisible(true);
            }
        } catch (error) {
            console.error("Failed to prepare team name update:", error);
            Message.error("Failed to update team names");
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmTeamNameUpdate = async () => {
        if (!tournamentId || !teamNamePreview) return;

        setTeamNameConfirmLoading(true);
        try {
            const result = await applyTeamNameUpdatesForTournament(tournamentId, teamNamePreview.fingerprint);
            const parts: string[] = [];
            if (result.teamNameUpdates > 0) parts.push(`Updated ${result.teamNameUpdates} team name(s).`);
            if (result.teamAgeUpdates > 0) parts.push(`Updated ${result.teamAgeUpdates} team age(s).`);
            if (result.registrationDocuments > 0) parts.push(`Updated ${result.registrationDocuments} registration document(s).`);
            if (result.duplicateTeams > 0) parts.push(`Removed ${result.duplicateTeams} duplicate team(s).`);
            setTeamNamePreviewVisible(false);
            setTeamNamePreview(null);
            Message.success(parts.join(" ") || "Team updates completed.");
            await refreshParticipantList();
        } catch (error) {
            if (error instanceof Error && error.message === "TEAM_NAME_PREVIEW_STALE") {
                try {
                    const refreshedPreview = await previewTeamNameUpdatesForTournament(tournamentId);
                    const refreshedSummary = refreshedPreview.summary;
                    const hasChanges =
                        refreshedSummary.teamDocuments > 0 ||
                        refreshedSummary.registrationDocuments > 0 ||
                        refreshedSummary.cleanupDocuments > 0;
                    if (hasChanges) {
                        setTeamNamePreview(refreshedPreview);
                        setTeamNamePreviewVisible(true);
                        Message.warning("The data changed after the preview. The preview was refreshed; please confirm again.");
                    } else {
                        setTeamNamePreviewVisible(false);
                        setTeamNamePreview(null);
                        Message.success("No team updates remain after the data changed.");
                    }
                } catch (previewError) {
                    console.error("Failed to refresh stale team name preview:", previewError);
                    setTeamNamePreviewVisible(false);
                    setTeamNamePreview(null);
                    Message.error("The data changed and the latest preview could not be loaded. Please try again.");
                }
            } else {
                console.error("Failed to apply team name update:", error);
                setTeamNamePreviewVisible(false);
                setTeamNamePreview(null);
                Message.error("Failed to update team names. Please refresh the participant list and try again.");
                await refreshParticipantList();
            }
        } finally {
            setTeamNameConfirmLoading(false);
        }
    };

    const handlePrintParticipantTimeSheet = async (record: Registration, event: TournamentEvent, bracket: AgeBracket) => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        if (isStackOutChampionEvent(event)) {
            Message.info("StackOut Champion does not require a time sheet.");
            return;
        }

        setLoading(true);
        try {
            await generateStackingSheetPDF(
                tournament,
                [record],
                ageMap,
                bracket.name,
                {
                    logoUrl: tournament.logo ?? "",
                    eventCodes: sanitizeEventCodes(event.codes),
                },
                event.type,
            );
        } catch (error) {
            Message.error("Failed to generate time sheet");
        } finally {
            setLoading(false);
        }
    };

    const handlePrintMemberList = async (team: Team, eventKey: string, bracket: AgeBracket) => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportParticipantListToPDF({
                tournament,
                events,
                eventKey,
                bracketName: bracket.name,
                registrations: registrationList,
                ageMap,
                phoneMap,
                nameMap: combinedNameMap,
                isTeamEvent: true,
                team,
                logoDataUrl: tournament.logo ?? "",
            });
        } catch (error) {
            Message.error("Failed to generate member list");
        } finally {
            setLoading(false);
        }
    };

    const handlePrintTeamTimeSheet = async (team: Team, event: TournamentEvent, bracket: AgeBracket) => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await generateTeamStackingSheetPDF(
                tournament,
                team,
                ageMap,
                bracket.name,
                {
                    logoUrl: tournament.logo ?? "",
                    nameMap: combinedNameMap,
                    eventCodes: sanitizeEventCodes(event.codes),
                },
                event.type,
            );
        } catch (error) {
            Message.error("Failed to generate team time sheet");
        } finally {
            setLoading(false);
        }
    };

    if (!tournament) return null;

    const currentEvent =
        sortedEvents.find((evt) => (evt.id ?? evt.type) === currentEventTab) ??
        sortedEvents.find((evt) => evt.type === currentEventTab) ??
        sortedEvents[0];
    const currentEventKey = currentEvent ? (currentEvent.id ?? currentEvent.type) : "";
    const currentEventIsTeam = currentEvent ? isTeamEvent(currentEvent) : false;
    const currentBracket =
        currentEvent?.age_brackets.find((bracket) => bracket.name === currentBracketTab) ?? currentEvent?.age_brackets[0];
    const currentRegistrations = currentEvent ? filterRegistrations(currentEventKey, currentEventIsTeam, currentEvent) : [];
    const teamRows: TeamRow[] = currentEventIsTeam
        ? filterTeams(currentEventKey).map((team) => ({
              ...team,
              registrationId:
                  registrationList.find((registration) => {
                      const leaderId = stripTeamLeaderPrefix(team.leader_id);
                      return registration.user_id === leaderId || registration.user_global_id === leaderId;
                  })?.id ?? "",
          }))
        : [];
    const rowsForBracket =
        currentEventIsTeam && currentBracket
            ? teamRows.filter(
                  (record) =>
                      record.team_age !== undefined &&
                      record.team_age >= currentBracket.min_age &&
                      record.team_age <= currentBracket.max_age,
              )
            : [];
    const getTeamRegistrationId = (team: TeamRow): string => team.registration_id || team.registrationId;
    const individualRows =
        !currentEventIsTeam && currentBracket
            ? currentRegistrations.filter(
                  (registration) => registration.age >= currentBracket.min_age && registration.age <= currentBracket.max_age,
              )
            : [];

    const renderActionsButton = (droplist: React.ReactNode, label = "Actions") => (
        <Dropdown droplist={droplist} trigger={["click"]}>
            <Button type="primary" className="participant-list-actions-button">
                <span className="participant-list-button-content">
                    {label}
                    <IconDown />
                </span>
            </Button>
        </Dropdown>
    );

    const individualColumns: TableColumnProps<Registration>[] = [
        {title: "Global ID", dataIndex: "user_global_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {title: "Age", dataIndex: "age", width: 100},
        {
            title: "Phone Number",
            width: 150,
            render: (_, record) => <Text>{record.phone_number || "N/A"}</Text>,
        },
        {
            title: "Actions",
            width: 160,
            render: (_, record) => {
                if (!currentEvent || !currentBracket) return null;

                const droplist = (
                    <div className="participant-list-action-menu">
                        <Button
                            type="text"
                            className="participant-list-menu-item"
                            loading={loading}
                            onClick={() => window.open(`/tournaments/${tournamentId}/registrations/${record.id}/edit`, "_blank")}
                        >
                            Edit Participant
                        </Button>
                        <Button
                            type="text"
                            className="participant-list-menu-item"
                            loading={loading}
                            disabled={isStackOutChampionEvent(currentEvent)}
                            onClick={() => handlePrintParticipantTimeSheet(record, currentEvent, currentBracket)}
                        >
                            {isStackOutChampionEvent(currentEvent) ? "Time Sheet Not Required" : "Print Time Sheet"}
                        </Button>
                    </div>
                );

                return renderActionsButton(droplist);
            },
        },
    ];

    const teamColumns: TableColumnProps<Team>[] = [
        {
            title: "Team Leader",
            width: 150,
            render: (_, record) => <Text>{formatTeamLeaderId(record.leader_id, currentEvent?.type ?? "Team Relay")}</Text>,
        },
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Members",
            width: 300,
            render: (_, record) => (
                <Text>
                    {[
                        {
                            id: stripTeamLeaderPrefix(record.leader_id),
                            name: combinedNameMap[stripTeamLeaderPrefix(record.leader_id)],
                        },
                        ...record.members.map((member) => ({
                            id: member.global_id,
                            name: combinedNameMap[member.global_id],
                        })),
                    ]
                        .filter((entry) => entry.id)
                        .map((entry) => `${entry.name ?? entry.id} (${entry.id})`)
                        .join(", ")}
                </Text>
            ),
        },
        {
            title: "Leader Phone",
            width: 150,
            render: (_, record) => (
                <Text>{record.leader_id ? phoneMap[stripTeamLeaderPrefix(record.leader_id)] || "N/A" : "N/A"}</Text>
            ),
        },
        {
            title: "Team Age",
            width: 150,
            render: (_, record) => <Text>{record.team_age ?? "-"}</Text>,
        },
        {
            title: "Actions",
            width: 160,
            render: (_, record) => {
                if (!currentEvent || !currentBracket) return null;
                const team = record as TeamRow;
                const droplist = (
                    <div className="participant-list-action-menu">
                        <Button
                            type="text"
                            className="participant-list-menu-item"
                            loading={loading}
                            onClick={() =>
                                window.open(
                                    `/tournaments/${tournamentId}/registrations/${getTeamRegistrationId(team)}/edit${location.search}`,
                                    "_blank",
                                )
                            }
                        >
                            Edit Team
                        </Button>
                        <Button
                            type="text"
                            className="participant-list-menu-item"
                            loading={loading}
                            onClick={() => handlePrintMemberList(team, currentEventKey, currentBracket)}
                        >
                            Print Member List
                        </Button>
                        <Button
                            type="text"
                            className="participant-list-menu-item"
                            loading={loading}
                            onClick={() => handlePrintTeamTimeSheet(team, currentEvent, currentBracket)}
                        >
                            Team Time Sheet
                        </Button>
                    </div>
                );

                return renderActionsButton(droplist);
            },
        },
    ];

    const exportMenu = (
        <div className="participant-list-action-menu participant-list-export-menu">
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handlePreviewAllBrackets}>
                All Event Name List
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handlePreviewCurrentEvent}>
                Current Event Name List
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handlePreviewMasterList}>
                Master List
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handleExportNameListSticker}>
                Name List Sticker
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handleLargeNameListSticker}>
                Large Name List Sticker
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handlePrintAllTimeSheets}>
                Time Sheet
            </Button>
            <Button type="text" loading={loading} className="participant-list-menu-item" onClick={handlePrepareTeamNameUpdate}>
                Update Team Name
            </Button>
        </div>
    );

    return (
        <>
            <div className="participant-list-page flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="participant-list-header w-full">
                    <div className="participant-list-back-row">
                        <Button
                            className="participant-list-back-button"
                            type="outline"
                            icon={<IconArrowLeft />}
                            onClick={() => navigate("/tournaments")}
                        >
                            Go Back
                        </Button>
                    </div>
                    <MobilePageHeader title={`${tournament.name} Participants`} className="participant-list-title-header" />
                    <div className="participant-list-toolbar">
                        <div className="participant-list-filter participant-list-search-field">
                            <span className="participant-list-filter-label">Search</span>
                            <Input.Search
                                placeholder="Search by name or ID"
                                allowClear
                                className="participant-list-search"
                                value={searchTerm}
                                onChange={(val) => {
                                    setSearchTerm(val);
                                    setCurrentPage(1);
                                }}
                            />
                        </div>
                        <Dropdown droplist={exportMenu} trigger={["click"]}>
                            <Button type="primary" loading={loading} className="participant-list-export-button">
                                <span className="participant-list-button-content">
                                    Export / Print
                                    <IconDown />
                                </span>
                            </Button>
                        </Dropdown>
                    </div>
                    <ResponsiveTabs
                        type="line"
                        destroyOnHide
                        className="participant-list-event-tabs"
                        activeTab={currentEventTab}
                        onChange={handleEventSelect}
                    >
                        {sortedEvents.map((event) => {
                            const eventKey = event.id ?? event.type;
                            return <TabPane key={eventKey} title={getEventLabel(event)} />;
                        })}
                    </ResponsiveTabs>
                    <ResponsiveTabs
                        type="capsule"
                        tabPosition="top"
                        destroyOnHide
                        className="participant-list-bracket-tabs"
                        activeTab={currentBracketTab}
                        onChange={handleBracketSelect}
                    >
                        {currentEvent?.age_brackets.map((bracket) => (
                            <TabPane key={bracket.name} title={`${bracket.name} (${bracket.min_age}-${bracket.max_age})`} />
                        ))}
                    </ResponsiveTabs>
                </div>

                <div className="participant-list-content w-full">
                    {currentEvent && currentBracket ? (
                        currentEventIsTeam ? (
                            <>
                                <div className="participants-mobile-cards">
                                    {rowsForBracket
                                        .slice((currentPage - 1) * PAGE_SIZE_TEAM, currentPage * PAGE_SIZE_TEAM)
                                        .map((record) => (
                                            <Card key={record.id} className="participants-mobile-card" bordered>
                                                <div className="participants-mobile-card__header">
                                                    <div>
                                                        <span className="participants-mobile-card__label">Team</span>
                                                        <strong>{record.name}</strong>
                                                    </div>
                                                    <Tag color="arcoblue">{record.team_age ?? "—"}</Tag>
                                                </div>
                                                <p>Leader: {formatTeamLeaderId(record.leader_id, currentEvent.type)}</p>
                                                <p>
                                                    Members:{" "}
                                                    {record.members
                                                        .map((member) => combinedNameMap[member.global_id] ?? member.global_id)
                                                        .join(", ") || "—"}
                                                </p>
                                                <div className="participant-list-mobile-actions">
                                                    {renderActionsButton(
                                                        <div className="participant-list-action-menu">
                                                            <Button
                                                                type="text"
                                                                className="participant-list-menu-item"
                                                                loading={loading}
                                                                onClick={() =>
                                                                    window.open(
                                                                        `/tournaments/${tournamentId}/registrations/${getTeamRegistrationId(record)}/edit${location.search}`,
                                                                        "_blank",
                                                                    )
                                                                }
                                                            >
                                                                Edit Team
                                                            </Button>
                                                            <Button
                                                                type="text"
                                                                className="participant-list-menu-item"
                                                                loading={loading}
                                                                onClick={() =>
                                                                    handlePrintMemberList(record, currentEventKey, currentBracket)
                                                                }
                                                            >
                                                                Print Member List
                                                            </Button>
                                                            <Button
                                                                type="text"
                                                                className="participant-list-menu-item"
                                                                loading={loading}
                                                                onClick={() =>
                                                                    handlePrintTeamTimeSheet(record, currentEvent, currentBracket)
                                                                }
                                                            >
                                                                Team Time Sheet
                                                            </Button>
                                                        </div>,
                                                    )}
                                                </div>
                                            </Card>
                                        ))}
                                </div>
                                <div className="participant-list-mobile-pagination">
                                    {rowsForBracket.length > PAGE_SIZE_TEAM ? (
                                        <Pagination
                                            current={currentPage}
                                            pageSize={PAGE_SIZE_TEAM}
                                            total={rowsForBracket.length}
                                            onChange={setCurrentPage}
                                        />
                                    ) : null}
                                </div>
                                <div className="mobile-table-scroll">
                                    <Table
                                        style={{width: "100%"}}
                                        columns={teamColumns}
                                        data={rowsForBracket}
                                        pagination={{
                                            pageSize: PAGE_SIZE_TEAM,
                                            current: currentPage,
                                            showTotal: true,
                                        }}
                                        loading={loading}
                                        rowKey={(record) => `${record.id}`}
                                        pagePosition="bottomCenter"
                                        onChange={(pagination) => setCurrentPage(pagination.current ?? 1)}
                                    />
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="participants-mobile-cards">
                                    {individualRows
                                        .slice((currentPage - 1) * PAGE_SIZE_INDIVIDUAL, currentPage * PAGE_SIZE_INDIVIDUAL)
                                        .map((record) => (
                                            <Card key={record.id ?? record.user_id} className="participants-mobile-card" bordered>
                                                <div className="participants-mobile-card__header">
                                                    <div>
                                                        <span className="participants-mobile-card__label">Participant</span>
                                                        <strong>{record.user_name}</strong>
                                                    </div>
                                                    <Tag color="arcoblue">Age {record.age}</Tag>
                                                </div>
                                                <p>{record.user_global_id}</p>
                                                <p>{record.phone_number || "No phone number"}</p>
                                                <div className="participant-list-mobile-actions">
                                                    {renderActionsButton(
                                                        <div className="participant-list-action-menu">
                                                            <Button
                                                                type="text"
                                                                className="participant-list-menu-item"
                                                                loading={loading}
                                                                onClick={() =>
                                                                    window.open(
                                                                        `/tournaments/${tournamentId}/registrations/${record.id}/edit`,
                                                                        "_blank",
                                                                    )
                                                                }
                                                            >
                                                                Edit Participant
                                                            </Button>
                                                            <Button
                                                                type="text"
                                                                className="participant-list-menu-item"
                                                                loading={loading}
                                                                disabled={isStackOutChampionEvent(currentEvent)}
                                                                onClick={() =>
                                                                    handlePrintParticipantTimeSheet(
                                                                        record,
                                                                        currentEvent,
                                                                        currentBracket,
                                                                    )
                                                                }
                                                            >
                                                                {isStackOutChampionEvent(currentEvent)
                                                                    ? "Time Sheet Not Required"
                                                                    : "Print Time Sheet"}
                                                            </Button>
                                                        </div>,
                                                    )}
                                                </div>
                                            </Card>
                                        ))}
                                </div>
                                <div className="participant-list-mobile-pagination">
                                    {individualRows.length > PAGE_SIZE_INDIVIDUAL ? (
                                        <Pagination
                                            current={currentPage}
                                            pageSize={PAGE_SIZE_INDIVIDUAL}
                                            total={individualRows.length}
                                            onChange={setCurrentPage}
                                        />
                                    ) : null}
                                </div>
                                <div className="mobile-table-scroll">
                                    <Table
                                        style={{width: "100%"}}
                                        columns={individualColumns}
                                        data={individualRows}
                                        pagination={{
                                            pageSize: PAGE_SIZE_INDIVIDUAL,
                                            current: currentPage,
                                            showTotal: true,
                                        }}
                                        loading={loading}
                                        rowKey={(record) => record.id ?? record.user_id ?? nanoid()}
                                        pagePosition="bottomCenter"
                                        onChange={(pagination) => setCurrentPage(pagination.current ?? 1)}
                                    />
                                </div>
                            </>
                        )
                    ) : (
                        <div className="participant-list-empty-state">No event or age group is available.</div>
                    )}
                </div>
            </div>
            </div>
            <TeamNameUpdatePreviewModal
                preview={teamNamePreview}
                visible={teamNamePreviewVisible}
                confirmLoading={teamNameConfirmLoading}
                onCancel={() => {
                    if (!teamNameConfirmLoading) {
                        setTeamNamePreviewVisible(false);
                        setTeamNamePreview(null);
                    }
                }}
                onConfirm={handleConfirmTeamNameUpdate}
            />
        </>
    );
}
