import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import {
    type VerificationRequestGuardData,
    VerificationRequestGuardError,
    type VerificationRequestSnapshotLike,
    guardVerificationRequest,
} from "../verificationRequestGuard.js";

const expected = {tournamentId: "tournament-1", teamId: "team-1", memberId: "MEMBER-1"};

const snapshot = (data?: VerificationRequestGuardData): VerificationRequestSnapshotLike => ({
    exists: data !== undefined,
    data: () => data,
});

const assertGuardError = (
    callback: () => unknown,
    code: VerificationRequestGuardError["code"],
    httpStatus: VerificationRequestGuardError["httpStatus"],
): void => {
    assert.throws(callback, (error: unknown) => {
        assert.ok(error instanceof VerificationRequestGuardError);
        assert.equal(error.code, code);
        assert.equal(error.httpStatus, httpStatus);
        return true;
    });
};

describe("verification request guard", () => {
    it("accepts a matching pending request", () => {
        const result = guardVerificationRequest(
            snapshot({
                tournament_id: expected.tournamentId,
                team_id: expected.teamId,
                member_id: expected.memberId,
                target_global_id: expected.memberId,
                registration_id: "leader-registration-id",
                status: "pending",
            }),
            expected,
        );

        assert.equal(result.alreadyVerified, false);
    });

    it("rejects a missing request without manufacturing state", () => {
        assertGuardError(() => guardVerificationRequest(snapshot(), expected), "VERIFICATION_REQUEST_NOT_FOUND", 404);
    });

    it("rejects requests whose relationship fields do not match", () => {
        for (const field of ["tournament_id", "team_id", "member_id", "target_global_id"] as const) {
            assertGuardError(
                () =>
                    guardVerificationRequest(
                        snapshot({
                            tournament_id: expected.tournamentId,
                            team_id: expected.teamId,
                            member_id: expected.memberId,
                            target_global_id: expected.memberId,
                            status: "pending",
                            [field]: "different-value",
                        }),
                        expected,
                    ),
                "VERIFICATION_REQUEST_MISMATCH",
                409,
            );
        }
    });

    it("rejects rejected and expired requests", () => {
        for (const status of ["rejected", "expired"]) {
            assertGuardError(
                () =>
                    guardVerificationRequest(
                        snapshot({
                            tournament_id: expected.tournamentId,
                            team_id: expected.teamId,
                            member_id: expected.memberId,
                            target_global_id: expected.memberId,
                            status,
                        }),
                        expected,
                    ),
                "VERIFICATION_REQUEST_NOT_PENDING",
                409,
            );
        }
    });

    it("treats a matching verified request as an idempotent success", () => {
        const result = guardVerificationRequest(
            snapshot({
                tournament_id: expected.tournamentId,
                team_id: expected.teamId,
                member_id: expected.memberId,
                target_global_id: expected.memberId,
                status: "verified",
            }),
            expected,
        );

        assert.equal(result.alreadyVerified, true);
    });
});
