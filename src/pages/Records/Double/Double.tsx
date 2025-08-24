import {Card, Space, Typography} from "@arco-design/web-react";
import type React from "react";
import RecordRankingTable from "../../../components/Records/RecordRankingTable";
import WorldRecordsOverview from "../../../components/Records/WorldRecordsOverview";

const {Title, Paragraph} = Typography;

const Page_Double: React.FC = () => {
    return (
        <div style={{padding: "24px"}}>
            <div style={{marginBottom: "32px"}}>
                <Title>🏆 Double 记录排名</Title>
                <Paragraph>
                    查看 Double 项目的世界记录和排名情况。可以按轮次（预赛/决赛）和级别（初级/中级/高级）筛选结果。
                </Paragraph>
            </div>

            <Space direction="vertical" size="large" style={{width: "100%"}}>
                <WorldRecordsOverview event="Double" />

                <RecordRankingTable event="Double" title="Double 详细排名" />
            </Space>
        </div>
    );
};

export default Page_Double;
