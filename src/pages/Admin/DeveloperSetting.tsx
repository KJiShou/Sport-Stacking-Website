import {useAuthContext} from "@/context/AuthContext";
import {recalculateAllAthletesBestPerformanceAndTournamentHistory} from "@/services/firebase/developerService";
import {Button, Descriptions, Message, Modal, Typography} from "@arco-design/web-react";
import {useState} from "react";

const {Title, Paragraph} = Typography;

export default function DeveloperSettingPage() {
    const {user} = useAuthContext();
    const isDeveloper = user?.global_id === "00001";
    const [loading, setLoading] = useState(false);

    const handleRecalculate = () => {
        Modal.confirm({
            title: "Run Global Recalculation?",
            content:
                "This will recalculate all athletes' best performance and tournament history rankings across all tournaments.",
            okText: "Run",
            cancelText: "Cancel",
            onOk: async () => {
                setLoading(true);
                try {
                    const summary = await recalculateAllAthletesBestPerformanceAndTournamentHistory();
                    Message.success(
                        `Done: ${summary.athletesProcessed} athletes, ${summary.tournamentsProcessed} tournaments, ${summary.rankingJobsSucceeded}/${summary.rankingJobsAttempted} ranking jobs.`,
                    );
                    if (summary.rankingJobsFailed > 0) {
                        console.warn("Failed ranking jobs", summary.failedRankingJobs);
                        Message.warning(`Some jobs failed (${summary.rankingJobsFailed}). Check console for details.`);
                    }
                } catch (error) {
                    console.error("Failed to run global recalculation:", error);
                    Message.error("Failed to run global recalculation.");
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    if (!isDeveloper) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <Title heading={3}>Access Denied</Title>
                    <Paragraph>This page is restricted to developer account only.</Paragraph>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <div className="bg-white flex flex-col w-full h-fit gap-6 p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div>
                    <Title heading={2}>Developer Setting</Title>
                    <Paragraph type="secondary">
                        Maintenance tools for global data consistency. Use with caution.
                    </Paragraph>
                </div>

                <Descriptions
                    column={1}
                    data={[
                        {
                            label: "Action",
                            value: "Recalculate all athletes best performance and tournament history",
                        },
                        {
                            label: "Scope",
                            value: "All users and all tournaments",
                        },
                    ]}
                />

                <div>
                    <Button type="primary" status="warning" loading={loading} onClick={handleRecalculate}>
                        Recalculate All Athletes Data
                    </Button>
                </div>
            </div>
        </div>
    );
}
