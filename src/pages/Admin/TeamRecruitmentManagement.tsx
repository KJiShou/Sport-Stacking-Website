import {useAuthContext} from "@/context/AuthContext";
import type {AssignmentModalData, IndividualRecruitment, TeamRecruitment, Tournament} from "@/schema";
import {
    deleteIndividualRecruitment,
    getAllIndividualRecruitments,
    getIndividualRecruitmentsByTournament,
    updateIndividualRecruitmentStatus,
} from "@/services/firebase/individualRecruitmentService";
import {
    getActiveTeamRecruitments,
    getAllTeamRecruitments,
    updateTeamRecruitmentMembersNeeded,
} from "@/services/firebase/teamRecruitmentService";
import {addMemberToTeam, fetchTournamentsByType} from "@/services/firebase/tournamentsService";
import {
    Button,
    Card,
    Descriptions,
    Divider,
    Dropdown,
    Empty,
    Form,
    Input,
    Message,
    Modal,
    Select,
    Spin,
    Table,
    type TableColumnProps,
    Tabs,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconDelete, IconEye, IconMore, IconPlus, IconRefresh, IconUser, IconUserAdd} from "@arco-design/web-react/icon";
import {useEffect, useState} from "react";
import {useNavigate, useSearchParams} from "react-router-dom";
import {useDeviceBreakpoint} from "../../utils/DeviceInspector";
import {DeviceBreakpoint} from "../../utils/DeviceInspector/deviceStore";

const {Title, Paragraph} = Typography;
const {TabPane} = Tabs;
const Option = Select.Option;

