import {useAuthContext} from "@/context/AuthContext";
import type {VerificationRequest} from "@/schema";
import {
    rejectTeamInvitation,
    subscribePendingVerificationRequestsForGlobalIds,
} from "@/services/firebase/verificationRequestService";
import {MEMBER_NOT_REGISTERED_CODE, VerificationError, verifyTeamMembership} from "@/services/firebase/verificationService";
import {Button, Card, Message, Result, Spin, Typography} from "@arco-design/web-react";
import dayjs from "dayjs";
import {useEffect, useMemo, useState} from "react";
import {useNavigate} from "react-router-dom";

const {Title, Paragraph, Text} = Typography;

export default function VerificationRequestsPage() {
    const {firebaseUser, profiles} = useAuthContext();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [verifyingRequestId, setVerifyingRequestId] = useState<string | null>(null);
    const [rejectingRequestId, setRejectingRequestId] = useState<string | null>(null);
    const [requests, setRequests] = useState<VerificationRequest[]>([]);
    const ownedProfiles = useMemo(
        () => profiles.filter((profile) => typeof profile.global_id === "string" && profile.global_id.trim().length > 0),
        [profiles],
    );
    const ownedGlobalIds = useMemo(() => ownedProfiles.map((profile) => profile.global_id ?? ""), [ownedProfiles]);
    const profileByGlobalId = useMemo(
        () => new Map(ownedProfiles.map((profile) => [profile.global_id ?? "", profile])),
        [ownedProfiles],
    );
    const registeredTournamentKeys = useMemo(
        () =>
            new Set(
                ownedProfiles.flatMap((profile) =>
                    (profile.registration_records ?? []).map((record) => `${profile.global_id ?? ""}:${record.tournament_id}`),
                ),
            ),
        [ownedProfiles],
    );

    useEffect(() => {
        setLoading(true);
        const unsubscribe = subscribePendingVerificationRequestsForGlobalIds(ownedGlobalIds, (pending) => {
            setRequests(pending);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [ownedGlobalIds]);

    if (!firebaseUser) {
        return <Result status="403" title="Sign In Required" subTitle="Please sign in to see your verification requests." />;
    }

    const handleVerify = async (request: VerificationRequest, isRegisteredForTournament: boolean) => {
        if (!isRegisteredForTournament) {
            Message.error("Register this tournament first before verification.");
            return;
        }

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
            if (error instanceof VerificationError && error.code === MEMBER_NOT_REGISTERED_CODE) {
                Message.error("Register this tournament first before verification.");
            } else {
                Message.error(error instanceof Error ? error.message : "Failed to verify request.");
            }
        } finally {
            setVerifyingRequestId(null);
        }
    };

    const handleRejectRequest = async (request: VerificationRequest) => {
        setRejectingRequestId(request.id);
        try {
            await rejectTeamInvitation(request.id);
            setRequests((prev) => prev.filter((item) => item.id !== request.id));
            Message.success("Invitation rejected. You are available to join another team.");
        } catch (error) {
            console.error("Failed to reject verification request:", error);
            Message.error(error instanceof Error ? error.message : "Failed to reject invitation.");
        } finally {
            setRejectingRequestId(null);
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
                                        : (request.created_at?.toDate?.() ?? null);
                                const targetProfile = profileByGlobalId.get(request.target_global_id);
                                const targetProfileLabel = targetProfile
                                    ? `${targetProfile.global_id} - ${targetProfile.name}`
                                    : request.target_global_id || request.member_id;
                                const isRegisteredForTournament = registeredTournamentKeys.has(
                                    `${request.target_global_id}:${request.tournament_id}`,
                                );
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
                                                <strong>For profile:</strong> {targetProfileLabel}
                                            </Paragraph>
                                            <Paragraph>
                                                <strong>Member ID:</strong> {request.member_id}
                                            </Paragraph>
                                            <Text type="secondary">
                                                Requested: {createdAt ? dayjs(createdAt).format("YYYY-MM-DD HH:mm") : "-"}
                                            </Text>
                                            {!isRegisteredForTournament ? (
                                                <Text type="warning">Register this tournament first before verification.</Text>
                                            ) : null}
                                            <div className="mt-2">
                                                <Button
                                                    type="primary"
                                                    disabled={!isRegisteredForTournament}
                                                    loading={verifyingRequestId === request.id}
                                                    onClick={() => {
                                                        void handleVerify(request, isRegisteredForTournament);
                                                    }}
                                                >
                                                    Verify Now
                                                </Button>
                                                {!isRegisteredForTournament ? (
                                                    <Button
                                                        className="ml-2"
                                                        type="outline"
                                                        onClick={() => navigate(`/tournaments/${request.tournament_id}/register`)}
                                                    >
                                                        Register
                                                    </Button>
                                                ) : null}
                                                <Button
                                                    className="ml-2"
                                                    type="outline"
                                                    status="danger"
                                                    loading={rejectingRequestId === request.id}
                                                    onClick={() => {
                                                        void handleRejectRequest(request);
                                                    }}
                                                >
                                                    Reject Invitation
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
