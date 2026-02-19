import {useAuthContext} from "@/context/AuthContext";
import type {ShareRound, TournamentEvent} from "@/schema";
import {getShareScoreSheetData} from "@/services/firebase/shareResultService";
import {formatDate} from "@/utils/Date/formatDate";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {getEventLabel, isTeamEvent as isTournamentTeamEvent} from "@/utils/tournament/eventUtils";
import {
    Button,
    Card,
    Empty,
    Message,
    Result,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tabs,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconCopy, IconLaunch, IconLeft, IconPrinter, IconRefresh} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title, Text} = Typography;

type SharePageRow = {
    id: string;
    rank: number;
    name: string;
    globalId?: string;
    bestTime: number;
    try1?: number;
    try2?: number;
    try3?: number;
    [key: string]: unknown;
};

const formatTime = (time: number): string => {
    if (!Number.isFinite(time) || time <= 0) return "N/A";
    let minutes = Math.floor(time / 60);
    let seconds = Math.floor(time % 60);
    let thousandths = Math.round((time - Math.floor(time)) * 1000);

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

const medalColor = (rank: number): string => {
    if (rank === 1) return "gold";
    if (rank === 2) return "orangered";
    if (rank === 3) return "purple";
    return "blue";
};

const roundLabel = (round: ShareRound): string => (round === "prelim" ? "Preliminary" : "Final");

const buildColumnsForEvent = (event: TournamentEvent): TableColumnProps<SharePageRow>[] => {
    const isTeamEvent = isTournamentTeamEvent(event);
    const codes = event.codes ?? [];

    const columns: TableColumnProps<SharePageRow>[] = [
        {
            title: "Rank",
            dataIndex: "rank",
            width: 88,
            render: (rank: number) => <Tag color={medalColor(rank)}>#{rank}</Tag>,
        },
        {
            title: isTeamEvent ? "Team" : "Athlete",
            dataIndex: "name",
            width: 220,
        },
    ];

    if (!isTeamEvent) {
        columns.push({
            title: "Global ID",
            dataIndex: "globalId",
            width: 160,
            render: (value: string | undefined) => value ?? "—",
        });
    }

    if (codes.length > 1) {
        for (const code of codes) {
            columns.push({
                title: code,
                dataIndex: `${code} Best`,
                width: 120,
                render: (value: unknown) => (typeof value === "number" ? formatTime(value) : "N/A"),
            });
        }
        columns.push({
            title: "Total Time",
            dataIndex: "bestTime",
            width: 140,
            render: (value: number) => <Text bold>{formatTime(value)}</Text>,
        });
    } else {
        columns.push(
            {
                title: "Try 1",
                dataIndex: "try1",
                width: 120,
                render: (value: number | undefined) => (typeof value === "number" ? formatTime(value) : "N/A"),
            },
            {
                title: "Try 2",
                dataIndex: "try2",
                width: 120,
                render: (value: number | undefined) => (typeof value === "number" ? formatTime(value) : "N/A"),
            },
            {
                title: "Try 3",
                dataIndex: "try3",
                width: 120,
                render: (value: number | undefined) => (typeof value === "number" ? formatTime(value) : "N/A"),
            },
            {
                title: "Best Time",
                dataIndex: "bestTime",
                width: 120,
                render: (value: number) => <Text bold>{formatTime(value)}</Text>,
            },
        );
    }

    return columns;
};

const ScoreSheetPage = () => {
    const {user} = useAuthContext();
    const navigate = useNavigate();
    const {tournamentId, round} = useParams<{tournamentId: string; round: string}>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [activeEventId, setActiveEventId] = useState<string>("");
    const [activeBracketKey, setActiveBracketKey] = useState<string>("");
    const [payload, setPayload] = useState<Awaited<ReturnType<typeof getShareScoreSheetData>>>(null);

    const isMobile = useDeviceBreakpoint() <= DeviceBreakpoint.sm;
    const canShareLinks = Boolean(user?.roles?.edit_tournament || user?.roles?.verify_record);

    const parsedRound = useMemo<ShareRound | null>(() => {
        if (round === "prelim" || round === "final") {
            return round;
        }
        return null;
    }, [round]);

    const loadData = async () => {
        if (!tournamentId || !parsedRound) {
            return;
        }

        setLoading(true);
        setError(null);
        setNotFound(false);

        try {
            const result = await getShareScoreSheetData(tournamentId, parsedRound);
            if (!result) {
                setNotFound(true);
                return;
            }

            setPayload(result);
            const firstEvent = result.sections[0];
            if (firstEvent) {
                setActiveEventId(firstEvent.event.id ?? "");
                const firstBracket = firstEvent.brackets[0];
                if (firstBracket) {
                    const classificationPart = firstBracket.classification ?? "all";
                    setActiveBracketKey(`${firstBracket.bracket.name}::${classificationPart}`);
                }
            }
        } catch (loadError) {
            console.error(loadError);
            setError("Failed to load score sheet.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadData();
    }, [tournamentId, parsedRound]);

    const copyLink = async () => {
        if (!tournamentId || !parsedRound) return;
        const url = `${window.location.origin}/score-sheet/${tournamentId}/${parsedRound}`;
        try {
            await navigator.clipboard.writeText(url);
            Message.success("Share link copied.");
        } catch (copyError) {
            console.error(copyError);
            Message.error("Failed to copy share link.");
        }
    };

    const currentSection = useMemo(() => {
        if (!payload) return null;
        return payload.sections.find((section) => section.event.id === activeEventId) ?? payload.sections[0] ?? null;
    }, [payload, activeEventId]);

    const currentBracket = useMemo(() => {
        if (!currentSection) return null;
        return (
            currentSection.brackets.find((bracket) => {
                const classificationPart = bracket.classification ?? "all";
                return `${bracket.bracket.name}::${classificationPart}` === activeBracketKey;
            }) ??
            currentSection.brackets[0] ??
            null
        );
    }, [currentSection, activeBracketKey]);

    const columns = useMemo(() => {
        if (!currentSection) return [];
        return buildColumnsForEvent(currentSection.event);
    }, [currentSection]);

    if (!parsedRound) {
        return (
            <div className="p-6 md:p-10">
                <Result
                    status="404"
                    title="Invalid score sheet route"
                    subTitle="Round must be prelim or final."
                    extra={
                        <Space>
                            <Button icon={<IconLeft />} onClick={() => window.history.back()}>
                                Back
                            </Button>
                            {tournamentId ? (
                                <Button
                                    type="primary"
                                    icon={<IconLaunch />}
                                    onClick={() => navigate(`/tournaments/${tournamentId}/view`)}
                                >
                                    Go to Tournament
                                </Button>
                            ) : null}
                        </Space>
                    }
                />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Spin size={40} tip="Loading score sheet..." />
            </div>
        );
    }

    if (notFound) {
        return (
            <div className="p-6 md:p-10">
                <Result
                    status="404"
                    title="Tournament not found"
                    subTitle="Please check the shared link and try again."
                    extra={
                        <Space>
                            <Button icon={<IconLeft />} onClick={() => window.history.back()}>
                                Back
                            </Button>
                            {tournamentId ? (
                                <Button
                                    type="primary"
                                    icon={<IconLaunch />}
                                    onClick={() => navigate(`/tournaments/${tournamentId}/view`)}
                                >
                                    Go to Tournament
                                </Button>
                            ) : null}
                        </Space>
                    }
                />
            </div>
        );
    }

    if (error || !payload) {
        return (
            <div className="p-6 md:p-10">
                <Result
                    status="error"
                    title="Unable to load score sheet"
                    subTitle={error ?? "Unexpected error."}
                    extra={
                        <Button type="primary" icon={<IconRefresh />} onClick={loadData}>
                            Retry
                        </Button>
                    }
                />
            </div>
        );
    }

    const hasRows = (currentBracket?.rows?.length ?? 0) > 0;

    return (
        <div
            className="p-0 md:p-6 xl:p-10"
            style={{
                background: "linear-gradient(180deg, #f6f8fb 0%, #edf2f7 100%)",
                minHeight: "calc(100vh - 96px)",
            }}
        >
            <Card
                bordered={false}
                style={{
                    borderRadius: 16,
                    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.08)",
                    marginBottom: 16,
                }}
            >
                <div className="flex flex-col gap-3 md:flex-row md:justify-between md:items-center">
                    <div>
                        <Title heading={3} style={{marginBottom: 4}}>
                            {payload.tournament.name}
                        </Title>
                        <Space size={8}>
                            <Tag color="arcoblue">{roundLabel(payload.round)}</Tag>
                            <Text type="secondary">Start: {formatDate(payload.tournament.start_date)}</Text>
                            <Text type="secondary">End: {formatDate(payload.tournament.end_date)}</Text>
                        </Space>
                    </div>
                    <Space wrap>
                        {canShareLinks && (
                            <Button icon={<IconCopy />} onClick={copyLink} style={{minHeight: 44}}>
                                Copy Link
                            </Button>
                        )}
                        <Button
                            icon={<IconLaunch />}
                            onClick={() => navigate(`/tournaments/${tournamentId}/view`)}
                            style={{minHeight: 44}}
                        >
                            Open Tournament
                        </Button>
                        <Button icon={<IconPrinter />} onClick={() => window.print()} style={{minHeight: 44}}>
                            Print
                        </Button>
                    </Space>
                </div>
            </Card>

            <Card bordered={false} style={{borderRadius: 16, boxShadow: "0 10px 24px rgba(15, 23, 42, 0.06)"}}>
                <Tabs
                    type="line"
                    activeTab={activeEventId}
                    onChange={(key) => {
                        setActiveEventId(key);
                        const target = payload.sections.find((section) => section.event.id === key);
                        const firstBracket = target?.brackets[0];
                        if (firstBracket) {
                            const classificationPart = firstBracket.classification ?? "all";
                            setActiveBracketKey(`${firstBracket.bracket.name}::${classificationPart}`);
                        }
                    }}
                >
                    {payload.sections.map((section) => (
                        <Tabs.TabPane key={section.event.id} title={getEventLabel(section.event)} />
                    ))}
                </Tabs>

                {currentSection ? (
                    <Tabs type="capsule" activeTab={activeBracketKey} onChange={setActiveBracketKey} style={{marginTop: 8}}>
                        {currentSection.brackets.map((bracket) => {
                            const classificationPart = bracket.classification ?? "all";
                            const key = `${bracket.bracket.name}::${classificationPart}`;
                            const classificationLabel = bracket.classification
                                ? ` - ${bracket.classification.charAt(0).toUpperCase() + bracket.classification.slice(1)}`
                                : "";

                            return <Tabs.TabPane key={key} title={`${bracket.bracket.name}${classificationLabel}`} />;
                        })}
                    </Tabs>
                ) : null}

                <div style={{marginTop: 16}}>
                    {!hasRows ? (
                        <Empty description={`No ${roundLabel(parsedRound)} records found for this selection.`} />
                    ) : isMobile ? (
                        <div className="flex flex-col gap-3">
                            {currentBracket?.rows.map((row) => (
                                <Card key={row.id} style={{borderRadius: 12, border: "1px solid #e5e7eb"}}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <Tag color={medalColor(row.rank)} style={{marginBottom: 8}}>
                                                Rank #{row.rank}
                                            </Tag>
                                            <div className="text-base font-semibold">{String(row.name ?? "N/A")}</div>
                                            {row.globalId ? (
                                                <Text type="secondary" style={{fontSize: 12}}>
                                                    Global ID: {String(row.globalId)}
                                                </Text>
                                            ) : null}
                                        </div>
                                        <Text style={{fontWeight: 700, fontSize: 18}}>{formatTime(Number(row.bestTime))}</Text>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    ) : (
                        <Table
                            rowKey={(record) => record.id}
                            data={currentBracket?.rows ?? []}
                            columns={columns}
                            pagination={false}
                            scroll={{x: true}}
                            border={false}
                        />
                    )}
                </div>
            </Card>
        </div>
    );
};

export default ScoreSheetPage;
