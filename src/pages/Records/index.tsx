import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {
    CountryFlag,
    MobileFilterDrawer,
    MobileFilterTrigger,
    MobilePageHeader,
    MobileRankingTable,
    ResponsiveOverlay,
    ResponsiveTabs,
} from "@/components/responsive";
import {formatGenderLabel} from "@/utils/genderLabel";
import {
    Button,
    DatePicker,
    Divider,
    Dropdown,
    Empty,
    Form,
    Input,
    Link,
    Menu,
    Message,
    Modal,
    Pagination,
    Select,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tabs,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconDelete, IconEye, IconFilter, IconVideoCamera} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useRef, useState} from "react";
import {useAuthContext} from "../../context/AuthContext";
import type {GlobalResult, GlobalTeamResult, RecordDisplay} from "../../schema/RecordSchema";

import {
    deleteOverallRecord,
    deleteRecord,
    getBestRecords,
    getBestRecordsByAgeGroup,
    toggleOverallRecordVerification,
    toggleRecordVerification,
    updateRecordVideoUrl,
} from "../../services/firebase/recordService";

// Extended types that include the Firestore document ID
type GlobalResultWithId = GlobalResult & {id: string};
type GlobalTeamResultWithId = GlobalTeamResult & {id: string};

const {Title, Paragraph, Text} = Typography;
const TabPane = Tabs.TabPane;
const Option = Select.Option;
const {RangePicker} = DatePicker;

type RecordCategory = "individual" | "team_relay" | "double" | "parent_&_child" | "special_need";
type EventType = "3-3-3" | "3-6-3" | "Cycle" | "Double" | "Team Relay" | "Parent & Child";
type AgeGroup = string;

// Match the service types
type Category = "Individual" | "Double" | "Parent & Child" | "Team Relay" | "Special Need";
type EventTypeKey = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

const createRecordsMobileNameRenderer = (isTeamCategory: boolean) => (record: RecordDisplay) =>
    !isTeamCategory && record.participantId ? (
        <Link href={`/athletes/${record.participantId}`} hoverable={false} onClick={(event) => event.stopPropagation()}>
            {record.athlete}
        </Link>
    ) : (
        record.athlete
    );

interface RecordsMobileDetailsProps {
    record: RecordDisplay;
    isTeamCategory: boolean;
    isAdmin: boolean;
    onTimeClick: (record: RecordDisplay) => void;
    onToggleVerification: (record: RecordDisplay) => void | Promise<void>;
    onEditVideo: (record: RecordDisplay) => void;
    onDeleteRecord: (record: RecordDisplay) => void | Promise<void>;
}

const RecordsMobileDetails = ({
    record,
    isTeamCategory,
    isAdmin,
    onTimeClick,
    onToggleVerification,
    onEditVideo,
    onDeleteRecord,
}: RecordsMobileDetailsProps) => (
    <div className="records-mobile-card__details">
        <span>
            <CountryFlag country={record.country} size="md" /> {record.country || "Unknown"}
        </span>
        <span>{record.ageGroup}</span>
        <span>{formatGenderLabel(record.gender)}</span>
        <span>{record.date}</span>
        <span>{record.tournament_name || "N/A"}</span>
        <Tag color={record.status === "verified" ? "green" : "orange"}>
            {record.status === "verified" ? "Verified" : "Submitted"}
        </Tag>
        {isTeamCategory && record.members && record.members.length > 0 ? (
            <span className="records-mobile-card__members">Members: {record.members.join(", ")}</span>
        ) : null}
        {record.videoUrl && (record.status === "verified" || isAdmin) ? (
            <Button type="text" onClick={() => onTimeClick(record)}>
                View video <IconVideoCamera />
            </Button>
        ) : null}
        {isAdmin ? (
            <div className="records-mobile-card__actions">
                <Button type="secondary" onClick={() => onToggleVerification(record)}>
                    {record.status === "verified" ? "Unverify" : "Verify"}
                </Button>
                <Button type="secondary" onClick={() => onEditVideo(record)}>
                    {record.videoUrl ? "Edit Video" : "Add Video"}
                </Button>
                <Button status="danger" onClick={() => onDeleteRecord(record)}>
                    Delete
                </Button>
            </div>
        ) : null}
    </div>
);