export default function TeamRecruitmentManagement() {
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    // Use search params to store selected tournament
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedTournament = searchParams.get("tournament") || "";

    // Data states
    const [individuals, setIndividuals] = useState<IndividualRecruitment[]>([]);
    const [teams, setTeams] = useState<TeamRecruitment[]>([]);

    // Modal states
    const [assignmentModalVisible, setAssignmentModalVisible] = useState(false);
    const [assignmentData, setAssignmentData] = useState<AssignmentModalData | null>(null);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [selectedIndividual, setSelectedIndividual] = useState<IndividualRecruitment | null>(null);

    // Filter states
    const [eventFilter, setEventFilter] = useState<string>("");
    const [statusFilter, setStatusFilter] = useState<string>("");

    const deviceBreakpoint = useDeviceBreakpoint();
    const [assignmentForm] = Form.useForm();

    const navigate = useNavigate();
    // Check admin permissions
    const isAdmin = user?.roles?.edit_tournament || user?.roles?.modify_admin || false;

    // Load tournaments
    const loadTournaments = async () => {
        try {
            setLoading(true);
            const [currentList] = await Promise.all([fetchTournamentsByType("current")]);
            setTournaments(currentList);
            if (currentList.length > 0 && !selectedTournament) {
                // Set the first tournament as selected in params if not set
                setSearchParams({tournament: currentList[0].id || ""});
            }
        } catch (error) {
            console.error("Failed to load tournaments:", error);
            Message.error("Failed to load tournaments");
        } finally {
            setLoading(false);
        }
    };

    // Load recruitment data
    const loadRecruitmentData = async () => {
        try {
            setLoading(true);

            if (selectedTournament) {
                // Load data for specific tournament
                const [individualsData, teamsData] = await Promise.all([
                    getIndividualRecruitmentsByTournament(selectedTournament),
                    getActiveTeamRecruitments(selectedTournament),
                ]);
                setIndividuals(individualsData);
                setTeams(teamsData);
            } else {
                // Load all data
                const [allIndividuals, allTeams] = await Promise.all([getAllIndividualRecruitments(), getAllTeamRecruitments()]);
                setIndividuals(allIndividuals.filter((i) => i.status === "active"));
                setTeams(allTeams.filter((t) => t.status === "active"));
            }
        } catch (error) {
            console.error("Failed to load recruitment data:", error);
            Message.error("Failed to load recruitment data");
        } finally {
            setLoading(false);
        }
    };

    // Handle individual assignment to team
    const handleAssignToTeam = (individual: IndividualRecruitment) => {
        // Find teams that have matching event_id
        const availableTeams = teams.filter(
            (team) => team.tournament_id === individual.tournament_id && team.event_id === individual.event_id,
        );
        setAssignmentData({individual, availableTeams});
        setAssignmentModalVisible(true);
    };

    // Execute assignment
    const executeAssignment = async (values: {teamId: string; action: "assign" | "create"}) => {
        if (!assignmentData) return;

        try {
            setLoading(true);
            const {individual} = assignmentData;

            if (values.action === "assign" && values.teamId) {
                // First add member to the team - verified by admin
                try {
                    await addMemberToTeam(individual.tournament_id, values.teamId, individual.participant_id, true);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    Message.error(`Failed to add participant to team: ${errorMessage}`);
                    setLoading(false);
                    return;
                }

                // Then update the recruitment status
                try {
                    await updateIndividualRecruitmentStatus(individual.id, "matched", values.teamId);
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : "Unknown error";
                    Message.error(`Failed to update recruitment status: ${errorMessage}`);
                    setLoading(false);
                    return;
                }

                // Update team recruitment's max_members_needed and status using service
                const team = teams.find((t) => t.team_id === values.teamId);
                if (team && typeof team.max_members_needed === "number") {
                    const updatedNeeded = Math.max(team.max_members_needed - 1, 0);
                    try {
                        // Use the service function
                        await updateTeamRecruitmentMembersNeeded(
                            team.id,
                            updatedNeeded,
                            updatedNeeded === 0 ? "closed" : "active",
                        );
                    } catch (error) {
                        // Log but don't block UI
                        console.error("Failed to update team recruitment member count:", error);
                    }
                }

                Message.success(`${individual.participant_name} has been successfully assigned to the team!`);
            }

            setAssignmentModalVisible(false);
            setAssignmentData(null);
            assignmentForm.resetFields();
            loadRecruitmentData(); // Refresh data
        } catch (error) {
            console.error("Failed to assign participant:", error);
            const errorMessage = error instanceof Error ? error.message : "Failed to assign participant to team";
            Message.error(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    // Handle individual deletion
    const handleDeleteIndividual = async (individual: IndividualRecruitment) => {
        Modal.confirm({
            title: "Delete Recruitment Request",
            content: `Are you sure you want to delete ${individual.participant_name}'s recruitment request?`,
            okText: "Delete",
            okButtonProps: {status: "danger"},
            onOk: async () => {
                try {
                    await deleteIndividualRecruitment(individual.id);
                    Message.success("Recruitment request deleted");
                    loadRecruitmentData();
                } catch (error) {
                    console.error("Failed to delete recruitment:", error);
                    Message.error("Failed to delete recruitment request");
                }
            },
        });
    };

    // Individual recruitments table columns
    const individualColumns: TableColumnProps<IndividualRecruitment>[] = [
        {
            title: "Participant",
            dataIndex: "participant_name",
            width: 150,
            render: (name: string, record: IndividualRecruitment) => (
                <div>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-gray-500">{record.participant_id}</div>
                </div>
            ),
        },
        {
            title: "Event",
            dataIndex: "event_name",
            width: 180,
            render: (eventName: string, record: IndividualRecruitment) => <Tag>{eventName}</Tag>,
        },
        {
            title: "Age/Gender",
            width: 100,
            render: (_: unknown, record: IndividualRecruitment) => (
                <div className="text-center">
                    <div>{record.age}</div>
                    <Tag size="small" color={record.gender === "Male" ? "blue" : "pink"}>
                        {record.gender}
                    </Tag>
                </div>
            ),
        },
        {
            title: "Country",
            dataIndex: "country",
            width: 100,
        },
        // Removed old events_interested column
        {
            title: "Status",
            dataIndex: "status",
            width: 80,
            render: (status: string) => (
                <Tag color={status === "active" ? "blue" : status === "matched" ? "green" : "gray"}>{status}</Tag>
            ),
        },
        isAdmin && {
            title: "Actions",
            key: "actions",
            width: 120,
            render: (_: unknown, record: IndividualRecruitment) => (
                <Button
                    type="primary"
                    icon={<IconUserAdd style={{marginRight: "4px"}} />}
                    onClick={(e) => {
                        e.stopPropagation();
                        handleAssignToTeam(record);
                    }}
                    disabled={record.status !== "active"}
                >
                    Assign
                </Button>
            ),
        },
    ].filter(Boolean) as TableColumnProps<IndividualRecruitment>[];

    // Team recruitments table columns
    const teamColumns: TableColumnProps<TeamRecruitment>[] = [
        {
            title: "Team Name",
            dataIndex: "team_name",
            width: 150,
            render: (name: string, record: TeamRecruitment) => (
                <div>
                    <div className="font-medium">{name}</div>
                </div>
            ),
        },
        {
            title: "Leader",
            dataIndex: "leader_id",
            width: 120,
        },
        {
            title: "Events",
            dataIndex: "event_name",
            width: 200,
            render: (eventName: string) => (
                <div>
                    <Tag key={eventName} size="small" className="mb-1">
                        {eventName}
                    </Tag>
                </div>
            ),
        },
        {
            title: "Max Members Needed",
            dataIndex: "max_members_needed",
            width: 120,
            render: (count: number) => count || "Not specified",
        },
        {
            title: "Status",
            dataIndex: "status",
            width: 80,
            render: (status: string) => <Tag color={status === "active" ? "blue" : "gray"}>{status}</Tag>,
        },
    ];

    useEffect(() => {
        if (isAdmin) {
            loadTournaments();
        }
    }, [isAdmin]);

    useEffect(() => {
        if (isAdmin && selectedTournament) {
            loadRecruitmentData();
        }
    }, [selectedTournament, isAdmin]);

    // Render access denied after all hooks
    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <Title heading={3}>Access Denied</Title>
                    <Paragraph>You don't have permission to access this page.</Paragraph>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <Spin loading={loading} tip="Loading recruitment data..." className="w-full">
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                    <div className="w-full">
                        {/* Header */}
                        <div className="flex justify-between items-center mb-6">
                            <Title heading={2}>Team Recruitment Management</Title>
                            <Button type="primary" icon={<IconRefresh />} onClick={loadRecruitmentData} loading={loading}>
                                Refresh
                            </Button>
                        </div>

                        {/* Tournament Filter */}
                        <div className="mb-6 flex flex-wrap gap-4 items-center">
                            <div>
                                <label htmlFor="tournament-select" className="block text-sm font-medium mb-1">
                                    Tournament:
                                </label>
                                <Select
                                    id="tournament-select"
                                    placeholder="Select Tournament"
                                    style={{width: 250}}
                                    value={selectedTournament}
                                    onChange={(val) => setSearchParams({tournament: val})}
                                >
                                    {tournaments.length === 0 && <Option value="">No tournaments available</Option>}
                                    {tournaments.map((tournament) => (
                                        <Option key={tournament.id} value={tournament.id || ""}>
                                            {tournament.name}
                                        </Option>
                                    ))}
                                </Select>
                            </div>

                            {/* Summary Cards */}
                            <div className="flex gap-4 ml-auto">
                                <Card className="text-center">
                                    <div className="text-2xl font-bold text-blue-600">{individuals.length}</div>
                                    <div className="text-sm text-gray-600">Looking for Teams</div>
                                </Card>
                                <Card className="text-center">
                                    <div className="text-2xl font-bold text-green-600">{teams.length}</div>
                                    <div className="text-sm text-gray-600">Teams Need Members</div>
                                </Card>
                            </div>
                        </div>

                        <Divider />

                        {/* Tabs */}
                        <Tabs defaultActiveTab="individuals">
                            <TabPane key="individuals" title={`Individuals Looking for Teams (${individuals.length})`}>
                                {individuals.length === 0 ? (
                                    <Empty description="No individuals looking for teams" />
                                ) : (
                                    <Table
                                        rowKey="id"
                                        columns={individualColumns}
                                        data={individuals}
                                        pagination={{pageSize: 10}}
                                        onRow={(individual) => ({
                                            onClick: () => {
                                                navigate(
                                                    `/tournaments/${selectedTournament}/registrations/${individual.registration_id}/edit`,
                                                );
                                            },
                                        })}
                                        className="mt-4"
                                        scroll={{x: 800}}
                                    />
                                )}
                            </TabPane>

                            <TabPane key="teams" title={`Teams Looking for Members (${teams.length})`}>
                                {teams.length === 0 ? (
                                    <Empty description="No teams looking for members" />
                                ) : (
                                    <Table
                                        rowKey="id"
                                        columns={teamColumns}
                                        data={teams}
                                        pagination={{pageSize: 10}}
                                        onRow={(team) => ({
                                            onClick: () => {
                                                navigate(
                                                    `/tournaments/${selectedTournament}/registrations/${team.registration_id}/edit`,
                                                );
                                            },
                                        })}
                                        className="mt-4"
                                        scroll={{x: 600}}
                                    />
                                )}
                            </TabPane>
                        </Tabs>
                    </div>

                    {/* Assignment Modal */}
                    <Modal
                        title="Assign Participant to Team"
                        visible={assignmentModalVisible}
                        onCancel={() => {
                            setAssignmentModalVisible(false);
                            setAssignmentData(null);
                            assignmentForm.resetFields();
                        }}
                        onOk={() => assignmentForm.submit()}
                        okText="Assign"
                        className="w-full max-w-2xl"
                    >
                        {assignmentData && (
                            <Form form={assignmentForm} layout="vertical" onSubmit={executeAssignment}>
                                <div className="mb-4 p-4 bg-gray-50 rounded">
                                    <Title heading={6}>Participant Information</Title>
                                    <Descriptions
                                        column={2}
                                        data={[
                                            {label: "Name", value: assignmentData.individual.participant_name},
                                            {label: "Age", value: assignmentData.individual.age},
                                            {label: "Gender", value: assignmentData.individual.gender},
                                            {label: "Country", value: assignmentData.individual.country},
                                        ]}
                                    />
                                    <div className="mt-2">
                                        <strong>Event:</strong> {assignmentData.individual.event_name}
                                    </div>
                                </div>

                                <Form.Item
                                    label="Assignment Action"
                                    field="action"
                                    initialValue="assign"
                                    rules={[{required: true}]}
                                >
                                    <Select placeholder="Select action">
                                        <Option value="assign">Assign to existing team</Option>
                                    </Select>
                                </Form.Item>

                                <Form.Item shouldUpdate noStyle>
                                    {(_, form) => {
                                        const action = form.getFieldValue("action");
                                        if (action === "assign") {
                                            return (
                                                <Form.Item
                                                    label="Select Team"
                                                    field="teamId"
                                                    rules={[{required: true, message: "Please select a team"}]}
                                                >
                                                    <Select placeholder="Select team">
                                                        {assignmentData.availableTeams.map((team) => (
                                                            <Option key={team.id} value={team.team_id}>
                                                                <div>
                                                                    <div className="font-medium">{team.team_name}</div>
                                                                    <div className="text-xs text-gray-500">
                                                                        Event: {team.event_name}
                                                                    </div>
                                                                </div>
                                                            </Option>
                                                        ))}
                                                    </Select>
                                                </Form.Item>
                                            );
                                        }
                                        return null;
                                    }}
                                </Form.Item>
                            </Form>
                        )}
                    </Modal>

                    {/* Detail Modal */}
                    <Modal
                        title="Participant Details"
                        visible={detailModalVisible}
                        onCancel={() => {
                            setDetailModalVisible(false);
                            setSelectedIndividual(null);
                        }}
                        footer={null}
                        className="w-full max-w-2xl"
                    >
                        {/* Detail modal removed as per requirements */}
                    </Modal>
                </div>
            </Spin>
        </div>
    );
}
