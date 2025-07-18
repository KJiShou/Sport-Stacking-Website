import type {Registration, Team, Tournament} from "@/schema";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {
    exportAllBracketsListToPDF,
    exportMasterListToPDF,
    exportParticipantListToPDF,
    generateStackingSheetPDF,
    getCurrentEventData,
} from "@/utils/PDF/pdfExport";
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

interface TeamRow {
    id: string;
    name: string;
    members: {global_id?: string | null; verified?: boolean}[];
    leader_id: string;
    registrationId: string;
    events: string[];
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
            setCurrentEventTab(t?.events?.[0] ? `${t.events[0].code}-${t.events[0].type}` : "");
            setCurrentBracketTab(t?.events?.[0].age_brackets[0] ? `${t.events[0].age_brackets[0].name}` : "");
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

    const filterRegistrations = (evtKey: string, isTeam: boolean) => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();

        if (isTeam) {
            const filteredTeams = teamList.filter(
                (team) =>
                    team.events.includes(evtKey) &&
                    ((team.name?.toLowerCase().includes(lowerCaseSearchTerm) ?? false) ||
                        team.leader_id.toLowerCase().includes(lowerCaseSearchTerm) ||
                        team.members?.some((m) => m.global_id?.toLowerCase().includes(lowerCaseSearchTerm) ?? false)),
            );

            const teamUserIds = new Set(
                filteredTeams.flatMap((team) => [team.leader_id, ...(team.members?.map((m) => m.global_id) ?? [])]),
            );

            return registrationList.filter((r) => teamUserIds.has(r.user_id));
        }
        return registrationList.filter(
            (r) =>
                r.events_registered.includes(evtKey) &&
                (r.user_name.toLowerCase().includes(lowerCaseSearchTerm) ||
                    r.user_id.toLowerCase().includes(lowerCaseSearchTerm)),
        );
    };

    const handleExportToPDF = () => {
        const currentData = getCurrentEventData(tournament, currentEventTab, currentBracketTab, registrationList, searchTerm);

        if (!currentData || !tournament) {
            Message.warning("Please select an event and age bracket to export");
            return;
        }

        try {
            exportParticipantListToPDF({
                tournament,
                eventKey: currentEventTab,
                bracketName: currentBracketTab,
                registrations: currentData.registrations,
                ageMap,
                phoneMap,
                searchTerm,
                isTeamEvent: currentData.isTeamEvent,
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            Message.error("Failed to generate PDF");
        }
    };

    const handlePreviewMasterList = () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        exportMasterListToPDF(tournament, registrationList, ageMap, phoneMap);
        Message.success("Master list PDF opened");
    };

    const handlePreviewAllBrackets = () => {
        if (!tournament) {
            Message.warning("Tournament data not loaded");
            return;
        }
        exportAllBracketsListToPDF(tournament, registrationList, ageMap, phoneMap);
        Message.success("All brackets list PDF opened");
    };

    if (!tournament) return null;

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
            render: (_, record) => (
                <Button
                    type="outline"
                    onClick={() => window.open(`/tournaments/${tournamentId}/registrations/${record.id}/edit`, "_blank")}
                >
                    Edit
                </Button>
            ),
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
                                        onClick={async () => handlePreviewAllBrackets()}
                                    >
                                        All Event List
                                    </Button>
                                    <Button
                                        type="text"
                                        loading={loading}
                                        className={`text-left`}
                                        onClick={async () => {
                                            setLoading(true);
                                            try {
                                                await generateStackingSheetPDF(
                                                    tournament,
                                                    registrationList,
                                                    ageMap,
                                                    currentBracketTab,
                                                    {
                                                        logoUrl: tournament.logo ?? "",
                                                    },
                                                    currentEventTab.split("-")[currentEventTab.split("-").length - 1] || "",
                                                );
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
                <Tabs type="line" destroyOnHide className="w-full" onChange={(key) => setCurrentEventTab(key)}>
                    {tournament.events?.map((evt) => {
                        const evtKey = `${evt.code}-${evt.type}`;
                        const isTeamEvent = ["double", "team relay", "parent & child"].includes(evt.type.toLowerCase());
                        return (
                            <TabPane key={evtKey} title={`${evt.code} (${evt.type})`}>
                                <Tabs
                                    type="capsule"
                                    tabPosition="top"
                                    destroyOnHide
                                    onChange={(key) => setCurrentBracketTab(key)}
                                >
                                    {evt.age_brackets.map((br) => {
                                        const regs = filterRegistrations(evtKey, isTeamEvent);
                                        if (isTeamEvent) {
                                            const teamRows: TeamRow[] = teamList
                                                .filter((team) => team.events.includes(evtKey))
                                                .map((team) => ({
                                                    ...team,
                                                    registrationId: regs.find((r) => r.user_id === team.leader_id)?.id ?? "",
                                                }));

                                            const rowsForBracket = teamRows.filter((record) => {
                                                const ages: number[] = [];
                                                if (record.leader_id && ageMap[record.leader_id] != null) {
                                                    ages.push(ageMap[record.leader_id]);
                                                }
                                                for (const m of record.members) {
                                                    if (m.global_id && ageMap[m.global_id] != null) {
                                                        ages.push(ageMap[m.global_id]);
                                                    }
                                                }
                                                const maxAge = ages.length > 0 ? Math.max(...ages) : -1;
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
                                                    render: (_, record) => {
                                                        const ages: number[] = [];
                                                        if (record.leader_id && ageMap[record.leader_id] != null)
                                                            ages.push(ageMap[record.leader_id]);
                                                        for (const m of record.members) {
                                                            if (m.global_id && ageMap[m.global_id] != null)
                                                                ages.push(ageMap[m.global_id]);
                                                        }
                                                        const maxAge = ages.length ? Math.max(...ages) : "-";
                                                        return <Text>{maxAge}</Text>;
                                                    },
                                                },
                                                {
                                                    title: "Action",
                                                    width: 150,
                                                    render: (_, rec) => (
                                                        <Button
                                                            type="outline"
                                                            size="mini"
                                                            onClick={() =>
                                                                window.open(
                                                                    `/tournaments/${tournamentId}/registrations/${rec.registrationId}/edit`,
                                                                    "_blank",
                                                                )
                                                            }
                                                        >
                                                            Edit
                                                        </Button>
                                                    ),
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
