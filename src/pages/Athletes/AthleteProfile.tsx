import {useEffect, useMemo, useState} from "react";
import {Link, useParams} from "react-router-dom";

import {
    Avatar,
    Button,
    Card,
    Empty,
    Result,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconArrowLeft} from "@arco-design/web-react/icon";

import type {AthleteEventSummary, AthleteTournamentParticipation, IndividualEvent} from "@/services/firebase/athleteService";
import {fetchAthleteProfile} from "@/services/firebase/athleteService";
import {formatDateSafe, formatStackingTime} from "@/utils/time";

const {Title, Paragraph, Text} = Typography;

const EVENT_LABELS: Record<IndividualEvent, string> = {
    "3-3-3": "3-3-3",
    "3-6-3": "3-6-3",
    Cycle: "Cycle",
    Overall: "Overall",
};

type EventRow = AthleteEventSummary;
type TournamentEventRow = AthleteTournamentParticipation["events"][number];

const STATUS_COLORS: Record<string, string> = {
    verified: "green",
    submitted: "orange",
    registered: "purple",
    pending: "orange",
    approved: "green",
    rejected: "red",
};

const AthleteProfilePage = () => {
    const {athleteId} = useParams<{athleteId: string}>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [profile, setProfile] = useState<Awaited<ReturnType<typeof fetchAthleteProfile>>>(null);

    useEffect(() => {
        if (!athleteId) {
            setError("Missing athlete identifier.");
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchAthleteProfile(athleteId)
            .then((result) => {
                if (!cancelled) {
                    setProfile(result);
                    if (!result) {
                        setError("No athlete data found.");
                    }
                }
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) {
                    setError("Failed to load athlete profile.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [athleteId]);

    const eventColumns: TableColumnProps<EventRow>[] = useMemo(
        () => [
            {
                title: "Event",
                dataIndex: "event",
                render: (_: IndividualEvent, row: EventRow) => {
                    const base = EVENT_LABELS[row.event] ?? row.event;
                    const suffix = row.round ? ` (${row.round === "final" ? "Final" : "Prelim"})` : "";
                    return `${base}${suffix}`;
                },
            },
            {
                title: "Best Time",
                dataIndex: "bestTime",
                render: (time: number) => <span className="font-semibold">{formatStackingTime(time)}</span>,
            },
            {
                title: "Current Rank",
                dataIndex: "rank",
                render: (rank: number | null) =>
                    typeof rank === "number" ? <Tag color="green">#{rank}</Tag> : <Tag color="gray">N/A</Tag>,
            },
            {
                title: "Last Updated",
                dataIndex: "lastUpdated",
                render: (value: Date | null) => formatDateSafe(value),
            },
        ],
        [],
    );

    const tournamentEventColumns: TableColumnProps<TournamentEventRow>[] = useMemo(
        () => [
            {
                title: "Event",
                dataIndex: "event",
                render: (_: string, row: TournamentEventRow) => {
                    const base = EVENT_LABELS[row.event as IndividualEvent] ?? row.event;
                    const suffix = row.round ? ` (${row.round === "final" ? "Final" : "Prelim"})` : "";
                    return `${base}${suffix}`;
                },
            },
            {
                title: "Time",
                dataIndex: "time",
                render: (time: number) => formatStackingTime(time),
            },
            {
                title: "Status",
                dataIndex: "status",
                render: (status: string) => {
                    const normalized = typeof status === "string" ? status.toLowerCase() : "";
                    const color = STATUS_COLORS[normalized] ?? "arcoblue";
                    const label = typeof status === "string" ? status.toUpperCase() : String(status ?? "—");
                    return <Tag color={color}>{label}</Tag>;
                },
            },
            {
                title: "Recorded",
                dataIndex: "updatedAt",
                render: (_: Date | null, record: TournamentEventRow) =>
                    formatDateSafe(record.updatedAt ?? record.createdAt ?? null),
            },
        ],
        [],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full">
                <Spin size={32} tip="Loading athlete profile..." />
            </div>
        );
    }

    if (error || !profile) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-6">
                <Result status="error" title="Unable to load athlete" subTitle={error ?? "Something went wrong."}>
                    <Link to="/athletes">
                        <Button icon={<IconArrowLeft />} type="outline">
                            Back to rankings
                        </Button>
                    </Link>
                </Result>
            </div>
        );
    }

    const {name, gender, age, country, avatarUrl, eventSummaries, tournaments, id} = profile;

    return (
        <div className="flex flex-col h-full bg-ghostwhite overflow-auto p-0 md:p-6 xl:p-10 gap-6">
            <div className="flex items-center justify-between">
                <Space size={16} align="center">
                    <Link to="/athletes">
                        <Button type="text" icon={<IconArrowLeft />}>
                            Back
                        </Button>
                    </Link>
                    <Title heading={3} className="!mb-0">
                        Athlete Profile
                    </Title>
                </Space>
            </div>

            <Card>
                <Space size={24} align="start">
                    <Avatar size={80} shape="circle">
                        {avatarUrl ? <img src={avatarUrl} alt={name} /> : (name?.charAt(0) ?? "A")}
                    </Avatar>
                    <div className="flex flex-col gap-2">
                        <Space size={12} align="center">
                            <Title heading={4} className="!mb-0">
                                {name}
                            </Title>
                            <Tag color="arcoblue">ID: {id}</Tag>
                        </Space>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="flex flex-col text-sm text-neutral-700">
                                <Text type="secondary">Country</Text>
                                <span>{country ?? "—"}</span>
                            </div>
                            <div className="flex flex-col text-sm text-neutral-700">
                                <Text type="secondary">Gender</Text>
                                <span>{gender ?? "—"}</span>
                            </div>
                            <div className="flex flex-col text-sm text-neutral-700">
                                <Text type="secondary">Age</Text>
                                <span>{typeof age === "number" ? age : "—"}</span>
                            </div>
                        </div>
                    </div>
                </Space>
            </Card>

            <Card title="Best Performances">
                {eventSummaries.length === 0 ? (
                    <Empty description="No recorded performances yet." />
                ) : (
                    <Table
                        rowKey={(row) => row.event}
                        columns={eventColumns}
                        data={eventSummaries}
                        pagination={false}
                        scroll={{x: true}}
                    />
                )}
            </Card>

            <Card title="Tournament Participation">
                {tournaments.length === 0 ? (
                    <Empty description="No tournament participation records found." />
                ) : (
                    <Space direction="vertical" size={16} className="w-full">
                        {tournaments.map((tournament) => (
                            <Card
                                key={tournament.tournamentId}
                                size="small"
                                title={tournament.tournamentName}
                                bordered
                                className="w-full"
                            >
                                <Space size={16} wrap>
                                    <Text type="secondary">ID: {tournament.tournamentId}</Text>
                                    <Text type="secondary">Country: {tournament.country ?? "—"}</Text>
                                    <Text type="secondary">
                                        Dates: {formatDateSafe(tournament.startDate)} - {formatDateSafe(tournament.endDate)}
                                    </Text>
                                </Space>
                                <Table
                                    className="mt-4"
                                    rowKey={(row) => `${row.event}-${row.id}`}
                                    columns={tournamentEventColumns}
                                    data={tournament.events}
                                    pagination={false}
                                    size="small"
                                    scroll={{x: true}}
                                />
                            </Card>
                        ))}
                    </Space>
                )}
            </Card>
        </div>
    );
};

export default AthleteProfilePage;
