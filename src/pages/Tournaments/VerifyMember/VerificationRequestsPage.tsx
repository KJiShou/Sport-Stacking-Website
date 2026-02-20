import {useAuthContext} from "@/context/AuthContext";
import type {VerificationRequest} from "@/schema";
import {
    deleteVerificationRequestForUser,
    fetchPendingVerificationRequests,
} from "@/services/firebase/verificationRequestService";
import {verifyTeamMembership} from "@/services/firebase/verificationService";
import {Button, Card, Message, Result, Spin, Typography} from "@arco-design/web-react";
import dayjs from "dayjs";
import {useEffect, useState} from "react";
import {useNavigate} from "react-router-dom";

const {Title, Paragraph, Text} = Typography;

export default function VerificationRequestsPage() {
    const {firebaseUser, user} = useAuthContext();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [verifyingRequestId, setVerifyingRequestId] = useState<string | null>(null);
    const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);
    const [requests, setRequests] = useState<VerificationRequest[]>([]);

    const loadRequests = async () => {
        if (!user?.global_id) {
            setRequests([]);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const pending = await fetchPendingVerificationRequests(user.global_id);
            setRequests(pending);
        } catch (error) {
            console.error("Failed to load verification requests:", error);
            Message.error("Failed to load verification requests.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadRequests();
    }, [user?.global_id]);

    if (!firebaseUser) {
        return <Result status="403" title="Sign In Required" subTitle="Please sign in to see your verification requests." />;
    }

    const handleVerify = async (request: VerificationRequest) => {
        setVerifyingRequestId(request.id);
        try {
            await verifyTeamMembership({
                tournamentId: request.tournament_id,
                teamId: request.team_id,
                memberId: request.member_id,
                registrationId: request.registration_id,
            });
            Message.success("Verification completed.");
            setRequests((prev) => prev.filter((item) => item.id !== request.id));
        } catch (error) {
            console.error("Failed to verify request:", error);
            Message.error(error instanceof Error ? error.message : "Failed to verify request.");
        } finally {
            setVerifyingRequestId(null);
        }
    };

    const handleDeleteRequest = async (request: VerificationRequest) => {
        if (!user?.global_id) {
            Message.error("You must be signed in.");
            return;
        }

        setDeletingRequestId(request.id);
        try {
            await deleteVerificationRequestForUser(request.id, user.global_id);
            setRequests((prev) => prev.filter((item) => item.id !== request.id));
            Message.success("Verification request removed.");
        } catch (error) {
            console.error("Failed to remove verification request:", error);
            Message.error(error instanceof Error ? error.message : "Failed to remove request.");
        } finally {
            setDeletingRequestId(null);
        }
    };

    return (
        <div className="flex flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 p-4 md:p-6 xl:p-8 shadow-lg md:rounded-lg">
                <div className="flex items-center justify-between">
                    <Title heading={4} style={{marginBottom: 0}}>
                        Verification Requests
                    </Title>
                    <Button type="outline" onClick={() => navigate("/tournaments")}>
                        Back to Tournaments
                    </Button>
                </div>

                <Spin loading={loading}>
                    {requests.length === 0 ? (
                        <Result status="success" title="No Pending Requests" subTitle="You are all caught up." />
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {requests.map((request) => {
                                const createdAt =
                                    request.created_at instanceof Date
                                        ? request.created_at
                                        : request.created_at?.toDate?.() ?? null;
                                return (
                                    <Card key={request.id} title={request.event_label || "Team Verification"}>
                                        <div className="flex flex-col gap-2">
                                            <Paragraph>
                                                <strong>Team:</strong> {request.team_name || "-"}
                                            </Paragraph>
                                            <Paragraph>
                                                <strong>Invited by:</strong> {request.leader_label || "-"}
                                            </Paragraph>
                                            <Paragraph>
                                                <strong>Member ID:</strong> {request.member_id}
                                            </Paragraph>
                                            <Text type="secondary">
                                                Requested: {createdAt ? dayjs(createdAt).format("YYYY-MM-DD HH:mm") : "-"}
                                            </Text>
                                            <div className="mt-2">
                                                <Button
                                                    type="primary"
                                                    loading={verifyingRequestId === request.id}
                                                    onClick={() => {
                                                        void handleVerify(request);
                                                    }}
                                                >
                                                    Verify Now
                                                </Button>
                                                <Button
                                                    className="ml-2"
                                                    type="outline"
                                                    status="danger"
                                                    loading={deletingRequestId === request.id}
                                                    onClick={() => {
                                                        void handleDeleteRequest(request);
                                                    }}
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </Spin>
            </div>
        </div>
    );
}
