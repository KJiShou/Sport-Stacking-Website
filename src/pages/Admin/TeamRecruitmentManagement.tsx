import {useAuthContext} from "@/context/AuthContext";
import type {AssignmentModalData, IndividualRecruitment, TeamRecruitment, Tournament} from "@/schema";
import {
    deleteIndividualRecruitment,
    getAllIndividualRecruitments,
    getIndividualRecruitmentsByTournament,
    updateIndividualRecruitmentStatus,
} from "@/services/firebase/individualRecruitmentService";
import {getActiveTeamRecruitments, getAllTeamRecruitments} from "@/services/firebase/teamRecruitmentService";
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
import {useDeviceBreakpoint} from "../../utils/DeviceInspector";
import {DeviceBreakpoint} from "../../utils/DeviceInspector/deviceStore";

const {Title, Paragraph} = Typography;
const {TabPane} = Tabs;
const Option = Select.Option;

export default function TeamRecruitmentManagement() {
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournaments, setTournaments] = useState<Tournament[]>([]);
    const [selectedTournament, setSelectedTournament] = useState<string>("");

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

    // Check admin permissions
    const isAdmin = user?.roles?.edit_tournament || user?.roles?.modify_admin || false;

    // Load tournaments
    const loadTournaments = async () => {
        try {
            setLoading(true);
            const [currentList] = await Promise.all([fetchTournamentsByType("current")]);
            setTournaments(currentList);
            if (currentList.length > 0 && !selectedTournament) {
                setSelectedTournament(currentList[0].id || "");
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
        // Find teams that have matching events
        const matchingEvents = individual.events_interested;
        const availableTeams = teams.filter(
            (team) =>
                team.tournament_id === individual.tournament_id && team.events.some((event) => matchingEvents.includes(event)),
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
                // First add member to the team
                try {
                    await addMemberToTeam(individual.tournament_id, values.teamId, individual.participant_id);
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
        {
            title: "Events Interested",
            dataIndex: "events_interested",
            width: 200,
            render: (events: string[]) => (
                <div>
                    {events.map((event) => (
                        <Tag key={event} size="small" className="mb-1">
                            {event}
                        </Tag>
                    ))}
                </div>
            ),
        },
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
                <Dropdown.Button
                    size="mini"
                    trigger={["click"]}
                    onClick={() => handleAssignToTeam(record)}
                    droplist={
                        <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg">
                            <Button
                                type="text"
                                className="text-left"
                                onClick={() => {
                                    setSelectedIndividual(record);
                                    setDetailModalVisible(true);
                                }}
                            >
                                <IconEye style={{marginRight: "8px"}} />
                                View Details
                            </Button>
                            <Button
                                type="text"
                                status="danger"
                                className="text-left"
                                onClick={() => handleDeleteIndividual(record)}
                            >
                                <IconDelete style={{marginRight: "8px"}} />
                                Delete
                            </Button>
                        </div>
                    }
                    disabled={record.status !== "active"}
                >
                    <IconUserAdd style={{marginRight: "4px"}} />
                    Assign
                </Dropdown.Button>
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
                    <div className="text-xs text-gray-500">ID: {record.team_id}</div>
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
            dataIndex: "events",
            width: 200,
            render: (events: string[]) => (
                <div>
                    {events.map((event) => (
                        <Tag key={event} size="small" className="mb-1">
                            {event}
                        </Tag>
                    ))}
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
                                    onChange={setSelectedTournament}
                                >
                                    <Option value="">All Tournaments</Option>
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
                                        <strong>Events Interested:</strong>{" "}
                                        {assignmentData.individual.events_interested.join(", ")}
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
                                                                        Events: {team.events.join(", ")}
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
                        {selectedIndividual && (
                            <div>
                                <Descriptions
                                    column={2}
                                    data={[
                                        {label: "Participant ID", value: selectedIndividual.participant_id},
                                        {label: "Name", value: selectedIndividual.participant_name},
                                        {label: "Age", value: selectedIndividual.age},
                                        {label: "Gender", value: selectedIndividual.gender},
                                        {label: "Country", value: selectedIndividual.country},
                                        {label: "Phone Number", value: selectedIndividual.phone_number || "Not provided"},
                                        {label: "Status", value: selectedIndividual.status},
                                    ]}
                                />
                                <div className="mt-4">
                                    <Title heading={6}>Events Interested</Title>
                                    <div className="mt-2">
                                        {selectedIndividual.events_interested.map((event) => (
                                            <Tag key={event} className="mb-1 mr-1">
                                                {event}
                                            </Tag>
                                        ))}
                                    </div>
                                </div>
                                {selectedIndividual.additional_info && (
                                    <div className="mt-4">
                                        <Title heading={6}>Additional Information</Title>
                                        <Paragraph>{selectedIndividual.additional_info}</Paragraph>
                                    </div>
                                )}
                            </div>
                        )}
                    </Modal>
                </div>
            </Spin>
        </div>
    );
}
