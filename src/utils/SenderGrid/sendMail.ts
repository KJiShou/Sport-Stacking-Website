import {auth} from "../../services/firebase/config";

const DEFAULT_ENDPOINT = "https://sendemail-jzbhzqtcdq-uc.a.run.app";

const getEndpoint = (): string => {
    const override = import.meta.env.VITE_SEND_EMAIL_ENDPOINT?.trim();
    if (override && override.length > 0) {
        return override;
    }
    return DEFAULT_ENDPOINT;
};

interface SendEmailPayload {
    success?: boolean;
    error?: string;
}

const parseResponse = async (response: Response): Promise<SendEmailPayload | string> => {
    const text = await response.text();
    if (!text) {
        return {};
    }

    try {
        const parsed = JSON.parse(text);
        if (
            typeof parsed === "object" &&
            (parsed.success === undefined || typeof parsed.success === "boolean") &&
            (parsed.error === undefined || typeof parsed.error === "string")
        ) {
            return parsed as SendEmailPayload;
        }
        console.warn("sendProtectedEmail received invalid payload structure", parsed);
        return text;
    } catch (error) {
        console.warn("sendProtectedEmail received non-JSON response", error);
        return text;
    }
};

export async function sendProtectedEmail(gmail: string, tournamentId: string, teamId: string, memberId: string): Promise<void> {
    if (!gmail) {
        console.warn("sendProtectedEmail skipped: missing recipient email");
        return;
    }

    if (import.meta.env.DEV && !import.meta.env.VITE_SEND_EMAIL_ENDPOINT) {
        console.info("Skipping protected email in development mode", {gmail, tournamentId, teamId, memberId});
        return;
    }

    const token = await auth.currentUser?.getIdToken(true);
    if (!token) {
        throw new Error("User is not authenticated. Unable to send verification email.");
    }

    const endpoint = getEndpoint();
    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            to: gmail,
            tournamentId,
            teamId,
            memberId,
        }),
    });

    const parsed = await parseResponse(response);

    if (!response.ok) {
        const details = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        throw new Error(`Request failed: ${response.status} - ${details}`);
    }

    if (typeof parsed !== "string" && parsed?.error) {
        throw new Error(parsed.error);
    }
}
