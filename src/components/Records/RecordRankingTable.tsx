import {Card, Empty, Select, Spin, Table, Tabs, Tag, Typography} from "@arco-design/web-react";
import type React from "react";
import {useEffect, useState} from "react";
import type {GlobalResult} from "../../schema/RecordSchema";
import {getClassificationRankings, getEventRankings} from "../../services/firebase/recordService";

const {Title, Text} = Typography;
const {TabPane} = Tabs;
const {Option} = Select;

interface RecordRankingTableProps {
    event: string;
    title: string;
}

const RecordRankingTable: React.FC<RecordRankingTableProps> = ({event, title}) => {
    const [rankings, setRankings] = useState<GlobalResult[]>([]);
    const [loading, setLoading] = useState(true);
    const [round, setRound] = useState<"prelim" | "final">("final");
    const [classification, setClassification] = useState<"all" | "beginner" | "intermediate" | "advance">("all");

    useEffect(() => {
        loadRankings();
    }, [event, round, classification]);

    const loadRankings = async () => {
        setLoading(true);
        try {
            let data: GlobalResult[];
            if (classification === "all") {
                data = await getEventRankings(event, round);
            } else {
                data = await getClassificationRankings(event, classification, round);
            }
            setRankings(data);
        } catch (error) {
            console.error("加载排名失败:", error);
        } finally {
            setLoading(false);
        }
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
            render: (name: string, record: GlobalResult) => (
                <div>
                    <div style={{fontWeight: "bold"}}>{record.participantName || record.teamName || "Unknown"}</div>
                    {record.classification && (
                        <Tag size="small" color="blue">
                            {record.classification === "beginner"
                                ? "Beginner"
                                : record.classification === "intermediate"
                                  ? "Intermediate"
                                  : "Advanced"}
                        </Tag>
                    )}
                </div>
            ),
        },
        {
            title: "Best Time",
            dataIndex: "bestTime",
            key: "bestTime",
            width: 120,
            render: (time: number) => <Text style={{fontWeight: "bold", color: "#1890ff"}}>{formatTime(time)}</Text>,
        },
        {
            title: "Try 1",
            dataIndex: "try1",
            key: "try1",
            width: 100,
            render: (time: number) => formatTime(time),
        },
        {
            title: "Try 2",
            dataIndex: "try2",
            key: "try2",
            width: 100,
            render: (time: number) => formatTime(time),
        },
        {
            title: "Try 3",
            dataIndex: "try3",
            key: "try3",
            width: 100,
            render: (time: number) => formatTime(time),
        },
        {
            title: "Round",
            dataIndex: "round",
            key: "round",
            width: 80,
            render: (round: string) => (
                <Tag color={round === "final" ? "green" : "orange"}>{round === "final" ? "Final" : "Preliminary"}</Tag>
            ),
        },
    ];

    const dataSource = rankings.map((record, index) => ({
        ...record,
        rank: index + 1,
        key: `${record.tournamentId}_${record.participantId || record.teamId}_${record.round}`,
    }));

    return (
        <Card title={title} style={{marginBottom: 16}}>
            <div style={{marginBottom: 16}}>
                <Select value={round} onChange={setRound} style={{width: 120, marginRight: 16}}>
                    <Option value="prelim">Preliminary</Option>
                    <Option value="final">Final</Option>
                </Select>

                <Select value={classification} onChange={setClassification} style={{width: 120}}>
                    <Option value="all">All Levels</Option>
                    <Option value="beginner">Beginner</Option>
                    <Option value="intermediate">Intermediate</Option>
                    <Option value="advance">Advanced</Option>
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
