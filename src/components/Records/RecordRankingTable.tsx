import {Card, Empty, Select, Spin, Table, Tabs, Tag, Typography} from "@arco-design/web-react";
import type React from "react";
import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import type {GlobalRecord, RecordRankingTableProps} from "../../schema/RecordSchema";
import {getClassificationRankings, getEventRankings} from "../../services/firebase/recordService";

const {Title, Text} = Typography;
const {TabPane} = Tabs;
const {Option} = Select;

type RankingRecord = GlobalRecord;
type ClassificationLevel = "beginner" | "intermediate" | "advance" | "prelim";
type ClassificationFilter = "all" | ClassificationLevel;

const CLASSIFICATION_LABELS: Record<ClassificationLevel, string> = {
    beginner: "Beginner",
    intermediate: "Intermediate",
    advance: "Advanced",
    prelim: "Prelim",
};

const CLASSIFICATION_TAG_COLORS: Record<ClassificationLevel, string> = {
    beginner: "#165dff",
    intermediate: "#52c41a",
    advance: "#7a60ff",
    prelim: "#fa8c16",
};

const getDisplayName = (record: RankingRecord): string => {
    if ("participantName" in record && record.participantName) {
        return record.participantName;
    }
    if ("teamName" in record && record.teamName) {
        return record.teamName;
    }
    return "Unknown";
};

const getParticipantId = (record: RankingRecord): string | undefined => {
    if ("participantId" in record) {
        return record.participantId ?? undefined;
    }
    return undefined;
};

const getTeamId = (record: RankingRecord): string | undefined => {
    if ("teamId" in record) {
        return record.teamId ?? undefined;
    }
    return undefined;
};

const RecordRankingTable: React.FC<RecordRankingTableProps> = ({event, title}) => {
    const [rankings, setRankings] = useState<RankingRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [round, setRound] = useState<"prelim" | "final">("final");
    const [classification, setClassification] = useState<ClassificationFilter>("all");

    useEffect(() => {
        loadRankings();
    }, [event, round, classification]);

    const loadRankings = async () => {
        setLoading(true);
        try {
            let data: RankingRecord[];
            if (classification === "all") {
                data = await getEventRankings(event, round);
            } else {
                data = await getClassificationRankings(event, classification, round);
            }
            const normalized = data.map((record) => ({
                ...record,
                bestTime: record.bestTime ?? record.time,
            }));
            setRankings(normalized);
        } catch (error) {
            console.error("加载排名失败:", error);
        } finally {
            setLoading(false);
        }
    };

    const formatTime = (time?: number): string => {
        if (time === undefined || time === null) return "DNF";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        const milliseconds = Math.floor((time % 1) * 100);

        if (minutes > 0) {
            return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(2, "0")}`;
        }
        return `${seconds}.${milliseconds.toString().padStart(2, "0")}`;
    };

    const getRankColor = (rank: number): string => {
        if (rank === 1) return "gold";
        if (rank === 2) return "silver";
        if (rank === 3) return "bronze";
        return "default";
    };

    const columns = [
        {
            title: "Rank",
            dataIndex: "rank",
            key: "rank",
            width: 80,
            render: (rank: number) => (
                <Tag color={getRankColor(rank)} style={{fontWeight: "bold"}}>
                    {rank}
                </Tag>
            ),
        },
        {
            title: "Name/Team",
            dataIndex: "participantName",
            key: "participantName",
            render: (_: string, record: RankingRecord) => {
                const name = getDisplayName(record);
                const participantId = getParticipantId(record);
                return (
                    <div>
                        <div style={{fontWeight: "bold"}}>
                            {participantId ? (
                                <Link to={`/athletes/${participantId}`} style={{color: "inherit"}}>
                                    {name}
                                </Link>
                            ) : (
                                name
                            )}
                        </div>
                        {record.classification && (
                            <Tag size="small" color={CLASSIFICATION_TAG_COLORS[record.classification] ?? "blue"}>
                                {CLASSIFICATION_LABELS[record.classification] ?? record.classification}
                            </Tag>
                        )}
                    </div>
                );
            },
        },
        {
            title: "Best Time",
            dataIndex: "bestTime",
            key: "bestTime",
            width: 120,
            render: (time: number, record: RankingRecord) => (
                <Text style={{fontWeight: "bold", color: "#1890ff"}}>{formatTime(time ?? record.time)}</Text>
            ),
        },
        {
            title: "Try 1",
            dataIndex: "try1",
            key: "try1",
            width: 100,
            render: (time?: number, record?: RankingRecord) => formatTime(time ?? record?.time),
        },
        {
            title: "Try 2",
            dataIndex: "try2",
            key: "try2",
            width: 100,
            render: (time?: number, record?: RankingRecord) => formatTime(time ?? record?.time),
        },
        {
            title: "Try 3",
            dataIndex: "try3",
            key: "try3",
            width: 100,
            render: (time?: number, record?: RankingRecord) => formatTime(time ?? record?.time),
        },
        {
            title: "Round",
            dataIndex: "round",
            key: "round",
            width: 80,
            render: (round?: string) =>
                round ? (
                    <Tag color={round === "final" ? "green" : "orange"}>{round === "final" ? "Final" : "Preliminary"}</Tag>
                ) : (
                    <Tag color="purple">N/A</Tag>
                ),
        },
    ];

    const dataSource = rankings.map((record, index) => ({
        ...record,
        rank: index + 1,
        key: (() => {
            const tournamentPart = record.tournamentId ?? event;
            const entityPart = getParticipantId(record) ?? getTeamId(record) ?? `${index}`;
            const roundPart = record.round ?? "unknown";
            return `${tournamentPart}_${entityPart}_${roundPart}`;
        })(),
    }));

    return (
        <Card title={title} style={{marginBottom: 16}}>
            <div style={{marginBottom: 16}}>
                <Select value={round} onChange={setRound} style={{width: 120, marginRight: 16}}>
                    <Option value="prelim">Preliminary</Option>
                    <Option value="final">Final</Option>
                </Select>

                <Select value={classification} onChange={setClassification} style={{width: 140}}>
                    <Option value="all">All Levels</Option>
                    {Object.entries(CLASSIFICATION_LABELS).map(([value, label]) => (
                        <Option key={value} value={value}>
                            {label}
                        </Option>
                    ))}
                </Select>
            </div>

            {loading ? (
                <div style={{textAlign: "center", padding: "40px"}}>
                    <Spin size={40} />
                    <div style={{marginTop: 16}}>Loading rankings...</div>
                </div>
            ) : dataSource.length > 0 ? (
                <Table columns={columns} data={dataSource} pagination={false} scroll={{x: 800}} size="small" />
            ) : (
                <Empty description="No record data available" />
            )}
        </Card>
    );
};

export default RecordRankingTable;
