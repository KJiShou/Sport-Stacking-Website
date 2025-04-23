import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
    Card,
    Spin,
    Statistic,
    Avatar,
    Typography,
    Table,
} from "@arco-design/web-react";
import { IconUser } from "@arco-design/web-react/icon";
import type { FirestoreUser } from "../../../schema";
import { fetchUserByID } from "../../../services/firebase/authService";

const { Title, Text } = Typography;

interface AllTimeStat {
    event: string;
    time: number;
    rank: string;
}
interface OnlineBest {
    event: string;
    time: number;
}
interface RecordItem {
    event: string;
    time: number;
    date: string;
}

export default function RegisterPage() {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const { id } = useParams<{ id: string }>();


    useEffect(() => {
        if (!id) {
            setLoading(false);
            return;
        }

        setLoading(true);

        (async () => {
            try {
                const data = await fetchUserByID(id);
                setUser(data ?? null);
            } catch (err) {
                console.error(err);
                setUser(null);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    // 构建统计数据示例
    const allTimeStats: AllTimeStat[] = [
        { event: "all-around", time: user?.best_times?.["all-around"] ?? 0, rank: "-" },
        // TODO: 按需添加其他项目并计算排名
    ];
    const onlineBest: OnlineBest[] = [];
    const records: RecordItem[] = [];

    return (
        <div>
            <div className={`p-6 `}>
                {loading && <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                    <Spin tip="Loading..." size={40} />
                </div>}
                <div className="max-w-2xl mx-auto space-y-6">
                    {/* 基本信息卡片 */}
                    <Card className="text-center">
                        <Avatar className="mx-auto w-24 h-24 rounded-full overflow-hidden">
                            <img
                                src={user?.image_url}
                                alt={user?.name}
                                className="w-full h-full object-cover"
                            />
                        </Avatar>
                        <Title heading={4} className="mt-4">
                            {user?.name}
                        </Title>
                        <Text className="flex items-center justify-center gap-1">
                            <IconUser /> {user?.global_id}
                        </Text>
                        <Text className="block mt-1 text-sm text-gray-600">
                            {user?.country} / {user?.state}
                        </Text>
                    </Card>

                    {/* 最佳成绩 */}
                    <Card>
                        <Statistic
                            title="All-around Best Time"
                            value={user?.best_times?.["all-around"]?.toFixed(3) ?? "-"}
                            suffix="sec"
                        />
                    </Card>

                    {/* 全时统计表 */}
                    <Card title="All Time Statistics">
                        <Table
                            data={allTimeStats}
                            columns={[
                                { title: "Event", dataIndex: "event" },
                                {
                                    title: "Time (sec)",
                                    dataIndex: "time",
                                    render: (val) => val.toFixed(3),
                                },
                                { title: "Rank", dataIndex: "rank" },
                            ]}
                            pagination={false}
                        />
                    </Card>

                    {/* TODO: 可继续添加 Online Best, Records 表格 */}
                </div>
            </div>
        </div>
    );
}
