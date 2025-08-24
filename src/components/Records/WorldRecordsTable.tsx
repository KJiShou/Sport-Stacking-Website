import {Card, Empty, Spin, Table, Typography} from "@arco-design/web-react";
import type React from "react";
import {useEffect, useState} from "react";
import type {GlobalResult} from "../../schema/RecordSchema";
import {getBestRecordsByAgeGroup} from "../../services/firebase/recordService";

// 添加CSS样式
const tableStyles = `
    .header-row {
        background-color: #f0f8ff !important;
        font-weight: bold;
    }
    .header-row td {
        background-color: #f0f8ff !important;
    }
`;

interface RecordRow {
    key: string;
    event: string;
    ageGroup: string;
    time: string;
    athlete: string;
    country: string;
    year: string;
    isHeader: boolean;
}

const {Title, Text} = Typography;

const WorldRecordsTable: React.FC = () => {
    const [allRecords, setAllRecords] = useState<Record<string, GlobalResult[]>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadWorldRecords();
    }, []);

    const loadWorldRecords = async () => {
        setLoading(true);
        try {
            const records = await getBestRecordsByAgeGroup();
            setAllRecords(records);
        } catch (error) {
            console.error("Failed to load world records:", error);
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

    const createMergedDataSource = (): RecordRow[] => {
        const mergedData: RecordRow[] = [];
        const individualEvents = ["3-3-3", "3-6-3", "Cycle"];
        const doublesEvents = ["Double"];

        // 添加 Individuals 部分
        mergedData.push({
            key: "individuals-header",
            event: "Individuals",
            ageGroup: "",
            time: "",
            athlete: "",
            country: "",
            year: "",
            isHeader: true,
        });

        individualEvents.forEach((event) => {
            if (allRecords[event]) {
                allRecords[event].forEach((record, index) => {
                    mergedData.push({
                        key: `${event}-${index}`,
                        event: index === 0 ? event : "",
                        ageGroup: record.ageGroup || "Overall",
                        time: formatTime(record.bestTime),
                        athlete: record.participantName || "Unknown",
                        country: record.country || "Unknown",
                        year: formatDate(record.created_at || new Date().toISOString()),
                        isHeader: false,
                    });
                });
            }
        });

        // 添加 Doubles 部分
        mergedData.push({
            key: "doubles-header",
            event: "Doubles",
            ageGroup: "",
            time: "",
            athlete: "",
            country: "",
            year: "",
            isHeader: true,
        });

        doublesEvents.forEach((event) => {
            if (allRecords[event]) {
                allRecords[event].forEach((record, index) => {
                    mergedData.push({
                        key: `doubles-cycle-${index}`,
                        event: "Cycle",
                        ageGroup: record.ageGroup || "Overall",
                        time: formatTime(record.bestTime),
                        athlete: record.teamName || "Team",
                        country: record.country || "Unknown",
                        year: formatDate(record.created_at || new Date().toISOString()),
                        isHeader: false,
                    });
                });
            }
        });

        return mergedData;
    };

    const columns = [
        {
            title: "Event",
            dataIndex: "event",
            key: "event",
            width: 150,
            render: (text: string, record: RecordRow) =>
                record.isHeader ? (
                    <Text style={{fontSize: "16px", color: "#1890ff", fontWeight: "bold"}}>{text}</Text>
                ) : (
                    <Text>{text}</Text>
                ),
        },
        {
            title: "Age Group",
            dataIndex: "ageGroup",
            key: "ageGroup",
            width: 100,
            render: (text: string, record: RecordRow) => (record.isHeader ? "" : <Text>{text}</Text>),
        },
        {
            title: "Time",
            dataIndex: "time",
            key: "time",
            width: 120,
            render: (text: string, record: RecordRow) => {
                if (record.isHeader) return "";
                return (
                    <div
                        style={{
                            borderLeft: "3px solid #52c41a",
                            paddingLeft: "8px",
                            fontWeight: "bold",
                            color: "#1890ff",
                            textDecoration: "underline",
                            cursor: "pointer",
                        }}
                    >
                        {text}
                    </div>
                );
            },
        },
        {
            title: "Athlete",
            dataIndex: "athlete",
            key: "athlete",
            width: 300,
            render: (text: string, record: RecordRow) => {
                if (record.isHeader) return "";
                return (
                    <div>
                        <Text
                            style={{
                                color: "#1890ff",
                                textDecoration: "underline",
                                cursor: "pointer",
                            }}
                        >
                            {text}
                        </Text>
                        <div style={{display: "flex", alignItems: "center", gap: "8px", marginTop: "4px"}}>
                            <span>{getCountryFlag(record.country)}</span>
                            <Text style={{color: "#666", fontSize: "12px"}}>{record.country}</Text>
                        </div>
                    </div>
                );
            },
        },
        {
            title: "Year",
            dataIndex: "year",
            key: "year",
            width: 120,
            render: (text: string, record: RecordRow) => (record.isHeader ? "" : <Text>{text}</Text>),
        },
    ];

    if (loading) {
        return (
            <div style={{textAlign: "center", padding: "40px"}}>
                <Spin size={40} />
                <div style={{marginTop: 16}}>Loading world records...</div>
            </div>
        );
    }

    const dataSource = createMergedDataSource();

    return (
        <div style={{backgroundColor: "#f5f5f5", padding: "24px", borderRadius: "8px"}}>
            <style>{tableStyles}</style>
            <Title heading={2} style={{marginBottom: "24px", textAlign: "center"}}>
                🏆 Sport Stacking Records
            </Title>

            <Card>
                <div
                    style={{
                        backgroundColor: "#52c41a",
                        color: "white",
                        padding: "12px 16px",
                        marginBottom: "16px",
                        borderRadius: "4px",
                    }}
                >
                    <Text style={{color: "white", fontWeight: "bold"}}>All Divisions</Text>
                </div>

                {dataSource.length > 0 ? (
                    <Table
                        columns={columns}
                        data={dataSource}
                        pagination={false}
                        size="small"
                        style={{backgroundColor: "white"}}
                        rowClassName={(record) => (record.isHeader ? "header-row" : "")}
                    />
                ) : (
                    <Empty description="No participants found in database" />
                )}
            </Card>
        </div>
    );
};

export default WorldRecordsTable;
