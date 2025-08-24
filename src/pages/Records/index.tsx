import {
    Button,
    Card,
    Divider,
    Dropdown,
    Empty,
    Form,
    Input,
    Modal,
    Select,
    Space,
    Spin,
    Table,
    Tabs,
    Tag,
    Typography,
    Message,
    Menu,
} from "@arco-design/web-react";
import {IconDelete, IconEdit, IconEye, IconMore, IconVideoCamera} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useState} from "react";
import {useAuthContext} from "../../context/AuthContext";
import type {GlobalResult, GlobalTeamResult} from "../../schema/RecordSchema";

// Extended types that include the Firestore document ID
type GlobalResultWithId = GlobalResult & { id: string };
type GlobalTeamResultWithId = GlobalTeamResult & { id: string };
import {
    getBestRecordsByAgeGroup,
    deleteRecord,
    toggleRecordVerification,
    updateRecordVideoUrl,
} from "../../services/firebase/recordService";

const {Title, Paragraph, Text} = Typography;
const TabPane = Tabs.TabPane;
const Option = Select.Option;

type RecordCategory = "individual" | "team-relay" | "double" | "parent-child";
type EventType = "3-3-3" | "3-6-3" | "Cycle" | "Double" | "Team Relay" | "Parent & Child";
type AgeGroup = "6U" | "8U" | "10U" | "12U" | "14U" | "17U" | "Open" | "Overall";

// Match the service types
type Category = "Individual" | "Double" | "Parent & Child" | "Team-Relay";
type EventTypeKey = "3-3-3" | "3-6-3" | "Cycle";

// Map UI tab keys -> backend category labels
const CATEGORY_MAP: Record<RecordCategory, Category> = {
    individual: "Individual",
    double: "Double",
    "team-relay": "Team-Relay",
    "parent-child": "Parent & Child",
};

// Shape returned by getBestRecordsByAgeGroup()
type BestRecordsShape = Record<Category, Partial<Record<EventTypeKey, (GlobalResult | GlobalTeamResult)[]>>>;

// Events per category for the UI
const EVENTS_FOR_CATEGORY: Record<Category, EventTypeKey[]> = {
    Individual: ["3-3-3", "3-6-3", "Cycle"],
    Double: ["Cycle"],
    "Parent & Child": ["Cycle"],
    "Team-Relay": ["Cycle"],
};

