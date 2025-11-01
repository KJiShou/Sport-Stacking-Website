import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {
    Button,
    Card,
    Divider,
    Dropdown,
    Empty,
    Form,
    Input,
    Link,
    Menu,
    Message,
    Modal,
    Select,
    Space,
    Spin,
    Table,
    type TableColumnProps,
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
    getBestRecords,
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
type EventTypeKey = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

// Map UI tab keys -> display category labels
const CATEGORY_MAP: Record<RecordCategory, Category> = {
    individual: "Individual",
    double: "Double",
    team_relay: "Team Relay",
    "parent_&_child": "Parent & Child",
    special_need: "Special Need",
};

// Shape returned by getBestRecordsByAgeGroup()
type BestRecordsShape = Record<Category, Partial<Record<EventTypeKey, (GlobalResult | GlobalTeamResult)[]>>>;

// Events per category for the UI
const EVENTS_FOR_CATEGORY: Record<Category, EventTypeKey[]> = {
    Individual: ["3-3-3", "3-6-3", "Cycle", "Overall"],
    Double: ["Cycle"],
    "Parent & Child": ["Cycle"],
    "Team Relay": ["Cycle", "3-6-3"],
    "Special Need": ["3-3-3", "3-6-3", "Cycle"],
};

const formatTime = (time: number): string => {
    if (time === 0) return "DNF";
    const total = time;
    let minutes = Math.floor(total / 60);
    let seconds = Math.floor(total % 60);
    let thousandths = Math.round((total - Math.floor(total)) * 1000);

    // Handle rounding overflow (e.g., 59.9995 -> 60.000)
    if (thousandths === 1000) {
        thousandths = 0;
        seconds += 1;
        if (seconds === 60) {
            seconds = 0;
            minutes += 1;
        }
    }

    const secStr = seconds.toString().padStart(2, "0");
    const msStr = thousandths.toString().padStart(3, "0");

    if (minutes > 0) {
        return `${minutes}:${secStr}.${msStr}`;
    }
    return `${seconds}.${msStr}`;
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
    const [searchQuery, setSearchQuery] = useState<string>("");

    // Admin modal states
    const [selectedRecord, setSelectedRecord] = useState<RecordDisplay | null>(null);
    const [editVideoModalVisible, setEditVideoModalVisible] = useState(false);
    const [videoForm] = Form.useForm();

    const deviceBreakpoint = useDeviceBreakpoint();
    const isMobileView = deviceBreakpoint <= DeviceBreakpoint.sm;

    // Check if user has admin permissions
    const isAdmin = user?.roles?.verify_record || user?.roles?.edit_tournament || false;

    useEffect(() => {
        loadRecords();
    }, []);

    const loadRecords = async () => {
        setLoading(true);
        try {
            const records = await getBestRecords();
            setAllRecords(records as BestRecordsShape);
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
            await toggleRecordVerification(record.recordId, user.global_id, record.status);
            const action = record.status === "submitted" ? "verified" : "unverified";
            Message.success(`Record ${action} successfully for ${record.athlete}`);
            await loadRecords();
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
                    await deleteRecord(record.recordId ?? "");
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

            await updateRecordVideoUrl(selectedRecord.recordId, values.videoUrl);
            Message.success("Video URL updated successfully");
            setEditVideoModalVisible(false);
            videoForm.resetFields();
            loadRecords(); // Refresh records
        } catch (error) {
            console.error("Failed to update video URL:", error);
            Message.error("Failed to update video URL");
        }
    };

    const getTableColumns = (isTeamCategory: boolean, deviceBreakpoint: number) => {
        const cols: TableColumnProps<RecordDisplay>[] = [
            {
                title: "Rank",
                dataIndex: "rank",
                width: 60,
                render: (rank: number) => <span className="font-semibold text-sm md:text-base">{rank}</span>,
            },
            {
                title: isTeamCategory ? "Team" : "Athlete",
                dataIndex: "athlete",
                width: 180,
                render: (_: unknown, record: RecordDisplay) => {
                    const hasParticipantId = record.participantId ? record.participantId.length > 0 : false;
                    if (!isTeamCategory && hasParticipantId) {
                        return (
                            <Link href={`/athletes/${record.participantId}`} hoverable={false}>
                                {record.athlete}
                            </Link>
                        );
                    }
                    return <span>{record.athlete}</span>;
                },
            },
        ];

        if (isTeamCategory) {
            cols.push({
                title: "Members",
                dataIndex: "members",
                key: "members",
                width: 240,
                render: (_: unknown, record: RecordDisplay & {members?: string[]; leaderId?: string}) => {
                    const combined: string[] = [
                        ...(record.leaderId ? [`${record.leaderId}`] : []),
                        ...((record.members ?? []) as string[]),
                    ];
                    return (
                        <div style={{display: "flex", flexWrap: "wrap", gap: 6}}>
                            {combined.map((memberId) => (
                                <Link
                                    key={memberId}
                                    href={`/athletes/${memberId}`}
                                    style={{
                                        display: "inline-block",
                                    }}
                                >
                                    <Tag color={"arcoblue"} style={{margin: 0}}>
                                        {memberId}
                                    </Tag>
                                </Link>
                            ))}
                            {combined.length === 0 ? <Text style={{color: "#999"}}>—</Text> : null}
                        </div>
                    );
                },
            });
        }

        cols.push({
            title: "Time",
            dataIndex: "time",
            width: 120,
            render: (_: unknown, record: RecordDisplay) => (
                <Text
                    style={{
                        fontWeight: "bold",
                        color: record.rank === 1 ? "#52c41a" : "#1890ff",
                        cursor: record.videoUrl && (record.status === "verified" || isAdmin) ? "pointer" : "default",
                        textDecoration: record.videoUrl && (record.status === "verified" || isAdmin) ? "underline" : "none",
                    }}
                    onClick={() => handleTimeClick(record)}
                >
                    {record.time}
                    {record.videoUrl && <IconVideoCamera style={{marginLeft: "4px", fontSize: "12px"}} />}
                </Text>
            ),
        });

        // less important columns – only show when screen > md
        if (deviceBreakpoint > DeviceBreakpoint.md) {
            cols.push(
                {
                    title: "Country",
                    dataIndex: "country",
                    width: 160,
                    render: (country: string) => (
                        <Space size={6} align="center">
                            <span>{getCountryFlag(country)}</span>
                            <span>{country || "Unknown"}</span>
                        </Space>
                    ),
                },
                {
                    title: "Division",
                    dataIndex: "ageGroup",
                    width: 120,
                    render: (_: unknown, record: RecordDisplay) => (
                        <Space size={4} align="center">
                            <Tag color="arcoblue">{record.ageGroup}</Tag>
                            {record.age ? <span className="text-xs text-neutral-500">({record.age})</span> : null}
                        </Space>
                    ),
                },
                {
                    title: "Gender",
                    dataIndex: "gender",
                    width: 100,
                },
                {
                    title: "Date",
                    dataIndex: "date",
                    width: 120,
                    render: (_: unknown, record: RecordDisplay) => (
                        <Text style={{fontSize: "12px", color: "#666"}}>{record.date}</Text>
                    ),
                },
            );
        }

        // Admin column — keep it last
        if (isAdmin && deviceBreakpoint > DeviceBreakpoint.md) {
            cols.push({
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
                                <Button type="text" onClick={() => handleEditVideo(record)}>
                                    <IconVideoCamera style={{marginRight: "8px"}} />
                                    {record.videoUrl ? "Edit Video" : "Add Video"}
                                </Button>
                                <Button type="text" status="danger" onClick={() => handleDeleteRecord(record)}>
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
            });
        }

        return cols;
    };

    const [selectedIndividualEvent, setSelectedIndividualEvent] = useState<EventTypeKey>("3-3-3");
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
                setSelectedIndividualEvent(event);
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
        const recordsData: Array<RecordDisplay & {members?: string[]}> = [];
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
                age: record.age || null,
                status: record.status || "submitted",
                videoUrl: record.videoUrl || undefined,
                rawTime: record.time,
                recordId: (record as GlobalResultWithId | GlobalTeamResultWithId).id,
                participantId: isTeamResult ? undefined : (record as GlobalResult).participantGlobalId,
                teamName: isTeamResult ? (record as GlobalTeamResult).teamName : undefined,
                members: isTeamResult ? (record as GlobalTeamResult).members : undefined,
                leaderId: isTeamResult ? (record as GlobalTeamResult).leaderId : undefined,
            });
        });

        // Apply search filter after ranks are assigned
        const filteredRecordsData = searchQuery
            ? recordsData.filter((record) => record.athlete.toLowerCase().includes(searchQuery.toLowerCase()))
            : recordsData;

        const isTeamCategory =
            backendCategory === "Team Relay" || backendCategory === "Double" || backendCategory === "Parent & Child";

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

                    <div
                        style={{
                            display: "flex",
                            flexDirection: isMobileView ? "column" : "row",
                            justifyContent: isMobileView ? "flex-start" : "space-between",
                            alignItems: isMobileView ? "flex-start" : "center",
                            gap: isMobileView ? "16px" : "24px",
                            width: "100%",
                        }}
                    >
                        <div style={{width: isMobileView ? "100%" : "auto"}}>
                            <Text style={{fontSize: "16px", fontWeight: "500", color: "#333"}}>
                                {backendCategory} {selectedEvent} Records
                            </Text>
                            <div style={{marginTop: "4px"}}>
                                <Text style={{fontSize: "14px", color: "#666"}}>Total records: {recordsData.length}</Text>
                            </div>
                        </div>

                        <div
                            style={{
                                display: "flex",
                                flexDirection: isMobileView ? "column" : "row",
                                alignItems: isMobileView ? "stretch" : "center",
                                gap: "12px",
                                width: isMobileView ? "100%" : "auto",
                            }}
                        >
                            <Input.Search
                                placeholder="Search athlete/team..."
                                value={searchQuery}
                                onChange={setSearchQuery}
                                allowClear
                                style={{width: isMobileView ? "100%" : 240}}
                            />
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: isMobileView ? "column" : "row",
                                    alignItems: isMobileView ? "flex-start" : "center",
                                    gap: isMobileView ? "6px" : "8px",
                                    width: isMobileView ? "100%" : "auto",
                                }}
                            >
                                <Text style={{fontSize: "14px", color: "#666"}}>Age Group:</Text>
                                <Select
                                    value={selectedAgeGroup}
                                    onChange={(value) => setSelectedAgeGroup(value as AgeGroup)}
                                    style={{width: isMobileView ? "100%" : 140}}
                                    size={isMobileView ? "default" : "small"}
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
                </div>

                {filteredRecordsData.length === 0 ? (
                    <div style={{textAlign: "center", padding: "60px"}}>
                        <Empty
                            description={
                                searchQuery
                                    ? `No results found for "${searchQuery}"`
                                    : `No ${selectedEvent} records found for this age group`
                            }
                            style={{color: "#666"}}
                        />
                    </div>
                ) : (
                    <Table
                        columns={getTableColumns(isTeamCategory, deviceBreakpoint)}
                        data={filteredRecordsData}
                        pagination={{
                            pageSize: 20,
                            showTotal: true,
                            showJumper: true,
                            sizeCanChange: true,
                        }}
                        size="default"
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
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
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
