import {
    Button,
    Card,
    Divider,
    Dropdown,
    Empty,
    Form,
    Input,
    Menu,
    Message,
    Modal,
    Select,
    Space,
    Spin,
    Table,
    Tabs,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconDelete, IconEdit, IconEye, IconMore, IconVideoCamera} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useState} from "react";
import {useAuthContext} from "../../context/AuthContext";
import type {GlobalResult, GlobalTeamResult, RecordDisplay} from "../../schema/RecordSchema";

import {
    deleteRecord,
    getBestRecordsByAgeGroup,
    toggleRecordVerification,
    updateRecordVideoUrl,
} from "../../services/firebase/recordService";

// Extended types that include the Firestore document ID
type GlobalResultWithId = GlobalResult & {id: string};
type GlobalTeamResultWithId = GlobalTeamResult & {id: string};

const {Title, Paragraph, Text} = Typography;
const TabPane = Tabs.TabPane;
const Option = Select.Option;

type RecordCategory = "individual" | "team_relay" | "double" | "parent_&_child" | "special_need";
type EventType = "3-3-3" | "3-6-3" | "Cycle" | "Double" | "Team Relay" | "Parent & Child";
type AgeGroup = "6U" | "8U" | "10U" | "12U" | "14U" | "17U" | "Open" | "Overall";

// Match the service types
type Category = "Individual" | "Double" | "Parent & Child" | "Team Relay" | "Special Need";
type EventTypeKey = "3-3-3" | "3-6-3" | "Cycle";

// Map UI tab keys -> display category labels
const CATEGORY_MAP: Record<RecordCategory, Category> = {
    individual: "Individual",
    double: "Double",
    team_relay: "Team Relay",
    "parent_&_child": "Parent & Child",
    special_need: "Special Need",
};

// Map display categories to backend system categories
const BACKEND_CATEGORY_MAP: Record<Category, string> = {
    Individual: "individual",
    Double: "double",
    "Team Relay": "team_relay",
    "Parent & Child": "parent_&_child",
    "Special Need": "special_need",
};

// Shape returned by getBestRecordsByAgeGroup()
type BestRecordsShape = Record<Category, Partial<Record<EventTypeKey, (GlobalResult | GlobalTeamResult)[]>>>;

// Events per category for the UI
const EVENTS_FOR_CATEGORY: Record<Category, EventTypeKey[]> = {
    Individual: ["3-3-3", "3-6-3", "Cycle"],
    Double: ["Cycle"],
    "Parent & Child": ["Cycle"],
    "Team Relay": ["Cycle", "3-6-3"],
    "Special Need": ["3-3-3", "3-6-3", "Cycle"],
};

const formatTime = (time: number): string => {
    if (time === 0) return "DNF";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const milliseconds = Math.floor((time % 1) * 100);

    if (minutes > 0) {
        return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
    }
    return `${seconds}.${milliseconds.toString().padStart(2, "0")}`;
};

const formatDate = (dateString: string): string => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};

const getCountryFlag = (country?: string): string => {
    const flagMap: Record<string, string> = {
        "United States": "🇺🇸",
        Malaysia: "🇲🇾",
        Korea: "🇰🇷",
        "Chinese Taipei": "🇹🇼",
        China: "🇨🇳",
        Japan: "🇯🇵",
        Singapore: "🇸🇬",
        Thailand: "🇹🇭",
        Vietnam: "🇻🇳",
        Indonesia: "🇮🇩",
        Philippines: "🇵🇭",
    };
    return flagMap[country || ""] || "🌍";
};

const AGE_GROUPS: AgeGroup[] = ["Overall", "6U", "8U", "10U", "12U", "14U", "17U", "Open"];

const getAgeGroup = (age: number): AgeGroup => {
    if (age <= 6) return "6U";
    if (age <= 8) return "8U";
    if (age <= 10) return "10U";
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    if (age <= 17) return "17U";
    return "Open";
};

