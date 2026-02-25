import {auth} from "./config";

const DEFAULT_VERIFY_ENDPOINT = "https://updateverification-jzbhzqtcdq-uc.a.run.app";
export const MEMBER_NOT_REGISTERED_CODE = "MEMBER_NOT_REGISTERED";

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

type VerificationErrorResponse = {
    error?: unknown;
    code?: unknown;
};

export class VerificationError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "VerificationError";
        this.status = status;
        this.code = code;
    }
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

    const result = (await response.json().catch(() => ({}))) as VerificationErrorResponse;
    if (!response.ok) {
        const errorMessage = typeof result?.error === "string" ? result.error : "Verification failed.";
        const errorCode = typeof result?.code === "string" ? result.code : undefined;
        throw new VerificationError(errorMessage, response.status, errorCode);
    }
}