const createRecordsMobileDetailsRenderer = (props: Omit<RecordsMobileDetailsProps, "record">) => (record: RecordDisplay) => (
    <RecordsMobileDetails {...props} record={record} />
);

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
    return date.toLocaleDateString("en-GB");
};

const parseDisplayDate = (value: string): Date | null => {
    const [day, month, year] = value.split("/").map(Number);
    if (!day || !month || !year) return null;
    const parsed = new Date(year, month - 1, day);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const INDIVIDUAL_AGE_GROUPS: AgeGroup[] = [
    "Overall",
    "Age 5 & Under",
    "Age 6",
    "Age 7",
    "Age 8",
    "Age 9",
    "Age 10",
    "Age 11",
    "Age 12",
    "Age 13",
    "Age 14 & 15",
    "Age 16-20",
    "Age 21-30",
    "Age 31-40",
    "Age 41-49",
    "Age 50-59",
    "Age 60-69",
    "Age 70++",
];

const DOUBLE_AGE_GROUPS: AgeGroup[] = [
    "Overall",
    "Age 8 & Under",
    "Age 10 & Under",
    "Age 13 & Under",
    "Age 14-19",
    "Age 20-29",
    "Age 30-39",
    "Age 40-49",
    "Age 50++",
];

const TEAM_RELAY_AGE_GROUPS: AgeGroup[] = [
    "Overall",
    "Age 9U",
    "Age 10-14",
    "Age 15-20",
    "Age 21-29",
    "Age 30-39",
    "Age 40-49",
    "Age 50++",
];

const getAgeGroupOptions = (category: Category): AgeGroup[] => {
    switch (category) {
        case "Double":
            return DOUBLE_AGE_GROUPS;
        case "Team Relay":
            return TEAM_RELAY_AGE_GROUPS;
        default:
            return INDIVIDUAL_AGE_GROUPS;
    }
};

const getAgeGroupByCategory = (age: number, category: Category): AgeGroup => {
    switch (category) {
        case "Double":
            if (age <= 8) return "Age 8 & Under";
            if (age <= 10) return "Age 10 & Under";
            if (age <= 13) return "Age 13 & Under";
            if (age <= 19) return "Age 14-19";
            if (age <= 29) return "Age 20-29";
            if (age <= 39) return "Age 30-39";
            if (age <= 49) return "Age 40-49";
            return "Age 50++";
        case "Team Relay":
            if (age <= 9) return "Age 9U";
            if (age <= 14) return "Age 10-14";
            if (age <= 20) return "Age 15-20";
            if (age <= 29) return "Age 21-29";
            if (age <= 39) return "Age 30-39";
            if (age <= 49) return "Age 40-49";
            return "Age 50++";
        default:
            if (age <= 5) return "Age 5 & Under";
            if (age === 6) return "Age 6";
            if (age === 7) return "Age 7";
            if (age === 8) return "Age 8";
            if (age === 9) return "Age 9";
            if (age === 10) return "Age 10";
            if (age === 11) return "Age 11";
            if (age === 12) return "Age 12";
            if (age === 13) return "Age 13";
            if (age <= 15) return "Age 14 & 15";
            if (age <= 20) return "Age 16-20";
            if (age <= 30) return "Age 21-30";
            if (age <= 40) return "Age 31-40";
            if (age <= 49) return "Age 41-49";
            if (age <= 59) return "Age 50-59";
            if (age <= 69) return "Age 60-69";
            return "Age 70++";
    }
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
    const [dateRange, setDateRange] = useState<[Date | undefined, Date | undefined]>([undefined, undefined]);
    const [tablePagination, setTablePagination] = useState<{current: number; pageSize: number}>({
        current: 1,
        pageSize: 20,
    });
    const [mobileFiltersVisible, setMobileFiltersVisible] = useState(false);
    const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
    const [mobileCardPage, setMobileCardPage] = useState(1);
    const [draftAgeGroup, setDraftAgeGroup] = useState<AgeGroup>("Overall");
    const [draftDateRange, setDraftDateRange] = useState<[Date | undefined, Date | undefined]>([undefined, undefined]);

    // Admin modal states
    const [selectedRecord, setSelectedRecord] = useState<RecordDisplay | null>(null);
    const [editVideoModalVisible, setEditVideoModalVisible] = useState(false);
    const [videoForm] = Form.useForm();

    const deviceBreakpoint = useDeviceBreakpoint();
    const isMobileView = deviceBreakpoint < DeviceBreakpoint.md;

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
            // Check if this is an overall record
            const isOverallRecord = record.event === "Overall";

            if (isOverallRecord) {
                await toggleOverallRecordVerification(record.recordId, user.global_id, record.status);
            } else {
                await toggleRecordVerification(record.recordId, user.global_id, record.status);
            }

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

        const isOverallRecord = record.event === "Overall";
        const recordType = isOverallRecord ? "overall record" : "record";

        Modal.confirm({
            title: "Delete Record",
            content: `Are you sure you want to delete ${record.athlete}'s ${record.event} ${recordType}?`,
            okText: "Delete",
            okButtonProps: {status: "danger"},
            onOk: async () => {
                try {
                    if (isOverallRecord) {
                        await deleteOverallRecord(record.recordId ?? "");
                    } else {
                        await deleteRecord(record.recordId ?? "");
                    }
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

    const getTableColumns = (isTeamCategory: boolean) => {
        const memberColumn: TableColumnProps<RecordDisplay> = {
            title: "Members",
            dataIndex: "members",
            key: "members",
            width: 240,
            render: (_: unknown, record: RecordDisplay) => {
                const combined: string[] = [...(record.leaderId ? [record.leaderId] : []), ...(record.members ?? [])];
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
                                <Tag color="arcoblue" style={{margin: 0}}>
                                    {memberId}
                                </Tag>
                            </Link>
                        ))}
                        {combined.length === 0 ? <Text style={{color: "#999"}}>—</Text> : null}
                    </div>
                );
            },
        };

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
                            <Link
                                href={`/athletes/${record.participantId}`}
                                hoverable={false}
                                onClick={(event) => event.stopPropagation()}
                            >
                                {record.athlete}
                            </Link>
                        );
                    }
                    return <span>{record.athlete}</span>;
                },
            },
            ...(isTeamCategory ? [memberColumn] : []),
            {
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
                        {record.videoUrl && <IconVideoCamera style={{marginLeft: "4px", fontSize: "13px"}} />}
                    </Text>
                ),
            },
            {
                title: "Status",
                dataIndex: "status",
                width: 110,
                render: (_: unknown, record: RecordDisplay) => (
                    <Tag color={record.status === "verified" ? "green" : "orange"}>
                        {record.status === "verified" ? "Verified" : "Submitted"}
                    </Tag>
                ),
            },
            {
                title: "Country",
                dataIndex: "country",
                width: 160,
                render: (country: string) => (
                    <Space size={6} align="center">
                        <CountryFlag country={country} size="sm" />
                        <span>{country || "Unknown"}</span>
                    </Space>
                ),
            },
            {
                title: "Tournament",
                dataIndex: "tournament_name",
                width: 180,
                render: (_: unknown, record: RecordDisplay) => {
                    if (!record.tournamentId) {
                        return <Text style={{fontSize: "13px", color: "#666"}}>{record.tournament_name || "N/A"}</Text>;
                    }

                    return (
                        <Link href={`/tournaments/${record.tournamentId}/view`} hoverable={false}>
                            {record.tournament_name || record.tournamentId}
                        </Link>
                    );
                },
            },
            {
                title: "Age",
                dataIndex: "age",
                width: 120,
                render: (_: unknown, record: RecordDisplay) => (record.age ? record.age : "—"),
            },
            {
                title: "Gender",
                dataIndex: "gender",
                width: 100,
                render: (gender: string) => formatGenderLabel(gender),
            },
            {
                title: "Date",
                dataIndex: "date",
                width: 120,
                render: (_: unknown, record: RecordDisplay) => (
                    <Text style={{fontSize: "13px", color: "#666"}}>{record.date}</Text>
                ),
            },
            ...(isAdmin
                ? [
                      {
                          title: "Actions",
                          key: "actions",
                          width: 160,
                          render: (_: unknown, record: RecordDisplay) => (
                              <Dropdown.Button
                                  className="records-action-button"
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
                      } satisfies TableColumnProps<RecordDisplay>,
                  ]
                : []),
        ];

        return cols;
    };

    const [selectedIndividualEvent, setSelectedIndividualEvent] = useState<EventTypeKey>("3-3-3");
    const [selectedDoubleEvent, setSelectedDoubleEvent] = useState<EventTypeKey>("Cycle");
    const [selectedTeamRelayEvent, setSelectedTeamRelayEvent] = useState<EventTypeKey>("Cycle");
    const [selectedParentChildEvent, setSelectedParentChildEvent] = useState<EventTypeKey>("Cycle");
    const [selectedSpecialNeedEvent, setSelectedSpecialNeedEvent] = useState<EventTypeKey>("3-3-3");

    useEffect(() => {
        setTablePagination((prev) => ({...prev, current: 1}));
        setMobileCardPage(1);
    }, [
        activeCategory,
        selectedAgeGroup,
        searchQuery,
        dateRange,
        selectedIndividualEvent,
        selectedDoubleEvent,
        selectedTeamRelayEvent,
        selectedParentChildEvent,
        selectedSpecialNeedEvent,
    ]);

    useEffect(() => {
        const currentCategory = CATEGORY_MAP[activeCategory];
        const allowedAgeGroups = getAgeGroupOptions(currentCategory);
        if (!allowedAgeGroups.includes(selectedAgeGroup)) {
            setSelectedAgeGroup("Overall");
        }
    }, [activeCategory, selectedAgeGroup]);

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
        const ageGroupOptions = getAgeGroupOptions(backendCategory);
        const availableEvents = EVENTS_FOR_CATEGORY[backendCategory];
        const selectedEvent = getSelectedEventForCategory(category);

        // Get records for the selected event only
        const eventRecords = allRecords[backendCategory]?.[selectedEvent] || [];
        const recordsData: Array<RecordDisplay & {members?: string[]}> = [];
        let eventRank = 1;

        eventRecords.forEach((record, index) => {
            const recordAgeGroup = getAgeGroupByCategory(record.age, backendCategory);
            if (selectedAgeGroup !== "Overall" && recordAgeGroup !== selectedAgeGroup) {
                return;
            }

            const isTeamResult = "teamName" in record;
            const athleteName = isTeamResult
                ? (record as GlobalTeamResult).teamName || "Unknown Team"
                : (record as GlobalResult).participantName || "Unknown";
            const gender = isTeamResult ? "Team" : (record as GlobalResult).gender || "Overall";

            const recordDate = record.created_at || new Date().toISOString();
            if (formatTime(record.time) !== "DNF") {
                recordsData.push({
                    key: `${backendCategory}-${selectedEvent}-${index}`,
                    rank: eventRank++,
                    event: selectedEvent,
                    gender,
                    time: formatTime(record.time),
                    athlete: athleteName,
                    country: record.country || "Unknown",
                    flag: "", // No longer used - flag is rendered from country name
                    date: formatDate(recordDate),
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
                    tournament_name: record.tournament_name || null,
                    tournamentId: record.tournamentId || undefined,
                });
            }
        });

        // Apply date range filter after ranks are assigned (similar to search filter)
        let filteredByDateRecords = recordsData;
        const [startDate, endDate] = dateRange;
        if (startDate || endDate) {
            filteredByDateRecords = recordsData.filter((record) => {
                const recordDate = record.date ? parseDisplayDate(record.date) : null;
                if (!recordDate) return false;

                // Check start date
                if (startDate && recordDate < startDate) {
                    const startDateMinusOne = new Date(startDate);
                    startDateMinusOne.setDate(startDateMinusOne.getDate() - 1);
                    if (recordDate <= startDateMinusOne) {
                        return false;
                    }
                }

                // Add 1 day to end date to include records on the selected end date
                if (endDate) {
                    const endDatePlusOne = new Date(endDate);
                    endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
                    if (recordDate >= endDatePlusOne) {
                        return false;
                    }
                }
                return true;
            });
        }

        // Apply search filter after date filter
        const filteredRecordsData = searchQuery
            ? filteredByDateRecords.filter(
                  (record) =>
                      record.athlete.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      record.tournament_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      record.members?.some((member) => member.toLowerCase().includes(searchQuery.toLowerCase())) ||
                      record.leaderId?.toLowerCase().includes(searchQuery.toLowerCase()),
              )
            : filteredByDateRecords;

        const isTeamCategory =
            backendCategory === "Team Relay" || backendCategory === "Double" || backendCategory === "Parent & Child";

        const mobilePageSize = 20;
        const mobileStart = (mobileCardPage - 1) * mobilePageSize;
        const mobileRecords = filteredRecordsData.slice(mobileStart, mobileStart + mobilePageSize);
        const recordActiveFilterCount = (selectedAgeGroup !== "Overall" ? 1 : 0) + (dateRange.some(Boolean) ? 1 : 0);
        const recordFilterAriaLabel =
            recordActiveFilterCount > 0 ? `Open record filters (${recordActiveFilterCount} active)` : "Open record filters";
        const mobileNameRenderer = createRecordsMobileNameRenderer(isTeamCategory);
        const mobileDetailsRenderer = createRecordsMobileDetailsRenderer({
            isTeamCategory,
            isAdmin,
            onTimeClick: handleTimeClick,
            onToggleVerification: handleToggleVerification,
            onEditVideo: handleEditVideo,
            onDeleteRecord: handleDeleteRecord,
        });
        return (
            <div>
                {/* Event Tabs - show for all categories */}
                <div style={{marginBottom: "24px"}}>
                    <ResponsiveTabs
                        type="rounded"
                        activeTab={selectedEvent}
                        onChange={(key) => setSelectedEventForCategory(category, key as EventTypeKey)}
                        style={{marginBottom: "16px"}}
                    >
                        {availableEvents.map((event) => (
                            <TabPane key={event} title={event} />
                        ))}
                    </ResponsiveTabs>

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
                            className="records-filter-row mobile-search-filter-row"
                            style={{
                                display: "flex",
                                flexDirection: isMobileView ? "column" : "row",
                                alignItems: isMobileView ? "stretch" : "center",
                                gap: "12px",
                                width: isMobileView ? "100%" : "auto",
                            }}
                        >
                            <Input.Search
                                className="records-search"
                                placeholder="Search athlete/team/tournament..."
                                value={searchQuery}
                                onChange={setSearchQuery}
                                allowClear
                                style={{width: isMobileView ? "100%" : 240}}
                            />
                            <div
                                className="records-filter-inline-desktop"
                                style={{
                                    display: "flex",
                                    flexDirection: isMobileView ? "column" : "row",
                                    alignItems: isMobileView ? "flex-start" : "center",
                                    gap: isMobileView ? "6px" : "8px",
                                    width: isMobileView ? "100%" : "auto",
                                }}
                            >
                                <Text style={{fontSize: "14px", color: "#666"}}>Date:</Text>
                                <RangePicker
                                    format="DD/MM/YYYY"
                                    value={dateRange as [Date, Date]}
                                    onChange={(dates) => {
                                        if (!dates) {
                                            setDateRange([undefined, undefined]);
                                        } else {
                                            const startDate = dates[0] ? new Date(dates[0]) : undefined;
                                            const endDate = dates[1] ? new Date(dates[1]) : undefined;
                                            // Set time to 00:00:00 for both dates
                                            if (startDate) {
                                                startDate.setHours(0, 0, 0, 0);
                                            }
                                            if (endDate) {
                                                endDate.setHours(0, 0, 0, 0);
                                            }
                                            setDateRange([startDate, endDate]);
                                        }
                                    }}
                                    style={{width: isMobileView ? "100%" : 260}}
                                    size={isMobileView ? "default" : "small"}
                                    placeholder={["Start Date", "End Date"]}
                                    allowClear
                                />
                            </div>
                            <div
                                className="records-filter-inline-desktop"
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
                                    {ageGroupOptions.map((ageGroup) => (
                                        <Option key={ageGroup} value={ageGroup}>
                                            {ageGroup}
                                        </Option>
                                    ))}
                                </Select>
                            </div>
                            <MobileFilterTrigger
                                icon={<IconFilter />}
                                ref={mobileFilterTriggerRef}
                                ariaExpanded={mobileFiltersVisible}
                                activeCount={recordActiveFilterCount}
                                ariaLabel={recordFilterAriaLabel}
                                onClick={() => {
                                    setDraftAgeGroup(selectedAgeGroup);
                                    setDraftDateRange(dateRange);
                                    setMobileFiltersVisible(true);
                                }}
                            />
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
                    <>
                        <div className="records-mobile-ranking-table">
                            <MobileRankingTable
                                data={mobileRecords}
                                rowKey={(record) => record.recordId ?? `${record.athlete}-${record.rank}`}
                                rank={(record) => record.rank}
                                name={mobileNameRenderer}
                                result={(record) => record.time}
                                details={mobileDetailsRenderer}
                                pagination={
                                    <Pagination
                                        current={mobileCardPage}
                                        pageSize={mobilePageSize}
                                        total={filteredRecordsData.length}
                                        hideOnSinglePage
                                        onChange={setMobileCardPage}
                                    />
                                }
                            />
                        </div>
                        <div className="records-table-scroll mobile-table-scroll">
                            <Table
                                columns={getTableColumns(isTeamCategory)}
                                data={filteredRecordsData}
                                pagination={{
                                    ...tablePagination,
                                    showTotal: true,
                                    showJumper: true,
                                    sizeCanChange: true,
                                }}
                                onChange={(pagination) =>
                                    setTablePagination((prev) => ({
                                        current: pagination.current ?? prev.current,
                                        pageSize: pagination.pageSize ?? prev.pageSize,
                                    }))
                                }
                                size="default"
                                stripe
                                hover
                                style={{backgroundColor: "white"}}
                                rowClassName={(_, index) => (index % 2 === 0 ? "even-row" : "odd-row")}
                            />
                        </div>
                    </>
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
        <div className={`records-page flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className={`w-full`}>
                    {/* Records Table */}
                    <MobilePageHeader title="🏆 Sport Stacking Records" />
                    <Divider style={{margin: "16px 0"}} />
                    <ResponsiveTabs
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
                    </ResponsiveTabs>
                </div>

                {isAdmin && (
                    <ResponsiveOverlay
                        title="Edit Video URL"
                        visible={editVideoModalVisible}
                        onCancel={() => {
                            setEditVideoModalVisible(false);
                            videoForm.resetFields();
                        }}
                        className="records-edit-modal"
                        desktopWidth="min(95vw, 560px)"
                        mobileMode="fullscreen"
                        footer={[
                            <Button
                                key="cancel"
                                onClick={() => {
                                    setEditVideoModalVisible(false);
                                    videoForm.resetFields();
                                }}
                            >
                                Cancel
                            </Button>,
                            <Button key="save" type="primary" onClick={() => void handleSaveVideoUrl()} loading={loading}>
                                Save
                            </Button>,
                        ]}
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
                    </ResponsiveOverlay>
                )}
            </div>
            <MobileFilterDrawer
                visible={mobileFiltersVisible}
                title="Record filters"
                activeCount={(draftAgeGroup !== "Overall" ? 1 : 0) + (draftDateRange.some(Boolean) ? 1 : 0)}
                returnFocusRef={mobileFilterTriggerRef}
                onCancel={() => setMobileFiltersVisible(false)}
                onReset={() => {
                    setDraftAgeGroup("Overall");
                    setDraftDateRange([undefined, undefined]);
                }}
                onApply={() => {
                    setSelectedAgeGroup(draftAgeGroup);
                    setDateRange(draftDateRange);
                    setMobileFiltersVisible(false);
                }}
            >
                <div className="mobile-filter-field">
                    <span>Age group</span>
                    <Select
                        aria-label="Age group"
                        value={draftAgeGroup}
                        onChange={(value) => setDraftAgeGroup(value as AgeGroup)}
                        style={{width: "100%"}}
                    >
                        {getAgeGroupOptions(CATEGORY_MAP[activeCategory]).map((ageGroup) => (
                            <Option key={ageGroup} value={ageGroup}>
                                {ageGroup}
                            </Option>
                        ))}
                    </Select>
                </div>
                <div className="mobile-filter-field">
                    <span>Date range</span>
                    <RangePicker
                        aria-label="Date range"
                        format="DD/MM/YYYY"
                        value={draftDateRange as [Date, Date]}
                        onChange={(dates) => {
                            if (!dates) {
                                setDraftDateRange([undefined, undefined]);
                                return;
                            }
                            const start = dates[0] ? new Date(dates[0]) : undefined;
                            const end = dates[1] ? new Date(dates[1]) : undefined;
                            start?.setHours(0, 0, 0, 0);
                            end?.setHours(0, 0, 0, 0);
                            setDraftDateRange([start, end]);
                        }}
                        style={{width: "100%"}}
                        placeholder={["Start Date", "End Date"]}
                        allowClear
                    />
                </div>
            </MobileFilterDrawer>
        </div>
    );
};

export default RecordsIndex;
