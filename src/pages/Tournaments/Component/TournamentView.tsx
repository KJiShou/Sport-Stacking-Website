import {useAuthContext} from "@/context/AuthContext";
import type {AgeBracket, Registration, Tournament, TournamentEvent} from "@/schema";
import type {TournamentOverallRecord, TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {
    deleteOverallRecord,
    deleteParticipantRecords,
    deleteRecord,
    getParticipantEventRecords,
    getTournamentFinalOverallRecords,
    getTournamentFinalRecords,
    getTournamentPrelimOverallRecords,
    getTournamentPrelimRecords,
    toggleOverallRecordVerification,
    toggleRecordVerification,
    updateOverallRecord,
    updateRecordVideoUrl,
    updateTournamentRecord,
} from "@/services/firebase/recordService";
import {fetchApprovedRegistrations} from "@/services/firebase/registerService";
import {fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {formatDate} from "@/utils/Date/formatDate";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {getCountryFlag} from "@/utils/countryFlags";
import {getEventLabel} from "@/utils/tournament/eventUtils";
import {
    Button,
    Card,
    Descriptions,
    Divider,
    Form,
    Image,
    Input,
    InputNumber,
    Link,
    Message,
    Modal,
    Popconfirm,
    Popover,
    Result,
    Spin,
    Table,
    type TableColumnProps,
    Tabs,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {
    IconCalendar,
    IconCheck,
    IconClose,
    IconDelete,
    IconEdit,
    IconExclamationCircle,
    IconLaunch,
    IconUndo,
    IconVideoCamera,
} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import {type ReactNode, useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title, Text} = Typography;

const formatTime = (time: number): string => {
    if (time === 0) return "DNF";
    const total = time;
    let minutes = Math.floor(total / 60);
    let seconds = Math.floor(total % 60);
    let thousandths = Math.round((total - Math.floor(total)) * 1000);

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

const getRecordAge = (record: Partial<TournamentRecord | TournamentTeamRecord | TournamentOverallRecord>): number | null => {
    const age =
        (record as TournamentRecord).age ??
        (record as TournamentTeamRecord).age ??
        (record as unknown as {largest_age?: number}).largest_age;
    return typeof age === "number" ? age : null;
};

export default function TournamentView() {
    const {id} = useParams<{id: string}>();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [tournamentData, setTournamentData] = useState<{label: string; value: ReactNode}[]>([]);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [prelimRecords, setPrelimRecords] = useState<(TournamentRecord | TournamentTeamRecord)[]>([]);
    const [finalRecords, setFinalRecords] = useState<(TournamentRecord | TournamentTeamRecord)[]>([]);
    const [prelimOverallRecords, setPrelimOverallRecords] = useState<TournamentOverallRecord[]>([]);
    const [finalOverallRecords, setFinalOverallRecords] = useState<TournamentOverallRecord[]>([]);
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editingRecord, setEditingRecord] = useState<TournamentRecord | TournamentTeamRecord | TournamentOverallRecord | null>(
        null,
    );
    const [editingRecordType, setEditingRecordType] = useState<"individual" | "team" | "overall" | null>(null);
    const [individualEventRecords, setIndividualEventRecords] = useState<TournamentRecord[]>([]);
    const [eventBracketSelection, setEventBracketSelection] = useState<Record<string, string>>({});
    const [form] = Form.useForm();
    const navigate = useNavigate();

    const deviceBreakpoint = useDeviceBreakpoint();
    const {user} = useAuthContext();
    const individualEvent = events.find((event) => event.type === "Individual");
    const individualEventLabel = individualEvent ? getEventLabel(individualEvent) : "Individual";
    const isAdmin = user?.roles?.verify_record || user?.roles?.edit_tournament || false;

    const handleTimeClick = (videoUrl?: string | null, status?: string) => {
        if (videoUrl && (status === "verified" || isAdmin)) {
            window.open(videoUrl, "_blank", "noopener,noreferrer");
        }
    };

    const refreshRecords = async () => {
        if (id && tournament && (tournament.status === "On Going" || tournament.status === "End")) {
            try {
                const [prelimData, finalData, prelimOverallData, finalOverallData] = await Promise.all([
                    getTournamentPrelimRecords(id),
                    getTournamentFinalRecords(id),
                    getTournamentPrelimOverallRecords(id),
                    getTournamentFinalOverallRecords(id),
                ]);
                setPrelimRecords(prelimData);
                setFinalRecords(finalData);
                setPrelimOverallRecords(prelimOverallData);
                setFinalOverallRecords(finalOverallData);
            } catch (error) {
                console.error("Error fetching records:", error);
            }
        }
    };

    const handleEditRecord = async (
        record: TournamentRecord | TournamentTeamRecord | TournamentOverallRecord,
        type: "individual" | "team" | "overall",
    ) => {
        setEditingRecord(record);
        setEditingRecordType(type);

        if (type === "overall") {
            const overallRecord = record as TournamentOverallRecord;

            // Filter individual event records from existing prelim or final records
            const allRecords = overallRecord.classification === "prelim" ? prelimRecords : finalRecords;

            const eventRecords = allRecords.filter((r): r is TournamentRecord => {
                // Only individual records (not team records)
                if ("team_id" in r) return false;

                const individualRecord = r as TournamentRecord;
                return (
                    individualRecord.participant_global_id === overallRecord.participant_global_id &&
                    individualRecord.event_id === overallRecord.event_id &&
                    individualRecord.classification === overallRecord.classification &&
                    (individualRecord.code === "3-3-3" || individualRecord.code === "3-6-3" || individualRecord.code === "Cycle")
                );
            });

            // Sort to ensure consistent order: 3-3-3, 3-6-3, Cycle
            const sortedEventRecords = eventRecords.sort((a, b) => {
                const order = {"3-3-3": 0, "3-6-3": 1, Cycle: 2};
                return order[a.code as keyof typeof order] - order[b.code as keyof typeof order];
            });

            setIndividualEventRecords(sortedEventRecords);

            // Set form values for each event's tries
            const formValues: Record<string, number | string> = {
                video_url: overallRecord.video_url || "",
            };

            for (const eventRecord of sortedEventRecords) {
                const eventName = eventRecord.code.replace(/-/g, "_").toLowerCase();
                formValues[`${eventName}_try1`] = eventRecord.try1;
                formValues[`${eventName}_try2`] = eventRecord.try2;
                formValues[`${eventName}_try3`] = eventRecord.try3;
            }

            form.setFieldsValue(formValues);
        } else {
            const individualRecord = record as TournamentRecord | TournamentTeamRecord;
            form.setFieldsValue({
                try1: individualRecord.try1,
                try2: individualRecord.try2,
                try3: individualRecord.try3,
                video_url: individualRecord.video_url || "",
            });
        }

        setEditModalVisible(true);
    };

    const handleSaveEdit = async () => {
        try {
            const values = await form.validate();

            if (!editingRecord || !id) return;

            if (editingRecordType === "overall") {
                // For overall records, update each individual event record with their tries
                const updatePromises = individualEventRecords.map((eventRecord) => {
                    const eventName = eventRecord.code.replace(/-/g, "_").toLowerCase();
                    const try1 = values[`${eventName}_try1`];
                    const try2 = values[`${eventName}_try2`];
                    const try3 = values[`${eventName}_try3`];
                    const bestTime = Math.min(try1, try2, try3);

                    return updateTournamentRecord(eventRecord.id, {
                        try1,
                        try2,
                        try3,
                        best_time: bestTime,
                        video_url: values.video_url || null,
                    });
                });

                await Promise.all(updatePromises);

                // Calculate overall times from updated individual records
                let overallTime = 0;
                const eventTimes: Record<string, number> = {};

                for (const eventRecord of individualEventRecords) {
                    const eventName = eventRecord.code.replace(/-/g, "_").toLowerCase();
                    const try1 = values[`${eventName}_try1`];
                    const try2 = values[`${eventName}_try2`];
                    const try3 = values[`${eventName}_try3`];
                    const bestTime = Math.min(try1, try2, try3);

                    eventTimes[eventRecord.code] = bestTime;
                    overallTime += bestTime;
                }

                // Update the overall record
                await updateOverallRecord(editingRecord.id, {
                    three_three_three: eventTimes["3-3-3"] || 0,
                    three_six_three: eventTimes["3-6-3"] || 0,
                    cycle: eventTimes.Cycle || 0,
                    overall_time: overallTime,
                    video_url: values.video_url || null,
                });
            } else {
                const bestTime = Math.min(values.try1, values.try2, values.try3);
                await updateTournamentRecord(editingRecord.id, {
                    try1: values.try1,
                    try2: values.try2,
                    try3: values.try3,
                    best_time: bestTime,
                    video_url: values.video_url || null,
                });
            }

            Message.success("Record updated successfully");
            setEditModalVisible(false);
            setIndividualEventRecords([]);
            await refreshRecords();
        } catch (error) {
            console.error("Failed to update record:", error);
            Message.error("Failed to update record");
        }
    };

    const handleDeleteRecord = async (
        record: TournamentRecord | TournamentTeamRecord | TournamentOverallRecord,
        isOverall: boolean,
    ) => {
        try {
            if (isOverall) {
                const overallRecord = record as TournamentOverallRecord;
                // Delete the overall record and all three individual event records
                if (id) {
                    await deleteParticipantRecords(
                        id,
                        overallRecord.participant_global_id,
                        overallRecord.event_id,
                        overallRecord.classification || "prelim",
                    );
                }
            } else {
                await deleteRecord(record.id);
            }

            Message.success("Record deleted successfully");
            await refreshRecords();
        } catch (error) {
            console.error("Failed to delete record:", error);
            Message.error("Failed to delete record");
        }
    };

    const handleToggleVerification = async (
        record: TournamentRecord | TournamentTeamRecord | TournamentOverallRecord,
        isOverall: boolean,
    ) => {
        try {
            if (!user?.id) {
                Message.error("You must be logged in to verify records");
                return;
            }

            if (isOverall) {
                await toggleOverallRecordVerification(record.id, user.id, record.status);
            } else {
                await toggleRecordVerification(record.id, user.id, record.status);
            }

            Message.success(record.status === "verified" ? "Record unverified" : "Record verified");
            await refreshRecords();
        } catch (error) {
            console.error("Failed to toggle verification:", error);
            Message.error("Failed to toggle verification");
        }
    };

    useEffect(() => {
        async function fetchTournament() {
            setLoading(true);
            try {
                if (id) {
                    const data = await fetchTournamentById(id);
                    setTournament(data);

                    // Fetch registrations and events
                    const [regs, evts] = await Promise.all([fetchApprovedRegistrations(id), fetchTournamentEvents(id)]);
                    setRegistrations(regs);
                    setEvents(evts);

                    // Fetch records if tournament is ongoing or ended
                    if (data && (data.status === "On Going" || data.status === "End")) {
                        try {
                            const [prelimData, finalData, prelimOverallData, finalOverallData] = await Promise.all([
                                getTournamentPrelimRecords(id),
                                getTournamentFinalRecords(id),
                                getTournamentPrelimOverallRecords(id),
                                getTournamentFinalOverallRecords(id),
                            ]);
                            setPrelimRecords(prelimData);
                            setFinalRecords(finalData);
                            setPrelimOverallRecords(prelimOverallData);
                            setFinalOverallRecords(finalOverallData);
                        } catch (error) {
                            console.error("Error fetching records:", error);
                            setPrelimRecords([]);
                            setFinalRecords([]);
                            setPrelimOverallRecords([]);
                            setFinalOverallRecords([]);
                        }
                    }

                    setTournamentData([
                        {
                            label: "Registration Price",
                            value: <div>RM{data?.registration_fee}</div>,
                        },
                        {
                            label: "Member Registration Price",
                            value: <div>RM{data?.member_registration_fee}</div>,
                        },
                        {
                            label: "Total Participants",
                            value: (
                                <div>
                                    <Text bold>{regs.length}</Text>
                                    {data &&
                                        data.max_participants !== null &&
                                        data.max_participants !== undefined &&
                                        data.max_participants > 0 && <Text type="secondary"> / {data.max_participants}</Text>}
                                </div>
                            ),
                        },
                        {
                            label: "Location",
                            value: (
                                <Link
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data?.address ?? "")}`,
                                            "_blank",
                                        )
                                    }
                                    hoverable={false}
                                >
                                    {data?.address} ({data?.country?.join(" / ")}) <IconLaunch />
                                </Link>
                            ),
                        },
                        {
                            label: "Venue",
                            value: <div>{data?.venue}</div>,
                        },
                        {
                            label: "Date",
                            value: (
                                <div>
                                    {formatDate(data?.start_date)} - {formatDate(data?.end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Max Participants",
                            value: <div>{data?.max_participants === 0 ? "No Limit" : data?.max_participants}</div>,
                        },
                        {
                            label: "Registration Period",
                            value: (
                                <div>
                                    {formatDate(data?.registration_start_date)} - {formatDate(data?.registration_end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Description",
                            value: (
                                <Button onClick={() => setDescriptionModalVisible(true)} type="text">
                                    <IconExclamationCircle />
                                    view description
                                </Button>
                            ),
                        },
                        {
                            label: "Agenda",
                            value: data?.agenda ? (
                                <Button type="text" onClick={() => window.open(`${data?.agenda}`, "_blank")}>
                                    <IconCalendar /> View Agenda
                                </Button>
                            ) : (
                                "-"
                            ),
                        },
                    ]);
                }
            } finally {
                setLoading(false);
            }
        }
        fetchTournament();
    }, [id]);
    if (loading) {
        return <Spin style={{margin: 40}} />;
    }
    if (!tournament) {
        return (
            <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
                <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                    <IconUndo /> Go Back
                </Button>
                <div
                    className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                >
                    <Result status="error" title="Tournament not found" subTitle="Something went wrong. Please try again. " />
                </div>
            </div>
        );
    }

    const buildBracketKey = (round: "prelim" | "final", eventKey: string, classification?: string) =>
        `${round}:${classification ?? "all"}:${eventKey}`;

    const getSelectedBracketName = (bracketKey: string, event?: TournamentEvent) =>
        eventBracketSelection[bracketKey] ?? event?.age_brackets?.[0]?.name ?? null;

    const renderBracketTabs = (event: TournamentEvent, bracketKey: string) => {
        if (!event.age_brackets || event.age_brackets.length === 0) return null;
        const activeTab = getSelectedBracketName(bracketKey, event) ?? "";
        return (
            <Tabs
                type="capsule"
                activeTab={activeTab}
                onChange={(key) => setEventBracketSelection((prev) => ({...prev, [bracketKey]: key}))}
                style={{marginBottom: 12}}
            >
                {event.age_brackets.map((bracket) => (
                    <Tabs.TabPane key={bracket.name} title={bracket.name} />
                ))}
            </Tabs>
        );
    };

    const filterRecordsByBracket = <T extends Partial<TournamentRecord | TournamentTeamRecord | TournamentOverallRecord>>(
        records: T[],
        bracket: AgeBracket | undefined,
    ): T[] => {
        if (!bracket) return records;
        return records.filter((record) => {
            const age = getRecordAge(record);
            if (age === null) return true;
            return age >= bracket.min_age && age <= bracket.max_age;
        });
    };

    return (
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className={`flex flex-col items-center`}>
                    {tournament?.logo && <Image src={tournament.logo} alt="logo" width={200} />}
                    <Descriptions
                        column={1}
                        title={
                            <Title style={{textAlign: "center", width: "100%"}} heading={3}>
                                {tournament?.name}
                            </Title>
                        }
                        data={tournamentData}
                        style={{marginBottom: 20}}
                        labelStyle={{textAlign: "right", paddingRight: 36}}
                    />
                    <Modal
                        title="Tournament Description"
                        visible={descriptionModalVisible}
                        onCancel={() => setDescriptionModalVisible(false)}
                        footer={null}
                        className={`m-10 w-1/2`}
                    >
                        <MDEditor.Markdown source={tournament?.description ?? ""} />
                    </Modal>
                </div>

                {/* Event Participant Breakdown */}
                {events.length > 0 && (
                    <div className="w-full mt-6">
                        <Divider />
                        <Title heading={4} style={{marginBottom: 16}}>
                            Event Participation
                        </Title>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {events.map((event) => (
                                <Card key={event.id} title={getEventLabel(event)} bordered>
                                    <div className="space-y-2">
                                        {event.age_brackets.map((bracket) => {
                                            const participantsInBracket = registrations.filter(
                                                (reg) =>
                                                    reg.age >= bracket.min_age &&
                                                    reg.age <= bracket.max_age &&
                                                    reg.events_registered?.includes(event.id ?? ""),
                                            );
                                            return (
                                                <div key={bracket.name} className="flex justify-between items-center">
                                                    <Text>
                                                        {bracket.name} ({bracket.min_age}-{bracket.max_age})
                                                    </Text>
                                                    <Tag color="arcoblue">{participantsInBracket.length}</Tag>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {/* Records Section - Show for Ongoing or End tournaments */}
                {tournament && (tournament.status === "On Going" || tournament.status === "End") && id && (
                    <div className="w-full mt-6">
                        <Divider />
                        <div className="flex justify-between items-center mb-4">
                            <Title heading={4}>Tournament Records</Title>
                        </div>

                        {/* Prelim Records Section */}
                        {(prelimRecords.length > 0 || prelimOverallRecords.length > 0) && (
                            <div className="mb-8">
                                <Title heading={5} style={{marginBottom: 16}}>
                                    Preliminary Round
                                </Title>
                                <div className="space-y-6">
                                    {/* Overall Records Table for Individual Events */}
                                    {prelimOverallRecords.length > 0 && (
                                        <Card title={`Overall Rankings (${individualEventLabel})`} bordered>
                                            {individualEvent &&
                                                (() => {
                                                    const eventKey = individualEvent.id ?? "Individual";
                                                    const bracketKey = buildBracketKey("prelim", eventKey);
                                                    return renderBracketTabs(individualEvent, bracketKey);
                                                })()}
                                            {(() => {
                                                const eventKey = individualEvent?.id ?? "Individual";
                                                const bracketKey = buildBracketKey("prelim", eventKey);
                                                const selectedBracketName = getSelectedBracketName(bracketKey, individualEvent);
                                                const selectedBracket = individualEvent?.age_brackets?.find(
                                                    (b) => b.name === selectedBracketName,
                                                );
                                                const filteredRecords = filterRecordsByBracket(
                                                    [...prelimOverallRecords].sort((a, b) => a.overall_time - b.overall_time),
                                                    selectedBracket,
                                                );
                                                return (
                                                    <Table
                                                        columns={[
                                                            {
                                                                title: "Rank",
                                                                width: 60,
                                                                render: (
                                                                    _: unknown,
                                                                    __: TournamentOverallRecord,
                                                                    index: number,
                                                                ) => <Text bold>{index + 1}</Text>,
                                                            },
                                                            {
                                                                title: "Athlete",
                                                                dataIndex: "participant_name",
                                                                width: 200,
                                                            },
                                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                ? [
                                                                      {
                                                                          title: "Event Code",
                                                                          dataIndex: "code" as const,
                                                                          width: 100,
                                                                      },
                                                                      {
                                                                          title: "3-3-3",
                                                                          dataIndex: "three_three_three" as const,
                                                                          width: 100,
                                                                          render: (time: number) => (
                                                                              <Text>{time > 0 ? formatTime(time) : "DNF"}</Text>
                                                                          ),
                                                                      },
                                                                      {
                                                                          title: "3-6-3",
                                                                          dataIndex: "three_six_three" as const,
                                                                          width: 100,
                                                                          render: (time: number) => (
                                                                              <Text>{time > 0 ? formatTime(time) : "DNF"}</Text>
                                                                          ),
                                                                      },
                                                                      {
                                                                          title: "Cycle",
                                                                          dataIndex: "cycle" as const,
                                                                          width: 100,
                                                                          render: (time: number) => (
                                                                              <Text>{time > 0 ? formatTime(time) : "DNF"}</Text>
                                                                          ),
                                                                      },
                                                                  ]
                                                                : []),
                                                            {
                                                                title: "Overall Time",
                                                                dataIndex: "overall_time",
                                                                width: 120,
                                                                render: (time: number, record: TournamentOverallRecord) => {
                                                                    const canOpen =
                                                                        record.video_url &&
                                                                        (record.status === "verified" || isAdmin);
                                                                    return (
                                                                        <Text
                                                                            bold
                                                                            style={{
                                                                                color: "#1890ff",
                                                                                cursor: canOpen ? "pointer" : "default",
                                                                                textDecoration: canOpen ? "underline" : "none",
                                                                            }}
                                                                            onClick={() =>
                                                                                handleTimeClick(record.video_url, record.status)
                                                                            }
                                                                        >
                                                                            {formatTime(time)}
                                                                            {record.video_url && (
                                                                                <IconVideoCamera
                                                                                    style={{marginLeft: 6, fontSize: 12}}
                                                                                />
                                                                            )}
                                                                        </Text>
                                                                    );
                                                                },
                                                            },
                                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                ? [
                                                                      {
                                                                          title: "Country",
                                                                          dataIndex: "country" as const,
                                                                          width: 120,
                                                                      },
                                                                      {
                                                                          title: "Status",
                                                                          dataIndex: "status" as const,
                                                                          width: 100,
                                                                          render: (status: string) => (
                                                                              <Tag
                                                                                  color={
                                                                                      status === "verified" ? "green" : "orange"
                                                                                  }
                                                                              >
                                                                                  {status === "verified"
                                                                                      ? "Verified"
                                                                                      : "Submitted"}
                                                                              </Tag>
                                                                          ),
                                                                      },
                                                                  ]
                                                                : []),
                                                            ...(isAdmin
                                                                ? [
                                                                      {
                                                                          title: "Actions",
                                                                          width: 150,
                                                                          render: (
                                                                              _: unknown,
                                                                              record: TournamentOverallRecord,
                                                                          ) => (
                                                                              <div className="flex gap-2">
                                                                                  <Popover content="Edit record times">
                                                                                      <Button
                                                                                          size="mini"
                                                                                          type="primary"
                                                                                          icon={<IconEdit />}
                                                                                          onClick={() =>
                                                                                              handleEditRecord(record, "overall")
                                                                                          }
                                                                                      />
                                                                                  </Popover>
                                                                                  <Popover
                                                                                      content={
                                                                                          record.status === "verified"
                                                                                              ? "Unverify this record"
                                                                                              : "Verify this record"
                                                                                      }
                                                                                  >
                                                                                      <Button
                                                                                          size="mini"
                                                                                          status={
                                                                                              record.status === "verified"
                                                                                                  ? "warning"
                                                                                                  : "success"
                                                                                          }
                                                                                          icon={
                                                                                              record.status === "verified" ? (
                                                                                                  <IconClose />
                                                                                              ) : (
                                                                                                  <IconCheck />
                                                                                              )
                                                                                          }
                                                                                          onClick={() =>
                                                                                              handleToggleVerification(
                                                                                                  record,
                                                                                                  true,
                                                                                              )
                                                                                          }
                                                                                      />
                                                                                  </Popover>
                                                                                  <Popconfirm
                                                                                      title="Are you sure you want to delete this record and all its individual events?"
                                                                                      onOk={() =>
                                                                                          handleDeleteRecord(record, true)
                                                                                      }
                                                                                      okText="Delete"
                                                                                      cancelText="Cancel"
                                                                                  >
                                                                                      <Popover content="Delete this record">
                                                                                          <Button
                                                                                              size="mini"
                                                                                              status="danger"
                                                                                              icon={<IconDelete />}
                                                                                          />
                                                                                      </Popover>
                                                                                  </Popconfirm>
                                                                              </div>
                                                                          ),
                                                                      },
                                                                  ]
                                                                : []),
                                                        ]}
                                                        data={filteredRecords}
                                                        pagination={{
                                                            pageSize: 20,
                                                            showTotal: true,
                                                            showJumper: true,
                                                        }}
                                                        rowKey="id"
                                                        size="small"
                                                    />
                                                );
                                            })()}
                                        </Card>
                                    )}

                                    {/* Team Event Rankings */}
                                    {Array.from(
                                        new Set(
                                            prelimRecords
                                                .filter((r) => "team_id" in r) // Only team records
                                                .map((r) => r.event),
                                        ),
                                    ).map((eventType) => {
                                        const eventRecords = prelimRecords.filter(
                                            (r) => r.event === eventType && "team_id" in r,
                                        ) as TournamentTeamRecord[];
                                        const eventConfig = events.find((e) => e.type === eventType);
                                        const eventLabel = eventConfig ? getEventLabel(eventConfig) : eventType;
                                        const eventKey = eventConfig?.id ?? eventType;
                                        const bracketKey = buildBracketKey("prelim", eventKey);
                                        const selectedBracketName = getSelectedBracketName(bracketKey, eventConfig);
                                        const selectedBracket = eventConfig?.age_brackets?.find(
                                            (b) => b.name === selectedBracketName,
                                        );

                                        // Sort all records by best_time
                                        const sortedRecords = eventRecords.sort((a, b) => a.best_time - b.best_time);
                                        const filteredRecords = filterRecordsByBracket(sortedRecords, selectedBracket);

                                        const columns: TableColumnProps<TournamentTeamRecord>[] = [
                                            {
                                                title: "Rank",
                                                width: 60,
                                                render: (_: unknown, __: TournamentTeamRecord, index: number) => (
                                                    <Text bold>{index + 1}</Text>
                                                ),
                                            },
                                            {
                                                title: "Team",
                                                dataIndex: "team_name",
                                                width: 200,
                                            },
                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                ? [
                                                      {
                                                          title: "Event Code",
                                                          dataIndex: "code" as const,
                                                          width: 100,
                                                      },
                                                  ]
                                                : []),
                                            {
                                                title: "Best Time",
                                                dataIndex: "best_time",
                                                width: 120,
                                                render: (time: number, record: TournamentTeamRecord) => {
                                                    const canOpen = record.video_url && (record.status === "verified" || isAdmin);
                                                    return (
                                                        <Text
                                                            bold
                                                            style={{
                                                                color: "#1890ff",
                                                                cursor: canOpen ? "pointer" : "default",
                                                                textDecoration: canOpen ? "underline" : "none",
                                                            }}
                                                            onClick={() => handleTimeClick(record.video_url, record.status)}
                                                        >
                                                            {formatTime(time)}
                                                            {record.video_url && (
                                                                <IconVideoCamera style={{marginLeft: 6, fontSize: 12}} />
                                                            )}
                                                        </Text>
                                                    );
                                                },
                                            },
                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                ? [
                                                      {
                                                          title: "Country",
                                                          dataIndex: "country" as const,
                                                          width: 120,
                                                      },
                                                      {
                                                          title: "Status",
                                                          dataIndex: "status" as const,
                                                          width: 100,
                                                          render: (status: string) => (
                                                              <Tag color={status === "verified" ? "green" : "orange"}>
                                                                  {status === "verified" ? "Verified" : "Submitted"}
                                                              </Tag>
                                                          ),
                                                      },
                                                  ]
                                                : []),
                                            ...(isAdmin
                                                ? [
                                                      {
                                                          title: "Actions",
                                                          width: 150,
                                                          render: (_: unknown, record: TournamentTeamRecord) => (
                                                              <div className="flex gap-2">
                                                                  <Popover content="Edit record times">
                                                                      <Button
                                                                          size="mini"
                                                                          type="primary"
                                                                          icon={<IconEdit />}
                                                                          onClick={() => handleEditRecord(record, "team")}
                                                                      />
                                                                  </Popover>
                                                                  <Popover
                                                                      content={
                                                                          record.status === "verified"
                                                                              ? "Unverify this record"
                                                                              : "Verify this record"
                                                                      }
                                                                  >
                                                                      <Button
                                                                          size="mini"
                                                                          status={
                                                                              record.status === "verified" ? "warning" : "success"
                                                                          }
                                                                          icon={
                                                                              record.status === "verified" ? (
                                                                                  <IconClose />
                                                                              ) : (
                                                                                  <IconCheck />
                                                                              )
                                                                          }
                                                                          onClick={() => handleToggleVerification(record, false)}
                                                                      />
                                                                  </Popover>
                                                                  <Popconfirm
                                                                      title="Are you sure you want to delete this record?"
                                                                      onOk={() => handleDeleteRecord(record, false)}
                                                                      okText="Delete"
                                                                      cancelText="Cancel"
                                                                  >
                                                                      <Popover content="Delete this record">
                                                                          <Button
                                                                              size="mini"
                                                                              status="danger"
                                                                              icon={<IconDelete />}
                                                                          />
                                                                      </Popover>
                                                                  </Popconfirm>
                                                              </div>
                                                          ),
                                                      },
                                                  ]
                                                : []),
                                        ];

                                        return (
                                            <Card
                                                key={`prelim-team-${eventType}`}
                                                title={`${eventLabel} - Team Rankings`}
                                                bordered
                                            >
                                                {eventConfig && renderBracketTabs(eventConfig, bracketKey)}
                                                <Table
                                                    columns={columns}
                                                    data={filteredRecords}
                                                    pagination={{
                                                        pageSize: 20,
                                                        showTotal: true,
                                                        showJumper: true,
                                                    }}
                                                    rowKey="id"
                                                    size="small"
                                                />
                                            </Card>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Final Records Section */}
                        {(finalRecords.length > 0 || finalOverallRecords.length > 0) && (
                            <div className="mb-8">
                                <Title heading={5} style={{marginBottom: 16}}>
                                    Final Round
                                </Title>
                                <div className="space-y-6">
                                    {/* Group final records by classification */}
                                    {["advance", "intermediate", "beginner"].map((classification) => {
                                        const classificationOverallRecords = finalOverallRecords.filter(
                                            (r) => r.classification === classification,
                                        );
                                        const classificationTeamRecords = finalRecords.filter(
                                            (r) => "team_id" in r && r.classification === classification,
                                        );

                                        // Skip if no records for this classification
                                        if (classificationOverallRecords.length === 0 && classificationTeamRecords.length === 0) {
                                            return null;
                                        }

                                        const classificationLabel =
                                            classification.charAt(0).toUpperCase() + classification.slice(1);

                                        return (
                                            <div key={classification} className="space-y-4">
                                                <Title heading={6} style={{marginBottom: 12, color: "#1890ff"}}>
                                                    {classificationLabel} Classification
                                                </Title>

                                                {/* Overall Records Table for Individual Events */}
                                                {classificationOverallRecords.length > 0 && (
                                                    <Card
                                                        title={`Overall Rankings (${individualEventLabel}) - ${classificationLabel}`}
                                                        bordered
                                                    >
                                                        {individualEvent &&
                                                            (() => {
                                                                const eventKey = individualEvent.id ?? "Individual";
                                                                const bracketKey = buildBracketKey(
                                                                    "final",
                                                                    eventKey,
                                                                    classification,
                                                                );
                                                                return renderBracketTabs(individualEvent, bracketKey);
                                                            })()}
                                                        <Table
                                                            columns={[
                                                                {
                                                                    title: "Rank",
                                                                    width: 60,
                                                                    render: (
                                                                        _: unknown,
                                                                        __: TournamentOverallRecord,
                                                                        index: number,
                                                                    ) => (
                                                                        <Text
                                                                            bold
                                                                            style={{
                                                                                color:
                                                                                    index === 0
                                                                                        ? "#52c41a"
                                                                                        : index === 1
                                                                                          ? "#1890ff"
                                                                                          : index === 2
                                                                                            ? "#fa8c16"
                                                                                            : "inherit",
                                                                            }}
                                                                        >
                                                                            {index + 1}
                                                                        </Text>
                                                                    ),
                                                                },
                                                                {
                                                                    title: "Athlete",
                                                                    dataIndex: "participant_name",
                                                                    width: 200,
                                                                },
                                                                ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                    ? [
                                                                          {
                                                                              title: "Event Code",
                                                                              dataIndex: "code" as const,
                                                                              width: 100,
                                                                          },
                                                                          {
                                                                              title: "3-3-3",
                                                                              dataIndex: "three_three_three" as const,
                                                                              width: 100,
                                                                              render: (time: number) => (
                                                                                  <Text>
                                                                                      {time > 0 ? formatTime(time) : "DNF"}
                                                                                  </Text>
                                                                              ),
                                                                          },
                                                                          {
                                                                              title: "3-6-3",
                                                                              dataIndex: "three_six_three" as const,
                                                                              width: 100,
                                                                              render: (time: number) => (
                                                                                  <Text>
                                                                                      {time > 0 ? formatTime(time) : "DNF"}
                                                                                  </Text>
                                                                              ),
                                                                          },
                                                                          {
                                                                              title: "Cycle",
                                                                              dataIndex: "cycle" as const,
                                                                              width: 100,
                                                                              render: (time: number) => (
                                                                                  <Text>
                                                                                      {time > 0 ? formatTime(time) : "DNF"}
                                                                                  </Text>
                                                                              ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                                {
                                                                    title: "Overall Time",
                                                                    dataIndex: "overall_time",
                                                                    width: 120,
                                                                    render: (
                                                                        time: number,
                                                                        record: TournamentOverallRecord,
                                                                        index: number,
                                                                    ) => {
                                                                        const canOpen =
                                                                            record.video_url &&
                                                                            (record.status === "verified" || isAdmin);
                                                                        return (
                                                                            <Text
                                                                                bold
                                                                                style={{
                                                                                    color: index === 0 ? "#52c41a" : "#1890ff",
                                                                                    cursor: canOpen ? "pointer" : "default",
                                                                                    textDecoration: canOpen
                                                                                        ? "underline"
                                                                                        : "none",
                                                                                }}
                                                                                onClick={() =>
                                                                                    handleTimeClick(
                                                                                        record.video_url,
                                                                                        record.status,
                                                                                    )
                                                                                }
                                                                            >
                                                                                {formatTime(time)}
                                                                                {record.video_url && (
                                                                                    <IconVideoCamera
                                                                                        style={{marginLeft: 6, fontSize: 12}}
                                                                                    />
                                                                                )}
                                                                            </Text>
                                                                        );
                                                                    },
                                                                },
                                                                ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                    ? [
                                                                          {
                                                                              title: "Country",
                                                                              dataIndex: "country" as const,
                                                                              width: 120,
                                                                          },
                                                                          {
                                                                              title: "Status",
                                                                              dataIndex: "status" as const,
                                                                              width: 100,
                                                                              render: (status: string) => (
                                                                                  <Tag
                                                                                      color={
                                                                                          status === "verified"
                                                                                              ? "green"
                                                                                              : "orange"
                                                                                      }
                                                                                  >
                                                                                      {status === "verified"
                                                                                          ? "Verified"
                                                                                          : "Submitted"}
                                                                                  </Tag>
                                                                              ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                                ...(isAdmin
                                                                    ? [
                                                                          {
                                                                              title: "Actions",
                                                                              width: 150,
                                                                              render: (
                                                                                  _: unknown,
                                                                                  record: TournamentOverallRecord,
                                                                              ) => (
                                                                                  <div className="flex gap-2">
                                                                                      <Popover content="Edit record times">
                                                                                          <Button
                                                                                              size="mini"
                                                                                              type="primary"
                                                                                              icon={<IconEdit />}
                                                                                              onClick={() =>
                                                                                                  handleEditRecord(
                                                                                                      record,
                                                                                                      "overall",
                                                                                                  )
                                                                                              }
                                                                                          />
                                                                                      </Popover>
                                                                                      <Popover
                                                                                          content={
                                                                                              record.status === "verified"
                                                                                                  ? "Unverify this record"
                                                                                                  : "Verify this record"
                                                                                          }
                                                                                      >
                                                                                          <Button
                                                                                              size="mini"
                                                                                              status={
                                                                                                  record.status === "verified"
                                                                                                      ? "warning"
                                                                                                      : "success"
                                                                                              }
                                                                                              icon={
                                                                                                  record.status === "verified" ? (
                                                                                                      <IconClose />
                                                                                                  ) : (
                                                                                                      <IconCheck />
                                                                                                  )
                                                                                              }
                                                                                              onClick={() =>
                                                                                                  handleToggleVerification(
                                                                                                      record,
                                                                                                      true,
                                                                                                  )
                                                                                              }
                                                                                          />
                                                                                      </Popover>
                                                                                      <Popconfirm
                                                                                          title="Are you sure you want to delete this record and all its individual events?"
                                                                                          onOk={() =>
                                                                                              handleDeleteRecord(record, true)
                                                                                          }
                                                                                          okText="Delete"
                                                                                          cancelText="Cancel"
                                                                                      >
                                                                                          <Popover content="Delete this record">
                                                                                              <Button
                                                                                                  size="mini"
                                                                                                  status="danger"
                                                                                                  icon={<IconDelete />}
                                                                                              />
                                                                                          </Popover>
                                                                                      </Popconfirm>
                                                                                  </div>
                                                                              ),
                                                                          },
                                                                      ]
                                                                    : []),
                                                            ]}
                                                            data={(() => {
                                                                const individualEvent = events.find(
                                                                    (e) => e.type === "Individual",
                                                                );
                                                                const eventKey = individualEvent?.id ?? "Individual";
                                                                const bracketKey = buildBracketKey(
                                                                    "final",
                                                                    eventKey,
                                                                    classification,
                                                                );
                                                                const selectedBracketName = getSelectedBracketName(
                                                                    bracketKey,
                                                                    individualEvent,
                                                                );
                                                                const selectedBracket = individualEvent?.age_brackets?.find(
                                                                    (b) => b.name === selectedBracketName,
                                                                );
                                                                return filterRecordsByBracket(
                                                                    [...classificationOverallRecords].sort(
                                                                        (a, b) => a.overall_time - b.overall_time,
                                                                    ),
                                                                    selectedBracket,
                                                                );
                                                            })()}
                                                            pagination={{
                                                                pageSize: 20,
                                                                showTotal: true,
                                                                showJumper: true,
                                                            }}
                                                            rowKey="id"
                                                            size="small"
                                                        />
                                                    </Card>
                                                )}

                                                {/* Team Event Rankings for this classification */}
                                                {Array.from(new Set(classificationTeamRecords.map((r) => r.event))).map(
                                                    (eventType) => {
                                                        const eventRecords = classificationTeamRecords.filter(
                                                            (r) => r.event === eventType,
                                                        ) as TournamentTeamRecord[];
                                                        const eventConfig = events.find((e) => e.type === eventType);
                                                        const eventLabel = eventConfig ? getEventLabel(eventConfig) : eventType;
                                                        const eventKey = eventConfig?.id ?? eventType;
                                                        const bracketKey = buildBracketKey("final", eventKey, classification);
                                                        const selectedBracketName = getSelectedBracketName(
                                                            bracketKey,
                                                            eventConfig,
                                                        );
                                                        const selectedBracket = eventConfig?.age_brackets?.find(
                                                            (b) => b.name === selectedBracketName,
                                                        );

                                                        // Sort all records by best_time
                                                        const sortedRecords = eventRecords.sort(
                                                            (a, b) => a.best_time - b.best_time,
                                                        );
                                                        const filteredRecords = filterRecordsByBracket(
                                                            sortedRecords,
                                                            selectedBracket,
                                                        );

                                                        const columns: TableColumnProps<TournamentTeamRecord>[] = [
                                                            {
                                                                title: "Rank",
                                                                width: 60,
                                                                render: (_: unknown, __: TournamentTeamRecord, index: number) => (
                                                                    <Text
                                                                        bold
                                                                        style={{
                                                                            color:
                                                                                index === 0
                                                                                    ? "#52c41a"
                                                                                    : index === 1
                                                                                      ? "#1890ff"
                                                                                      : index === 2
                                                                                        ? "#fa8c16"
                                                                                        : "inherit",
                                                                        }}
                                                                    >
                                                                        {index + 1}
                                                                    </Text>
                                                                ),
                                                            },
                                                            {
                                                                title: "Team",
                                                                dataIndex: "team_name",
                                                                width: 200,
                                                            },
                                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                ? [
                                                                      {
                                                                          title: "Event Code",
                                                                          dataIndex: "code" as const,
                                                                          width: 100,
                                                                      },
                                                                  ]
                                                                : []),
                                                            {
                                                                title: "Best Time",
                                                                dataIndex: "best_time",
                                                                width: 120,
                                                                render: (
                                                                    time: number,
                                                                    record: TournamentTeamRecord,
                                                                    index: number,
                                                                ) => {
                                                                    const canOpen =
                                                                        record.video_url &&
                                                                        (record.status === "verified" || isAdmin);
                                                                    return (
                                                                        <Text
                                                                            bold
                                                                            style={{
                                                                                color: index === 0 ? "#52c41a" : "#1890ff",
                                                                                cursor: canOpen ? "pointer" : "default",
                                                                                textDecoration: canOpen ? "underline" : "none",
                                                                            }}
                                                                            onClick={() =>
                                                                                handleTimeClick(record.video_url, record.status)
                                                                            }
                                                                        >
                                                                            {formatTime(time)}
                                                                            {record.video_url && (
                                                                                <IconVideoCamera
                                                                                    style={{marginLeft: 6, fontSize: 12}}
                                                                                />
                                                                            )}
                                                                        </Text>
                                                                    );
                                                                },
                                                            },
                                                            ...(deviceBreakpoint > DeviceBreakpoint.md
                                                                ? [
                                                                      {
                                                                          title: "Country",
                                                                          dataIndex: "country" as const,
                                                                          width: 120,
                                                                      },
                                                                      {
                                                                          title: "Status",
                                                                          dataIndex: "status" as const,
                                                                          width: 100,
                                                                          render: (status: string) => (
                                                                              <Tag
                                                                                  color={
                                                                                      status === "verified" ? "green" : "orange"
                                                                                  }
                                                                              >
                                                                                  {status === "verified"
                                                                                      ? "Verified"
                                                                                      : "Submitted"}
                                                                              </Tag>
                                                                          ),
                                                                      },
                                                                  ]
                                                                : []),
                                                            ...(isAdmin
                                                                ? [
                                                                      {
                                                                          title: "Actions",
                                                                          width: 150,
                                                                          render: (_: unknown, record: TournamentTeamRecord) => (
                                                                              <div className="flex gap-2">
                                                                                  <Popover content="Edit record times">
                                                                                      <Button
                                                                                          size="mini"
                                                                                          type="primary"
                                                                                          icon={<IconEdit />}
                                                                                          onClick={() =>
                                                                                              handleEditRecord(record, "team")
                                                                                          }
                                                                                      />
                                                                                  </Popover>
                                                                                  <Popover
                                                                                      content={
                                                                                          record.status === "verified"
                                                                                              ? "Unverify this record"
                                                                                              : "Verify this record"
                                                                                      }
                                                                                  >
                                                                                      <Button
                                                                                          size="mini"
                                                                                          status={
                                                                                              record.status === "verified"
                                                                                                  ? "warning"
                                                                                                  : "success"
                                                                                          }
                                                                                          icon={
                                                                                              record.status === "verified" ? (
                                                                                                  <IconClose />
                                                                                              ) : (
                                                                                                  <IconCheck />
                                                                                              )
                                                                                          }
                                                                                          onClick={() =>
                                                                                              handleToggleVerification(
                                                                                                  record,
                                                                                                  false,
                                                                                              )
                                                                                          }
                                                                                      />
                                                                                  </Popover>
                                                                                  <Popconfirm
                                                                                      title="Are you sure you want to delete this record?"
                                                                                      onOk={() =>
                                                                                          handleDeleteRecord(record, false)
                                                                                      }
                                                                                      okText="Delete"
                                                                                      cancelText="Cancel"
                                                                                  >
                                                                                      <Popover content="Delete this record">
                                                                                          <Button
                                                                                              size="mini"
                                                                                              status="danger"
                                                                                              icon={<IconDelete />}
                                                                                          />
                                                                                      </Popover>
                                                                                  </Popconfirm>
                                                                              </div>
                                                                          ),
                                                                      },
                                                                  ]
                                                                : []),
                                                        ];

                                                        return (
                                                            <Card
                                                                key={`final-team-${classification}-${eventType}`}
                                                                title={`${eventLabel} - Team Rankings - ${classificationLabel}`}
                                                                bordered
                                                            >
                                                                {eventConfig && renderBracketTabs(eventConfig, bracketKey)}
                                                                <Table
                                                                    columns={columns}
                                                                    data={filteredRecords}
                                                                    pagination={{
                                                                        pageSize: 20,
                                                                        showTotal: true,
                                                                        showJumper: true,
                                                                    }}
                                                                    rowKey="id"
                                                                    size="small"
                                                                />
                                                            </Card>
                                                        );
                                                    },
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {prelimRecords.length === 0 &&
                            finalRecords.length === 0 &&
                            prelimOverallRecords.length === 0 &&
                            finalOverallRecords.length === 0 && (
                                <Text type="secondary">
                                    No records available yet. Click "View All Records" to see detailed results.
                                </Text>
                            )}
                    </div>
                )}

                {/* Edit Record Modal */}
                <Modal
                    title="Edit Record"
                    visible={editModalVisible}
                    onOk={handleSaveEdit}
                    onCancel={() => {
                        setEditModalVisible(false);
                        form.resetFields();
                    }}
                    okText="Save"
                    cancelText="Cancel"
                >
                    <Form form={form} layout="vertical">
                        {editingRecordType === "overall" ? (
                            <>
                                {individualEventRecords.map((eventRecord) => {
                                    const eventName = eventRecord.code.replace(/-/g, "_").toLowerCase();
                                    return (
                                        <div key={eventRecord.id}>
                                            <Divider orientation="left">{eventRecord.code}</Divider>
                                            <Form.Item
                                                label="Try 1 (seconds)"
                                                field={`${eventName}_try1`}
                                                rules={[{required: true, message: `Please enter ${eventRecord.code} Try 1 time`}]}
                                            >
                                                <InputNumber
                                                    min={0}
                                                    precision={3}
                                                    placeholder="Enter time in seconds (e.g., 2.123)"
                                                    style={{width: "100%"}}
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                label="Try 2 (seconds)"
                                                field={`${eventName}_try2`}
                                                rules={[{required: true, message: `Please enter ${eventRecord.code} Try 2 time`}]}
                                            >
                                                <InputNumber
                                                    min={0}
                                                    precision={3}
                                                    placeholder="Enter time in seconds (e.g., 3.456)"
                                                    style={{width: "100%"}}
                                                />
                                            </Form.Item>
                                            <Form.Item
                                                label="Try 3 (seconds)"
                                                field={`${eventName}_try3`}
                                                rules={[{required: true, message: `Please enter ${eventRecord.code} Try 3 time`}]}
                                            >
                                                <InputNumber
                                                    min={0}
                                                    precision={3}
                                                    placeholder="Enter time in seconds (e.g., 5.789)"
                                                    style={{width: "100%"}}
                                                />
                                            </Form.Item>
                                        </div>
                                    );
                                })}
                            </>
                        ) : (
                            <>
                                <Form.Item
                                    label="Try 1 Time (seconds)"
                                    field="try1"
                                    rules={[{required: true, message: "Please enter Try 1 time"}]}
                                >
                                    <InputNumber
                                        min={0}
                                        precision={3}
                                        placeholder="Enter time in seconds (e.g., 2.123)"
                                        style={{width: "100%"}}
                                    />
                                </Form.Item>
                                <Form.Item
                                    label="Try 2 Time (seconds)"
                                    field="try2"
                                    rules={[{required: true, message: "Please enter Try 2 time"}]}
                                >
                                    <InputNumber
                                        min={0}
                                        precision={3}
                                        placeholder="Enter time in seconds (e.g., 3.456)"
                                        style={{width: "100%"}}
                                    />
                                </Form.Item>
                                <Form.Item
                                    label="Try 3 Time (seconds)"
                                    field="try3"
                                    rules={[{required: true, message: "Please enter Try 3 time"}]}
                                >
                                    <InputNumber
                                        min={0}
                                        precision={3}
                                        placeholder="Enter time in seconds (e.g., 5.789)"
                                        style={{width: "100%"}}
                                    />
                                </Form.Item>
                            </>
                        )}
                        <Form.Item label="Video URL (optional)" field="video_url">
                            <Input placeholder="https://example.com/video" />
                        </Form.Item>
                    </Form>
                </Modal>
            </div>
        </div>
    );
}
