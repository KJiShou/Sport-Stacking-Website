import type {Team} from "@/schema";
import {getUserByGlobalId} from "@/services/firebase/authService";
import {db} from "@/services/firebase/config";
import {fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {verifyTeamMembership} from "@/services/firebase/verificationService";
import {getTeamEventLabels} from "@/utils/tournament/eventUtils";
import {Result, Spin, Typography} from "@arco-design/web-react";
import {doc, getDoc} from "firebase/firestore";
import {useEffect, useState} from "react";

const {Paragraph} = Typography;

type VerificationDetails = {
    eventLabel?: string;
    teamName?: string;
    leaderLabel?: string;
};

export default function VerifyPage() {
    const [status, setStatus] = useState<"loading" | "success" | "error" | "unauthorized" | "missing" | "not_registered">(
        "loading",
    );
    const [errorMessage, setErrorMessage] = useState<string>("");
    const [verificationDetails, setVerificationDetails] = useState<VerificationDetails | null>(null);

    const loadVerificationDetails = async (tournamentId: string, teamId: string) => {
        try {
            const teamSnap = await getDoc(doc(db, "teams", teamId));
            if (!teamSnap.exists()) {
                return;
            }

            const teamData = teamSnap.data() as Team;
            const tournamentEvents = await fetchTournamentEvents(tournamentId);
            const eventLabels = getTeamEventLabels(teamData, tournamentEvents);
            const fallbackEventLabel = Array.isArray(teamData.event)
                ? teamData.event.filter(Boolean).join(", ")
                : typeof teamData.event === "string"
                  ? teamData.event
                  : "";
            const fallbackEventId = typeof teamData.event_id === "string" ? teamData.event_id : "";
            const eventLabel = eventLabels.length > 0 ? eventLabels.join(", ") : fallbackEventLabel || fallbackEventId;

            const leaderId = teamData.leader_id ?? "";
            const leaderUser = leaderId ? await getUserByGlobalId(leaderId) : undefined;
            const leaderLabel = leaderUser?.name ? `${leaderUser.name} (${leaderId})` : leaderId;

            setVerificationDetails({
                eventLabel: eventLabel || undefined,
                teamName: teamData.name || undefined,
                leaderLabel: leaderLabel || undefined,
            });
        } catch (error) {
            console.warn("Unable to load verification details", error);
        }
    };

    const renderVerificationDetails = () => {
        if (!verificationDetails) {
            return null;
        }

        return (
            <div style={{marginTop: "1rem"}}>
                {verificationDetails.eventLabel ? (
                    <Paragraph>
                        <strong>Event:</strong> {verificationDetails.eventLabel}
                    </Paragraph>
                ) : null}
                {verificationDetails.teamName ? (
                    <Paragraph>
                        <strong>Team:</strong> {verificationDetails.teamName}
                    </Paragraph>
                ) : null}
                {verificationDetails.leaderLabel ? (
                    <Paragraph>
                        <strong>Invited by:</strong> {verificationDetails.leaderLabel}
                    </Paragraph>
                ) : null}
            </div>
        );
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tournamentId = params.get("tournamentId");
        const teamId = params.get("teamId");
        const memberId = params.get("memberId");
        const registrationId = params.get("registrationId");

        const update = async () => {
            if (!tournamentId || !teamId || !memberId || !registrationId) {
                setStatus("missing");
                return;
            }

            void loadVerificationDetails(tournamentId, teamId);

            const user = await getUserByGlobalId(memberId);

            if (!user) {
                setStatus("error");
                setErrorMessage("User not found.");
                return;
            }

            const registrationRecord = user.registration_records?.find((rec) => rec.tournament_id === tournamentId);

            if (!registrationRecord) {
                setStatus("not_registered");
                return;
            }

            try {
                await verifyTeamMembership({
                        tournamentId,
                        teamId,
                        memberId,
                        registrationId,
                });
                setStatus("success");
            } catch (err) {
                console.error("Verification request failed:", err);
                if (err instanceof Error && err.message.includes("signed in")) {
                    setStatus("unauthorized");
                    return;
                }
                setStatus("error");
                setErrorMessage(err instanceof Error ? err.message : "Network or server error.");
            }
        };

        update();
    }, []);

    if (status === "loading") {
        const loadingTip = verificationDetails?.eventLabel
            ? `Verifying your participation in ${verificationDetails.eventLabel}...`
            : "Verifying your participation...";
        return (
            <div style={{padding: "4rem", textAlign: "center"}}>
                <Spin size={32} tip={loadingTip} />
                {renderVerificationDetails()}
            </div>
        );
    }

    if (status === "success") {
        return (
            <Result
                status="success"
                title="Verification Successful!"
                subTitle={
                    <div>
                        <Paragraph>Thank you for confirming your participation.</Paragraph>
                        {renderVerificationDetails()}
                    </div>
                }
            />
        );
    }

    if (status === "unauthorized") {
        return (
            <Result
                status="error"
                title="Unauthorized"
                subTitle={
                    <div>
                        <Paragraph>You must be signed in to verify.</Paragraph>
                        {renderVerificationDetails()}
                    </div>
                }
            />
        );
    }

    if (status === "missing") {
        return (
            <Result
                status="error"
                title="Invalid Link"
                subTitle={
                    <div>
                        <Paragraph>Verification information is missing from the URL.</Paragraph>
                        {renderVerificationDetails()}
                    </div>
                }
            />
        );
    }

    if (status === "not_registered") {
        return (
            <Result
                status="error"
                title="Not Registered"
                subTitle={
                    <div>
                        <Paragraph>You have not registered for this tournament, so you cannot be verified.</Paragraph>
                        {renderVerificationDetails()}
                    </div>
                }
            />
        );
    }

    return (
        <Result
            status="error"
            title="Verification Failed"
            subTitle={
                <div>
                    <Paragraph>{errorMessage || "Something went wrong."}</Paragraph>
                    {renderVerificationDetails()}
                </div>
            }
        />
    );
}
