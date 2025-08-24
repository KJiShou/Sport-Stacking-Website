import {Card, Typography} from "@arco-design/web-react";
import type React from "react";
import WorldRecordsTable from "../../components/Records/WorldRecordsTable";

const {Title, Paragraph} = Typography;

const RecordsIndex: React.FC = () => {
    return (
        <div style={{padding: "24px"}}>
            <div style={{marginBottom: "32px", textAlign: "center"}}>
                <Title>🏆 World Sport Stacking Records</Title>
                <Paragraph style={{fontSize: "16px", color: "#666"}}>
                    View the best world records for each division and event
                </Paragraph>
            </div>

            <WorldRecordsTable />
        </div>
    );
};

export default RecordsIndex;
