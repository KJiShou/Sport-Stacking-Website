import type {Registration, Team, Tournament, TournamentEvent} from "@/schema";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {
    exportAllBracketsListToPDF,
    exportMasterListToPDF,
    exportNameListStickerPDF,
    exportParticipantListToPDF,
    generateAllTeamStackingSheetsPDF,
    generateStackingSheetPDF,
    generateTeamStackingSheetPDF,
    getCurrentEventData,
} from "@/utils/PDF/pdfExport";
import {
    getEventKey,
    getTeamEventLabels,
    isTeamEvent,
    matchesAnyEventKey,
    matchesEventKey,
    sanitizeEventCodes,
    teamMatchesEventKey,
} from "@/utils/tournament/eventUtils";
import {Button, Dropdown, Input, Menu, Message, Table, Tabs, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconUndo} from "@arco-design/web-react/icon";
import {nanoid} from "nanoid";
// src/pages/ParticipantListPage.tsx
import React, {useState, useRef} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";

const {Title, Text} = Typography;
const {TabPane} = Tabs;

interface TeamRow extends Team {
    registrationId: string;
}

export default function ParticipantListPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registrationList, setRegistrationList] = useState<Registration[]>([]);
    const [teamList, setTeamList] = useState<Team[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const mountedRef = useRef(false);

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
            acc[r.user_id] = r.phone_number || "N/A";
            return acc;
        },
        {} as Record<string, string>,
    );

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            const firstEvent = t?.events?.[0];
            const firstEventKey = firstEvent ? getEventKey(firstEvent) : "";
            setCurrentEventTab(firstEventKey);
            const firstBracket = firstEvent?.age_brackets?.[0];
            setCurrentBracketTab(firstBracket ? firstBracket.name : "");
            const regs = await fetchRegistrations(tournamentId);
            const teams = await fetchTeamsByTournament(tournamentId);
            setRegistrationList(regs.filter((r) => r.registration_status === "approved"));
            setTeamList(teams);
        } catch {
            Message.error("Unable to fetch participants");
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        refreshParticipantList();
    });

    const filterRegistrations = (evtKey: string, isTeam: boolean, event?: TournamentEvent) => {
        const normalizedSearch = searchTerm.trim().toLowerCase();

        if (isTeam) {
            const filteredTeams = teamList.filter((team) => {
                if (!teamMatchesEventKey(team, evtKey, tournament?.events ?? [])) {
                    return false;
                }

                if (normalizedSearch.length === 0) {
                    return true;
                }

                const matchesName = team.name ? team.name.toLowerCase().includes(normalizedSearch) : false;
                const matchesLeader = team.leader_id ? team.leader_id.toLowerCase().includes(normalizedSearch) : false;
                const matchesMembers =
                    team.members?.some((member) => member.global_id?.toLowerCase().includes(normalizedSearch) ?? false) ??
                    false;

                return matchesName || matchesLeader || matchesMembers;
            });

            const teamUserIds = new Set(
                filteredTeams.flatMap((team) => [team.leader_id, ...(team.members?.map((m) => m.global_id) ?? [])]),
            );

            return registrationList.filter((r) => teamUserIds.has(r.user_id));
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

            const nameMatches = r.user_name?.toLowerCase().includes(normalizedSearch) ?? false;
            const idMatches = r.user_id?.toLowerCase().includes(normalizedSearch) ?? false;
            return nameMatches || idMatches;
        });
    };

    const handleEventTabChange = (key: string) => {
        setCurrentEventTab(key);

        if (!tournament?.events) {
            return;
        }

        const selectedEvent =
            tournament.events.find((evt) => getEventKey(evt) === key) ||
            tournament.events.find((evt) => matchesEventKey(key, evt));

        const nextBracket = selectedEvent?.age_brackets?.[0]?.name ?? "";
        setCurrentBracketTab(nextBracket);
    };

    const handleExportToPDF = async () => {
        const currentData = getCurrentEventData(
            tournament,
            currentEventTab,
            currentBracketTab,
            registrationList,
            searchTerm,
            teamList,
        );

        if (!currentData || !tournament) {
            Message.warning("Please select an event and age bracket to export");
            return;
        }

        try {
            setLoading(true);
            await exportParticipantListToPDF({
                tournament,
                eventKey: currentEventTab,
                bracketName: currentBracketTab,
                registrations: currentData.registrations,
                ageMap,
                phoneMap,
                searchTerm,
                isTeamEvent: currentData.isTeamEvent,
                logoDataUrl: tournament.logo ?? "",
                teams: teamList,
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
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

    const handlePreviewMasterList = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        await exportMasterListToPDF({
            tournament,
            registrations: registrationList,
            ageMap,
            phoneMap,
        });
        setLoading(false);
        Message.success("Master list PDF opened");
    };

    const handlePreviewAllBrackets = async () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        setLoading(true);
        try {
            await exportAllBracketsListToPDF(tournament, registrationList, teamList, ageMap, phoneMap);
            Message.success("All brackets list PDF opened");
        } catch (error) {
            Message.error("Failed to generate PDF");
        } finally {
            setLoading(false);
        }
    };

    if (!tournament) return null;

    const tournamentEvents = tournament.events ?? [];

    const individualColumns: TableColumnProps<Registration>[] = [
        {title: "Global ID", dataIndex: "user_id", width: 150},
        {title: "Name", dataIndex: "user_name", width: 200},
        {title: "Age", dataIndex: "age", width: 100},
        {
            title: "Phone Number",
            width: 150,
            render: (_, record) => <Text>{record.phone_number || "N/A"}</Text>,
        },
        {
            title: "Action",
            width: 150,
            render: (_, record) => {
                const {event, bracket} =
                    getCurrentEventData(
                        tournament,
                        currentEventTab,
                        currentBracketTab,
                        registrationList,
                        searchTerm,
                        teamList,
                    ) ?? {};

                if (!event || !bracket) return null;

                const droplist = (
                    <div className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}>
                        <Button
                            type="text"
                            className={`text-left`}
                            loading={loading}
                            onClick={async () => {
                                setLoading(true);
                                await generateStackingSheetPDF(
                                    tournament,
                                    [record],
                                    ageMap,
                                    bracket.name,
                                    {
                                        logoUrl: tournament.logo ?? "",
                                    },
                                    event.type,
                                );
                                setLoading(false);
                            }}
                        >
                            Print Time Sheet
                        </Button>
                    </div>
                );

                return (
                    <Dropdown.Button
                        type="primary"
                        size="default"
                        droplist={droplist}
                        trigger={["click", "hover"]}
                        buttonProps={{
                            onClick: () => window.open(`/tournaments/${tournamentId}/registrations/${record.id}/edit`, "_blank"),
                        }}
                    >
                        Edit
                    </Dropdown.Button>
                );
            },
        },
    ];

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>{tournament.name} Participants</Title>
                    <div className="flex items-center gap-4">
                        <Input.Search
                            placeholder="Search by name or ID"
                            allowClear
                            style={{width: 300}}
                            onChange={(val) => setSearchTerm(val.trim())}
                        />
                        <Dropdown.Button
                            type="primary"
                            trigger={["click", "hover"]}
                            droplist={
                                <div
                                    className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                >
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => handlePreviewMasterList()}
                                    >
                                        Master List
                                    </Button>
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={handlePreviewAllBrackets}
                                    >
                                        All Event List
                                    </Button>
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={handleExportNameListSticker}
                                    >
                                        Name List Sticker
                                    </Button>
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => {
                                            setLoading(true);
                                            try {
                                                const currentData = getCurrentEventData(
                                                    tournament,
                                                    currentEventTab,
                                                    currentBracketTab,
                                                    registrationList,
                                                    searchTerm,
                                                    teamList,
                                                );
                                                if (!currentData) {
                                                    Message.error("No event data found");
                                                    setLoading(false);
                                                    return;
                                                }
                                                if (currentData.isTeamEvent) {
                                                    const teamsInBracket = teamList.filter((team) => {
                                                        const maxAge = team.largest_age;
                                                        return (
                                                            maxAge >= currentData.bracket.min_age &&
                                                            maxAge <= currentData.bracket.max_age &&
                                                            teamMatchesEventKey(team, currentEventTab, tournamentEvents)
                                                        );
                                                    });
                                                    await generateAllTeamStackingSheetsPDF(
                                                        tournament,
                                                        teamsInBracket,
                                                        ageMap,
                                                        currentBracketTab,
                                                        {
                                                            logoUrl: tournament.logo ?? "",
                                                        },
                                                        currentData.event.type,
                                                    );
                                                } else {
                                                    await generateStackingSheetPDF(
                                                        tournament,
                                                        currentData.registrations,
                                                        ageMap,
                                                        currentBracketTab,
                                                        {
                                                            logoUrl: tournament.logo ?? "",
                                                        },
                                                        currentData.event.type,
                                                    );
                                                }
                                            } catch (error) {
                                                Message.error("Failed to generate stacking sheet PDF");
                                            } finally {
                                                setLoading(false);
                                            }
                                        }}
                                    >
                                        Time Sheet
                                    </Button>
                                </div>
                            }
                            buttonProps={{
                                loading: loading,
                                onClick: () => handleExportToPDF(),
                            }}
                        >
                            Current Name List
                        </Dropdown.Button>
                    </div>
                </div>
                <Tabs
                    type="line"
                    destroyOnHide
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={handleEventTabChange}
                >
                    {tournament.events?.map((evt) => {
                        const tabKey = getEventKey(evt);
                        const isTeamEventForTab = isTeamEvent(evt);
                        const regs = filterRegistrations(tabKey, isTeamEventForTab, evt);
                        const scoringCodes = sanitizeEventCodes(evt.codes);
                        const hasCodes = scoringCodes.length > 0;
                        const titleCodes = hasCodes ? scoringCodes.join(", ") : evt.codes?.join(", ") || "N/A";
                        return (
                            <TabPane key={tabKey} title={`${evt.type} (${titleCodes})`}>
                                {" "}
                                <Tabs
                                    type="capsule"
                                    tabPosition="top"
                                    destroyOnHide
                                    activeTab={currentBracketTab}
                                    onChange={(key) => setCurrentBracketTab(key)}
                                >
                                    {evt.age_brackets.map((br) => {
                                        if (isTeamEventForTab) {
                                            const teamRows: TeamRow[] = teamList
                                                .filter((team) => teamMatchesEventKey(team, tabKey, tournamentEvents))
                                                .map((team) => ({
                                                    ...team,
                                                    registrationId:
                                                        regs.find((r) => r.user_id === team.leader_id)?.id ?? "",
                                                }));

                                            const rowsForBracket = teamRows.filter((record) => {
                                                const maxAge = record.largest_age;
                                                return maxAge >= br.min_age && maxAge <= br.max_age;
                                            });
                                            const teamColumns: TableColumnProps<TeamRow>[] = [
                                                {
                                                    title: "Team Leader",
                                                    width: 150,
                                                    render: (_, record) => <Text>{record.leader_id ?? "N/A"}</Text>,
                                                },
                                                {title: "Team Name", dataIndex: "name", width: 200},
                                                {
                                                    title: "Members",
                                                    width: 300,
                                                    render: (_, record) => (
                                                        <Text>{record.members.map((m) => m.global_id ?? "-").join(", ")}</Text>
                                                    ),
                                                },
                                                {
                                                    title: "Leader Phone",
                                                    width: 150,
                                                    render: (_, record) => (
                                                        <Text>
                                                            {record.leader_id ? phoneMap[record.leader_id] || "N/A" : "N/A"}
                                                        </Text>
                                                    ),
                                                },
                                                {
                                                    title: "Largest Age",
                                                    width: 150,
                                                    render: (_, record) => <Text>{record.largest_age ?? "-"}</Text>,
                                                },
                                                {
                                                    title: "Action",
                                                    width: 200,
                                                    render: (_, rec) => {
                                                        const teamMembers = rec.members.map((member) => {
                                                            const registration = registrationList.find(
                                                                (r) => r.user_id === member.global_id,
                                                            );
                                                            return {
                                                                ...member,
                                                                name: registration ? registration.user_name : member.global_id,
                                                                registration: registration,
                                                            };
                                                        });

                                                        const droplist = (
                                                            <div
                                                                className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                                            >
                                                                <Button
                                                                    type="text"
                                                                    className={`text-left`}
                                                                    loading={loading}
                                                                    onClick={async () => {
                                                                        setLoading(true);
                                                                        await exportParticipantListToPDF({
                                                                            tournament,
                                                                            eventKey: tabKey,
                                                                            bracketName: br.name,
                                                                            registrations: registrationList,
                                                                            ageMap,
                                                                            phoneMap,
                                                                            isTeamEvent: true,
                                                                            team: rec,
                                                                            logoDataUrl: tournament.logo ?? "",
                                                                        });
                                                                        setLoading(false);
                                                                    }}
                                                                >
                                                                    Print Member List
                                                                </Button>
                                                                <Button
                                                                    type="text"
                                                                    className={`text-left`}
                                                                    loading={loading}
                                                                    onClick={async () => {
                                                                        setLoading(true);
                                                                        await generateTeamStackingSheetPDF(
                                                                            tournament,
                                                                            rec,
                                                                            ageMap,
                                                                            br.name,
                                                                            {logoUrl: tournament.logo ?? ""},
                                                                            evt.type,
                                                                        );
                                                                        setLoading(false);
                                                                    }}
                                                                >
                                                                    Team Time Sheet
                                                                </Button>
                                                            </div>
                                                        );

                                                        return (
                                                            <div className="flex gap-2">
                                                                <Dropdown.Button
                                                                    type="primary"
                                                                    size="default"
                                                                    droplist={droplist}
                                                                    trigger={["click", "hover"]}
                                                                    buttonProps={{
                                                                        onClick: () =>
                                                                            window.open(
                                                                                `/tournaments/${tournamentId}/registrations/${rec.registrationId}/edit`,
                                                                                "_blank",
                                                                            ),
                                                                    }}
                                                                >
                                                                    Edit
                                                                </Dropdown.Button>
                                                            </div>
                                                        );
                                                    },
                                                },
                                            ];
                                            return (
                                                <TabPane key={br.name} title={`${br.name} (${br.min_age}-${br.max_age})`}>
                                                    <Table
                                                        style={{width: "100%"}}
                                                        columns={teamColumns}
                                                        data={rowsForBracket}
                                                        pagination={{pageSize: 5, showTotal: true}}
                                                        loading={loading}
                                                        rowKey={(rec) => `${rec.registrationId}-${rec.id}`}
                                                        pagePosition="bottomCenter"
                                                    />
                                                </TabPane>
                                            );
                                        }
                                        const individualRows = regs.filter((r) => r.age >= br.min_age && r.age <= br.max_age);
                                        return (
                                            <TabPane key={br.name} title={`${br.name} (${br.min_age}-${br.max_age})`}>
                                                <Table
                                                    style={{width: "100%"}}
                                                    columns={individualColumns}
                                                    data={individualRows}
                                                    pagination={{pageSize: 10, showTotal: true}}
                                                    loading={loading}
                                                    rowKey={(r) => r.id ?? r.user_id ?? nanoid()}
                                                    pagePosition="bottomCenter"
                                                />
                                            </TabPane>
                                        );
                                    })}
                                </Tabs>
                            </TabPane>
                        );
                    })}
                </Tabs>
            </div>
        </div>
    );
}
