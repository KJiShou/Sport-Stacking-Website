import type {Team} from "@/schema";
import {db} from "@/services/firebase/config";
import {fetchProfileByGlobalId} from "@/services/firebase/profileService";
import {fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {getTeamEventLabels} from "@/utils/tournament/eventUtils";
import {Result, Spin, Typography} from "@arco-design/web-react";
import {getAuth} from "firebase/auth";
import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
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
            const leaderProfile = leaderId ? await fetchProfileByGlobalId(leaderId) : undefined;
            const leaderLabel = leaderProfile?.name ? `${leaderProfile.name} (${leaderId})` : leaderId;

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

            const auth = getAuth();
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                setStatus("unauthorized");
                return;
            }

            const profile = await fetchProfileByGlobalId(memberId);
            if (!profile) {
                setStatus("error");
                setErrorMessage("Profile not found.");
                return;
            }

            const registrationQuery = query(
                collection(db, "registrations"),
                where("tournament_id", "==", tournamentId),
                where("profile_id", "==", profile.id ?? ""),
            );
            const registrationSnapshot = await getDocs(registrationQuery);
            if (registrationSnapshot.empty) {
                const legacyQuery = query(
                    collection(db, "registrations"),
                    where("tournament_id", "==", tournamentId),
                    where("user_global_id", "==", memberId),
                );
                const legacySnapshot = await getDocs(legacyQuery);
                if (legacySnapshot.empty) {
                    setStatus("not_registered");
                    return;
                }
            }

            try {
                const res = await fetch("https://updateverification-jzbhzqtcdq-uc.a.run.app", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        tournamentId,
                        teamId,
                        memberId,
                        registrationId,
                    }),
                });

                const data = await res.json();
                if (res.ok) {
                    setStatus("success");
                } else {
                    setErrorMessage(data.error || "Unknown error");
                    setStatus("error");
                }
            } catch (err) {
                console.error(err);
                setStatus("error");
                setErrorMessage("Network or server error.");
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