const RecordsIndex: React.FC = () => {
    const {user} = useAuthContext();
    const [activeCategory, setActiveCategory] = useState<RecordCategory>("individual");
    const [allRecords, setAllRecords] = useState<BestRecordsShape>({
        Individual: {},
        Double: {},
        "Parent & Child": {},
        "Team Relay": {},
        "Special Need": {},
    });
    const [loading, setLoading] = useState(true);
    const [selectedAgeGroup, setSelectedAgeGroup] = useState<AgeGroup>("Overall");

    // Admin modal states
    const [selectedRecord, setSelectedRecord] = useState<RecordDisplay | null>(null);
    const [editVideoModalVisible, setEditVideoModalVisible] = useState(false);
    const [videoForm] = Form.useForm();

    // Check if user has admin permissions
    const isAdmin = user?.roles?.verify_record || user?.roles?.edit_tournament || false;

    useEffect(() => {
        loadRecords();
    }, []);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const records = await getBestRecordsByAgeGroup();
            setAllRecords(records);
        } catch (error) {
            console.error("Failed to load records:", error);
        } finally {
            setLoading(false);
        }
    };

    // Admin action handlers
    const handleTimeClick = (record: RecordDisplay) => {
        if (record.videoUrl && (record.status === "verified" || isAdmin)) {
            window.open(record.videoUrl, "_blank", "noopener,noreferrer");
        }
    };

    const handleEditVideo = (record: RecordDisplay) => {
        setSelectedRecord(record);
        videoForm.setFieldsValue({
            videoUrl: record.videoUrl || "",
        });
        setEditVideoModalVisible(true);
    };

    const handleToggleVerification = async (record: RecordDisplay) => {
        if (!user?.global_id || !record.recordId) {
            Message.error("Missing required information for verification");
            return;
        }

        try {
            // Determine category and eventType based on current tab and event
            const displayCategory = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
            const backendCategory = BACKEND_CATEGORY_MAP[displayCategory];
            const eventType = (activeCategory === "individual" ? selectedIndividualEvent : record.event) as EventTypeKey;

            await toggleRecordVerification(
                backendCategory as "individual" | "double" | "parent_&_child" | "team_relay" | "special_need",
                eventType,
                record.recordId,
                user.global_id,
                record.status,
            );
            const action = record.status === "submitted" ? "verified" : "unverified";
            Message.success(`Record ${action} successfully for ${record.athlete}`);
            window.location.reload(); // Refresh the entire page
        } catch (error) {
            console.error("Failed to toggle verification:", error);
            Message.error("Failed to update record verification");
        }
    };

    const handleDeleteRecord = async (record: RecordDisplay) => {
        if (!record.recordId) {
            Message.error("Missing record information for deletion");
            return;
        }

        Modal.confirm({
            title: "Delete Record",
            content: `Are you sure you want to delete ${record.athlete}'s ${record.event} record?`,
            okText: "Delete",
            okButtonProps: {status: "danger"},
            onOk: async () => {
                try {
                    // Determine category and eventType based on current tab and event
                    const displayCategory = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
                    const backendCategory = BACKEND_CATEGORY_MAP[displayCategory];
                    const eventType = (activeCategory === "individual" ? selectedIndividualEvent : record.event) as EventTypeKey;

                    await deleteRecord(
                        backendCategory as "individual" | "double" | "parent_&_child" | "team_relay" | "special_need",
                        eventType,
                        record.recordId ?? "",
                    );
                    Message.success("Record deleted successfully");
                    loadRecords(); // Refresh records
                } catch (error) {
                    console.error("Failed to delete record:", error);
                    Message.error("Failed to delete record");
                }
            },
        });
    };

    const handleSaveVideoUrl = async () => {
        if (!selectedRecord?.recordId) {
            Message.error("Missing record information for video update");
            return;
        }

        try {
            const values = await videoForm.validate();

            // Determine category and eventType based on current tab and event
            const displayCategory = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
            const backendCategory = BACKEND_CATEGORY_MAP[displayCategory];
            const eventType = (activeCategory === "individual" ? selectedIndividualEvent : selectedRecord.event) as EventTypeKey;

            await updateRecordVideoUrl(
                backendCategory as "individual" | "double" | "parent_&_child" | "team_relay" | "special_need",
                eventType,
                selectedRecord.recordId,
                values.videoUrl,
            );
            Message.success("Video URL updated successfully");
            setEditVideoModalVisible(false);
            videoForm.resetFields();
            loadRecords(); // Refresh records
        } catch (error) {
            console.error("Failed to update video URL:", error);
            Message.error("Failed to update video URL");
        }
    };

    const getTableColumns = () => {
        return [
            {
                title: "Rank",
                dataIndex: "rank",
                key: "rank",
                width: 70,
                render: (rank: number) => (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontWeight: "bold",
                            color: rank <= 3 ? "#faad14" : "#666",
                        }}
                    >
                        {rank <= 3 && <span style={{marginRight: "4px"}}>{rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</span>}
                        {rank}
                    </div>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.rank - b.rank,
            },
            {
                title: "Event",
                dataIndex: "event",
                key: "event",
                width: 120,
                render: (event: string) => (
                    <Tag color="blue" style={{fontSize: "12px"}}>
                        {event}
                    </Tag>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.event.localeCompare(b.event),
            },
            {
                title: "Time",
                dataIndex: "time",
                key: "time",
                width: 100,
                render: (time: string, record: RecordDisplay) => (
                    <Text
                        style={{
                            fontWeight: "bold",
                            color: record.rank === 1 ? "#52c41a" : "#1890ff",
                            fontSize: "14px",
                            cursor: record.videoUrl && (record.status === "verified" || isAdmin) ? "pointer" : "default",
                            textDecoration: record.videoUrl && (record.status === "verified" || isAdmin) ? "underline" : "none",
                        }}
                        onClick={() => handleTimeClick(record)}
                    >
                        {time}
                        {record.videoUrl && <IconVideoCamera style={{marginLeft: "4px", fontSize: "12px"}} />}
                    </Text>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => {
                    return a.rawTime - b.rawTime;
                },
            },
            {
                title: "Athlete",
                dataIndex: "athlete",
                key: "athlete",
                width: 200,
                render: (athlete: string, record: RecordDisplay) => (
                    <Text
                        style={{
                            fontWeight: record.rank <= 3 ? "bold" : "500",
                            cursor: "pointer",
                            color: "#1890ff",
                        }}
                    >
                        {athlete}
                    </Text>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.athlete.localeCompare(b.athlete),
            },
            {
                title: "Country",
                dataIndex: "country",
                key: "country",
                width: 150,
                render: (country: string, record: RecordDisplay) => (
                    <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                        <span style={{fontSize: "16px"}}>{record.flag}</span>
                        <Text style={{fontSize: "12px"}}>{country}</Text>
                    </div>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.country.localeCompare(b.country),
            },
            {
                title: "Date",
                dataIndex: "date",
                key: "date",
                width: 120,
                render: (date: string) => <Text style={{fontSize: "12px", color: "#666"}}>{date}</Text>,
                sorter: (a: RecordDisplay, b: RecordDisplay) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            },
            {
                title: "Division",
                dataIndex: "ageGroup",
                key: "ageGroup",
                width: 100,
                render: (ageGroup: string) => (
                    <Tag color="green" style={{fontSize: "11px"}}>
                        {ageGroup}
                    </Tag>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.ageGroup.localeCompare(b.ageGroup),
            },
            {
                title: "Status",
                dataIndex: "status",
                key: "status",
                width: 100,
                render: (status: "submitted" | "verified") => (
                    <Tag color={status === "verified" ? "green" : "orange"} style={{fontSize: "11px"}}>
                        {status === "verified" ? "Verified" : "Submitted"}
                    </Tag>
                ),
                sorter: (a: RecordDisplay, b: RecordDisplay) => a.status.localeCompare(b.status),
            },
            // Admin actions column - only show if user is admin
            ...(isAdmin
                ? [
                      {
                          title: "Actions",
                          key: "actions",
                          width: 120,
                          render: (_: unknown, record: RecordDisplay) => (
                              <Dropdown.Button
                                  type="primary"
                                  size="mini"
                                  trigger={["click"]}
                                  onClick={() => handleToggleVerification(record)}
                                  droplist={
                                      <div className="bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg">
                                          <Button type="text" className="text-left" onClick={() => handleEditVideo(record)}>
                                              <IconVideoCamera style={{marginRight: "8px"}} />
                                              {record.videoUrl ? "Edit Video" : "Add Video"}
                                          </Button>
                                          <Button
                                              type="text"
                                              status="danger"
                                              className="text-left"
                                              onClick={() => handleDeleteRecord(record)}
                                          >
                                              <IconDelete style={{marginRight: "8px"}} />
                                              Delete
                                          </Button>
                                      </div>
                                  }
                              >
                                  <IconEye style={{marginRight: "4px"}} />
                                  {record.status === "verified" ? "Unverify" : "Verify"}
                              </Dropdown.Button>
                          ),
                      },
                  ]
                : []),
        ];
    };

    const [selectedIndividualEvent, setSelectedIndividualEvent] = useState<EventType>("3-3-3");
    const [selectedDoubleEvent, setSelectedDoubleEvent] = useState<EventTypeKey>("Cycle");
    const [selectedTeamRelayEvent, setSelectedTeamRelayEvent] = useState<EventTypeKey>("Cycle");
    const [selectedParentChildEvent, setSelectedParentChildEvent] = useState<EventTypeKey>("Cycle");
    const [selectedSpecialNeedEvent, setSelectedSpecialNeedEvent] = useState<EventTypeKey>("3-3-3");

    const getSelectedEventForCategory = (category: RecordCategory): EventTypeKey => {
        switch (category) {
            case "individual":
                return selectedIndividualEvent as EventTypeKey;
            case "double":
                return selectedDoubleEvent;
            case "team_relay":
                return selectedTeamRelayEvent;
            case "parent_&_child":
                return selectedParentChildEvent;
            default:
                return selectedSpecialNeedEvent;
        }
    };

    const setSelectedEventForCategory = (category: RecordCategory, event: EventTypeKey) => {
        switch (category) {
            case "individual":
                setSelectedIndividualEvent(event as EventType);
                break;
            case "double":
                setSelectedDoubleEvent(event);
                break;
            case "team_relay":
                setSelectedTeamRelayEvent(event);
                break;
            case "parent_&_child":
                setSelectedParentChildEvent(event);
                break;
            default:
                setSelectedSpecialNeedEvent(event);
                break;
        }
    };

    const renderCategoryContent = (category: RecordCategory) => {
        const backendCategory = CATEGORY_MAP[category];
        const availableEvents = EVENTS_FOR_CATEGORY[backendCategory];
        const selectedEvent = getSelectedEventForCategory(category);

        // Get records for the selected event only
        const eventRecords = allRecords[backendCategory]?.[selectedEvent] || [];
        const recordsData: RecordDisplay[] = [];
        let eventRank = 1;

        eventRecords.forEach((record, index) => {
            const recordAgeGroup = getAgeGroup(record.age);
            if (selectedAgeGroup !== "Overall" && recordAgeGroup !== selectedAgeGroup) {
                return;
            }

            const isTeamResult = "teamName" in record;
            const athleteName = isTeamResult
                ? (record as GlobalTeamResult).teamName || "Unknown Team"
                : (record as GlobalResult).participantName || "Unknown";
            const gender = isTeamResult ? "Team" : (record as GlobalResult).gender || "Overall";

            recordsData.push({
                key: `${backendCategory}-${selectedEvent}-${index}`,
                rank: eventRank++,
                event: selectedEvent,
                gender,
                time: formatTime(record.time),
                athlete: athleteName,
                country: record.country || "Unknown",
                flag: getCountryFlag(record.country),
                date: formatDate(record.created_at || new Date().toISOString()),
                ageGroup: recordAgeGroup,
                status: record.status || "submitted",
                videoUrl: record.videoUrl || undefined,
                rawTime: record.time,
                recordId: (record as GlobalResultWithId | GlobalTeamResultWithId).id,
                participantId: isTeamResult ? undefined : (record as GlobalResult).participantId,
                teamName: isTeamResult ? (record as GlobalTeamResult).teamName : undefined,
            });
        });

        return (
            <div>
                {/* Event Tabs - show for all categories */}
                <div style={{marginBottom: "24px"}}>
                    <Tabs
                        type="rounded"
                        activeTab={selectedEvent}
                        onChange={(key) => setSelectedEventForCategory(category, key as EventTypeKey)}
                        style={{marginBottom: "16px"}}
                    >
                        {availableEvents.map((event) => (
                            <TabPane key={event} title={event} />
                        ))}
                    </Tabs>

                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                        <div>
                            <Text style={{fontSize: "16px", fontWeight: "500", color: "#333"}}>
                                {backendCategory} {selectedEvent} Records
                            </Text>
                            <div style={{marginTop: "4px"}}>
                                <Text style={{fontSize: "14px", color: "#666"}}>Total records: {recordsData.length}</Text>
                            </div>
                        </div>

                        <div style={{display: "flex", alignItems: "center", gap: "12px"}}>
                            <Text style={{fontSize: "14px", color: "#666"}}>Age Group:</Text>
                            <Select
                                value={selectedAgeGroup}
                                onChange={(value) => setSelectedAgeGroup(value as AgeGroup)}
                                style={{width: 120}}
                                size="small"
                            >
                                {AGE_GROUPS.map((ageGroup) => (
                                    <Option key={ageGroup} value={ageGroup}>
                                        {ageGroup}
                                    </Option>
                                ))}
                            </Select>
                        </div>
                    </div>
                </div>

                {recordsData.length === 0 ? (
                    <div style={{textAlign: "center", padding: "60px"}}>
                        <Empty description={`No ${selectedEvent} records found for this age group`} style={{color: "#666"}} />
                    </div>
                ) : (
                    <Table
                        columns={getTableColumns()}
                        data={recordsData}
                        pagination={{
                            pageSize: 20,
                            showTotal: true,
                            showJumper: true,
                            sizeCanChange: true,
                        }}
                        size="small"
                        stripe
                        hover
                        style={{backgroundColor: "white"}}
                        scroll={{x: 800}}
                        rowClassName={(_, index) => (index % 2 === 0 ? "even-row" : "odd-row")}
                    />
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div
                style={{
                    textAlign: "center",
                    padding: "60px",
                    minHeight: "400px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                }}
            >
                <Spin size={40} />
                <div style={{marginTop: 16, fontSize: "16px", color: "#666"}}>Loading sport stacking records...</div>
            </div>
        );
    }

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className={`w-full`}>
                    {/* Records Table */}
                    <Title style={{fontSize: "32px", marginBottom: "0", textAlign: "center"}}>🏆 Sport Stacking Records</Title>
                    <Divider style={{margin: "16px 0"}} />
                    <Tabs
                        activeTab={activeCategory}
                        onChange={(key) => setActiveCategory(key as RecordCategory)}
                        type="line"
                        size="large"
                        style={{marginBottom: "24px"}}
                    >
                        <TabPane
                            key="individual"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Individual</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("individual")}
                        </TabPane>

                        <TabPane
                            key="double"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Double</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("double")}
                        </TabPane>

                        <TabPane
                            key="team-relay"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Team Relay</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("team_relay")}
                        </TabPane>

                        <TabPane
                            key="parent-child"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Parent & Child</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("parent_&_child")}
                        </TabPane>

                        <TabPane
                            key="special_need"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Special Need</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("special_need")}
                        </TabPane>
                    </Tabs>
                </div>

                {isAdmin && (
                    <Modal
                        title="Edit Video URL"
                        visible={editVideoModalVisible}
                        onCancel={() => {
                            setEditVideoModalVisible(false);
                            videoForm.resetFields();
                        }}
                        onOk={handleSaveVideoUrl}
                        okText="Save"
                    >
                        {selectedRecord && (
                            <div>
                                <div style={{marginBottom: "16px"}}>
                                    <Text>{selectedRecord.athlete}</Text> - {selectedRecord.event} ({selectedRecord.time})
                                </div>
                                <Form form={videoForm} layout="vertical">
                                    <Form.Item
                                        label="Video URL"
                                        field="videoUrl"
                                        rules={[{type: "url", message: "Please enter a valid URL"}]}
                                    >
                                        <Input placeholder="https://example.com/video.mp4" />
                                    </Form.Item>
                                </Form>
                            </div>
                        )}
                    </Modal>
                )}
            </div>
        </div>
    );
};

export default RecordsIndex;
