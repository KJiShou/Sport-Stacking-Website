import {auth} from "./config";

const DEFAULT_VERIFY_ENDPOINT = "https://updateverification-jzbhzqtcdq-uc.a.run.app";

const getVerifyEndpoint = (): string => {
    const override = import.meta.env.VITE_UPDATE_VERIFICATION_ENDPOINT?.trim();
    if (override && override.length > 0) {
        return override;
    }
    return DEFAULT_VERIFY_ENDPOINT;
};

export interface VerifyMembershipPayload {
    tournamentId: string;
    teamId: string;
    memberId: string;
    registrationId: string;
}

export async function verifyTeamMembership(payload: VerifyMembershipPayload): Promise<void> {
    const token = await auth.currentUser?.getIdToken();
    if (!token) {
        throw new Error("You must be signed in to verify.");
    }

    const response = await fetch(getVerifyEndpoint(), {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errorMessage = typeof result?.error === "string" ? result.error : "Verification failed.";
        throw new Error(errorMessage);
    }
}
