export type VerificationRequestGuardData = {
    tournament_id?: unknown;
    team_id?: unknown;
    member_id?: unknown;
    target_global_id?: unknown;
    registration_id?: unknown;
    status?: unknown;
};

export type VerificationRequestSnapshotLike = {
    exists: boolean;
    data: () => VerificationRequestGuardData | undefined;
};

export type VerificationRequestGuardResult = {
    alreadyVerified: boolean;
    data: VerificationRequestGuardData;
};

export type VerificationRequestGuardErrorCode =
    | "VERIFICATION_REQUEST_NOT_FOUND"
    | "VERIFICATION_REQUEST_MISMATCH"
    | "VERIFICATION_REQUEST_NOT_PENDING";

export class VerificationRequestGuardError extends Error {
    readonly code: VerificationRequestGuardErrorCode;
    readonly httpStatus: 404 | 409;

    constructor(code: VerificationRequestGuardErrorCode, message: string, httpStatus: 404 | 409) {
        super(message);
        this.name = "VerificationRequestGuardError";
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

export const guardVerificationRequest = (
    snapshot: VerificationRequestSnapshotLike,
    expected: {tournamentId: string; teamId: string; memberId: string},
): VerificationRequestGuardResult => {
    if (!snapshot.exists) {
        throw new VerificationRequestGuardError("VERIFICATION_REQUEST_NOT_FOUND", "Verification request not found.", 404);
    }

    const data = snapshot.data() ?? {};
    const isMatchingRequest =
        data.tournament_id === expected.tournamentId &&
        data.team_id === expected.teamId &&
        data.member_id === expected.memberId &&
        data.target_global_id === expected.memberId;
    if (!isMatchingRequest) {
        throw new VerificationRequestGuardError(
            "VERIFICATION_REQUEST_MISMATCH",
            "Verification request details do not match.",
            409,
        );
    }

    if (data.status === "verified") {
        return {alreadyVerified: true, data};
    }

    if (data.status !== "pending") {
        throw new VerificationRequestGuardError("VERIFICATION_REQUEST_NOT_PENDING", "This invitation is no longer pending.", 409);
    }

    return {alreadyVerified: false, data};
};
