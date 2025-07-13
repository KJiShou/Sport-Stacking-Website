import {getUserByGlobalId} from "@/services/firebase/authService";
import {Result, Spin, Typography} from "@arco-design/web-react";
import {getAuth} from "firebase/auth";
import {useEffect, useState} from "react";

const {Title, Paragraph} = Typography;

export default function VerifyPage() {
    const [status, setStatus] = useState<"loading" | "success" | "error" | "unauthorized" | "missing" | "not_registered">(
        "loading",
    );
    const [errorMessage, setErrorMessage] = useState<string>("");

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const tournamentId = params.get("tournamentId");
        const teamId = params.get("teamId");
        const memberId = params.get("memberId");

        const update = async () => {
            if (!tournamentId || !teamId || !memberId) {
                setStatus("missing");
                return;
            }

            const auth = getAuth();
            const token = await auth.currentUser?.getIdToken();
            if (!token) {
                setStatus("unauthorized");
                return;
            }

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
        return (
            <div style={{padding: "4rem", textAlign: "center"}}>
                <Spin size={32} tip="Verifying your participation..." />
            </div>
        );
    }

    if (status === "success") {
        return (
            <Result status="success" title="Verification Successful!" subTitle="Thank you for confirming your participation." />
        );
    }

    if (status === "unauthorized") {
        return <Result status="error" title="Unauthorized" subTitle="You must be signed in to verify." />;
    }

    if (status === "missing") {
        return <Result status="error" title="Invalid Link" subTitle="Verification information is missing from the URL." />;
    }

    if (status === "not_registered") {
        return (
            <Result
                status="error"
                title="Not Registered"
                subTitle="You have not registered for this tournament, so you cannot be verified."
            />
        );
    }

    return <Result status="error" title="Verification Failed" subTitle={errorMessage || "Something went wrong."} />;
}