interface RecordDisplay {
    key: string;
    rank: number;
    event: string;
    gender: string;
    time: string;
    athlete: string;
    country: string;
    flag: string;
    date: string;
    ageGroup: string;
    status: "submitted" | "verified";
    videoUrl?: string;
    rawTime: number;
    recordId?: string; // For calling backend services
    participantId?: string; // For individual records
    teamName?: string; // For team records
}

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
        "Team-Relay": {},
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
            const category = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
            const eventType = (activeCategory === "individual" ? selectedIndividualEvent : record.event) as EventTypeKey;

            await toggleRecordVerification(category, eventType, record.recordId, user.global_id, record.status);
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
                    const category = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
                    const eventType = (activeCategory === "individual" ? selectedIndividualEvent : record.event) as EventTypeKey;

                    await deleteRecord(category, eventType, record.recordId ?? "");
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
            const category = activeCategory === "individual" ? "Individual" : CATEGORY_MAP[activeCategory];
            const eventType = (activeCategory === "individual" ? selectedIndividualEvent : selectedRecord.event) as EventTypeKey;

            await updateRecordVideoUrl(category, eventType, selectedRecord.recordId, values.videoUrl);
            Message.success("Video URL updated successfully");
            setEditVideoModalVisible(false);
            videoForm.resetFields();
            loadRecords(); // Refresh records
        } catch (error) {
            console.error("Failed to update video URL:", error);
            Message.error("Failed to update video URL");
        }
    };

    const prepareRecordsData = (category: RecordCategory): RecordDisplay[] => {
        const recordsData: RecordDisplay[] = [];
        const backendCategory = CATEGORY_MAP[category]; // "Individual" | "Double" | ...

        // Events you want to show for this category
        const events = EVENTS_FOR_CATEGORY[backendCategory];

        for (const eventType of events) {
            const eventRecords = allRecords[backendCategory]?.[eventType] || [];
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
                    key: `${backendCategory}-${eventType}-${index}`,
                    rank: eventRank++,
                    event: eventType, // display the sub-event (e.g., "Cycle")
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
                    recordId: (record as GlobalResultWithId | GlobalTeamResultWithId).id, // Use the Firestore document ID
                    participantId: isTeamResult ? undefined : (record as GlobalResult).participantId,
                    teamName: isTeamResult ? (record as GlobalTeamResult).teamName : undefined,
                });
            });
        }

        return recordsData;
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

    const getCategoryTitle = (category: RecordCategory): string => {
        const titles = {
            individual: "Individual Records",
            double: "Doubles Records",
            "team-relay": "Team Relay Records",
            "parent-child": "Parent & Child Records",
        };
        return titles[category];
    };

    const getCategoryDescription = (category: RecordCategory): string => {
        const descriptions = {
            individual: "Combined rankings from Cycle, 3-3-3, and 3-6-3 individual events",
            double: "Team doubles event records",
            "team-relay": "Team relay event records",
            "parent-child": "Parent & Child team event records",
        };
        return descriptions[category];
    };

    const [selectedIndividualEvent, setSelectedIndividualEvent] = useState<EventType>("3-3-3");

    const renderIndividualContent = () => {
        const backendCategory: Category = "Individual";
        const eventType = selectedIndividualEvent as EventTypeKey;

        const eventRecords = allRecords[backendCategory]?.[eventType] || [];
        const recordsData: RecordDisplay[] = [];
        let eventRank = 1;

        eventRecords.forEach((record, index) => {
            const recordAgeGroup = getAgeGroup(record.age);
            if (selectedAgeGroup !== "Overall" && recordAgeGroup !== selectedAgeGroup) {
                return;
            }

            // Only include individual results (not team results)
            if ("participantName" in record) {
                const athleteName = (record as GlobalResult).participantName || "Unknown";
                recordsData.push({
                    key: `${selectedIndividualEvent}-${index}`,
                    rank: eventRank++,
                    event: selectedIndividualEvent, // "3-3-3" | "3-6-3" | "Cycle"
                    gender: (record as GlobalResult).gender || "Overall",
                    time: formatTime(record.time),
                    athlete: athleteName,
                    country: record.country || "Unknown",
                    flag: getCountryFlag(record.country),
                    date: formatDate(record.created_at || new Date().toISOString()),
                    ageGroup: recordAgeGroup,
                    status: record.status || "submitted",
                    videoUrl: record.videoUrl || undefined,
                    rawTime: record.time,
                    recordId: (record as GlobalResultWithId | GlobalTeamResultWithId).id, // Use the Firestore document ID
                    participantId: (record as GlobalResult).participantId,
                });
            }
        });

        return (
            <div>
                {/* Individual Event Rounded Tabs */}
                <div style={{marginBottom: "24px"}}>
                    <Tabs
                        type="rounded"
                        activeTab={selectedIndividualEvent}
                        onChange={(key) => setSelectedIndividualEvent(key as EventType)}
                        style={{marginBottom: "16px"}}
                    >
                        <TabPane key="3-3-3" title="3-3-3" />
                        <TabPane key="3-6-3" title="3-6-3" />
                        <TabPane key="Cycle" title="Cycle" />
                    </Tabs>

                    <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                        <div>
                            <Text style={{fontSize: "16px", fontWeight: "500", color: "#333"}}>
                                Individual {selectedIndividualEvent} Records
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
                        <Empty
                            description={`No ${selectedIndividualEvent} records found for this age group`}
                            style={{color: "#666"}}
                        />
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
                        rowClassName={(record, index) => (index % 2 === 0 ? "even-row" : "odd-row")}
                    />
                )}
            </div>
        );
    };

    const renderCategoryContent = (category: RecordCategory) => {
        if (category === "individual") {
            return renderIndividualContent();
        }

        const recordsData = prepareRecordsData(category);

        if (recordsData.length === 0) {
            return (
                <div style={{textAlign: "center", padding: "60px"}}>
                    <Empty description="No records found for this category and age group" style={{color: "#666"}} />
                </div>
            );
        }

        return (
            <div>
                <div style={{marginBottom: "16px", display: "flex", justifyContent: "space-between", alignItems: "center"}}>
                    <div>
                        <Text style={{fontSize: "16px", fontWeight: "500", color: "#333"}}>
                            {getCategoryDescription(category)}
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
                    rowClassName={(record, index) => (index % 2 === 0 ? "even-row" : "odd-row")}
                />
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
                            {renderCategoryContent("team-relay")}
                        </TabPane>

                        <TabPane
                            key="parent-child"
                            title={
                                <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                    <span>Parent & Child</span>
                                </div>
                            }
                        >
                            {renderCategoryContent("parent-child")}
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
