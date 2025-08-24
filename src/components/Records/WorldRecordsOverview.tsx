import {Card, Empty, Grid, Spin, Statistic, Tag, Typography} from "@arco-design/web-react";
import type React from "react";
import {useEffect, useState} from "react";
import type {GlobalResult} from "../../schema/RecordSchema";
import {getWorldRecords} from "../../services/firebase/recordService";

const {Title, Text} = Typography;
const {Row, Col} = Grid;

interface WorldRecordsOverviewProps {
    event?: string;
}

const WorldRecordsOverview: React.FC<WorldRecordsOverviewProps> = ({event}) => {
    const [worldRecords, setWorldRecords] = useState<Record<string, GlobalResult[]>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadWorldRecords();
    }, []);

    const loadWorldRecords = async () => {
        setLoading(true);
        try {
            const records = await getWorldRecords();
            setWorldRecords(records);
        } catch (error) {
            console.error("加载世界记录失败:", error);
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

    const getEventDisplayName = (event: string): string => {
        const eventNames: Record<string, string> = {
            "3-3-3": "3-3-3",
            "3-6-3": "3-6-3",
            Cycle: "Cycle",
            Double: "Double",
        };
        return eventNames[event] || event;
    };

    if (loading) {
        return (
            <div style={{textAlign: "center", padding: "40px"}}>
                <Spin size={40} />
                <div style={{marginTop: 16}}>Loading world records...</div>
            </div>
        );
    }

    if (Object.keys(worldRecords).length === 0) {
        return <Empty description="No world record data available" />;
    }

    const recordsToDisplay = event
        ? Object.entries(worldRecords).filter(([eventName]) => eventName === event)
        : Object.entries(worldRecords);

    if (recordsToDisplay.length === 0 && event) {
        return <Empty description={`No world records found for ${getEventDisplayName(event)}`} />;
    }

    return (
        <div>
            <Title heading={3} style={{marginBottom: 24}}>
                🏆 World Records Overview
            </Title>

            <Row gutter={[16, 16]}>
                {recordsToDisplay.map(([eventName, records]) => (
                    <Col xs={24} sm={12} lg={6} key={eventName}>
                        <Card title={getEventDisplayName(eventName)} size="small" hoverable style={{height: "100%"}}>
                            {records.length > 0 ? (
                                <div>
                                    <div style={{marginBottom: 16}}>
                                        <Statistic
                                            title="World Record"
                                            value={formatTime(records[0].bestTime)}
                                            style={{color: "#cf1322", fontSize: "18px", fontWeight: "bold"}}
                                        />
                                    </div>

                                    <div style={{marginBottom: 8}}>
                                        <Text type="secondary">Top 3:</Text>
                                    </div>

                                    {records.slice(0, 3).map((record, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "center",
                                                marginBottom: 4,
                                                padding: "4px 8px",
                                                backgroundColor:
                                                    index === 0
                                                        ? "#fff7e6"
                                                        : index === 1
                                                          ? "#f5f5f5"
                                                          : index === 2
                                                            ? "#fff2e8"
                                                            : "transparent",
                                                borderRadius: 4,
                                            }}
                                        >
                                            <div style={{display: "flex", alignItems: "center"}}>
                                                <Tag
                                                    color={index === 0 ? "gold" : index === 1 ? "silver" : "bronze"}
                                                    size="small"
                                                    style={{marginRight: 8, minWidth: "20px", textAlign: "center"}}
                                                >
                                                    {index + 1}
                                                </Tag>
                                                <Text style={{maxWidth: "80px", overflow: "hidden", textOverflow: "ellipsis"}}>
                                                    {record.participantName || record.teamName || "Unknown"}
                                                </Text>
                                            </div>
                                            <Text style={{fontWeight: "bold"}}>{formatTime(record.bestTime)}</Text>
                                        </div>
                                    ))}

                                    {records.length > 3 && (
                                        <div style={{textAlign: "center", marginTop: 8}}>
                                            <Text type="secondary">And {records.length - 3} more records</Text>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <Empty description="No records" />
                            )}
                        </Card>
                    </Col>
                ))}
            </Row>
        </div>
    );
};

export default WorldRecordsOverview;
