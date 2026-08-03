import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {describe, it} from "node:test";
import {getApps, initializeApp} from "firebase-admin/app";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {
    buildAuditDiff,
    buildAuditRecord,
    normalizeOperationMeta,
    resolveActorContext,
    safeAuditValueForTests,
    sanitizeClientError,
    sanitizeClientStack,
    shouldAuditFirestoreUserWrite,
} from "../observability.js";

describe("observability helpers", () => {
    if (!getApps().length) initializeApp();
    const db = getFirestore();

    it("only includes changed allow-listed fields", () => {
        const diff = buildAuditDiff(
            {status: "submitted", best_time: 2.3, participant_name: "hidden"},
            {status: "verified", best_time: 2.3, participant_name: "changed"},
            ["status", "best_time"],
        );
        assert.deepEqual(diff.changedFields, ["status"]);
        assert.deepEqual(diff.before, {status: "submitted"});
        assert.deepEqual(diff.after, {status: "verified"});
    });

    it("redacts sensitive nested keys and timestamps", () => {
        const value = safeAuditValueForTests({
            global_id: "MY0001",
            email: "person@example.com",
            nested: {phone_number: "012", verified: true},
            created_at: Timestamp.fromMillis(1_700_000_000_000),
        });
        assert.deepEqual(value, {
            global_id: "MY0001",
            nested: {verified: true},
            created_at: "2023-11-14T22:13:20.000Z",
        });
    });

    it("normalizes malformed operation metadata to safe defaults", () => {
        const result = normalizeOperationMeta({
            operationId: "x".repeat(200),
            activeProfileGlobalId: " MY0001 ",
            release: " web-1 ",
        });
        assert.equal(result.operationId.length, 36);
        assert.equal(result.activeProfileGlobalId, "MY0001");
        assert.equal(result.release, "web-1");
    });

    it("sets audit expiry to exactly 365 days and sanitizes explicit snapshots", () => {
        const now = Timestamp.fromMillis(0);
        const record = buildAuditRecord(
            {
                actorUid: "uid-1",
                actorGlobalId: "MY0001",
                action: "profile.update",
                status: "success",
                entityType: "user-profile",
                entityId: "profile-1",
                before: {status: "pending", email: "hidden@example.com"},
                after: {status: "claimed", errorName: "ValidationError"},
                source: "callable",
            },
            now,
        );
        assert.equal((record.expireAt as Timestamp).toMillis(), 365 * 24 * 60 * 60 * 1_000);
        assert.deepEqual(record.before, {status: "pending"});
        assert.deepEqual(record.after, {status: "claimed", errorName: "ValidationError"});
    });

    it("resolves only active profiles owned by the UID and honors an explicit profile", async () => {
        const suffix = randomUUID().replace(/-/g, "");
        const uid = `observability-owner-${suffix}`;
        await Promise.all([
            db
                .collection("users")
                .doc(`active-${suffix}`)
                .set({
                    global_id: "ACTIVE-1",
                    owner_uids: [uid],
                    account_status: "claimed",
                    roles: {edit_tournament: false, record_tournament: false, modify_admin: false, verify_record: false},
                }),
            db
                .collection("users")
                .doc(`admin-${suffix}`)
                .set({
                    global_id: "ACTIVE-2",
                    owner_uids: [uid],
                    account_status: "claimed",
                    roles: {edit_tournament: true, record_tournament: false, modify_admin: false, verify_record: false},
                }),
            db
                .collection("users")
                .doc(`disabled-${suffix}`)
                .set({
                    global_id: "DISABLED",
                    owner_uids: [uid],
                    account_status: "disabled",
                }),
            db
                .collection("users")
                .doc(`foreign-${suffix}`)
                .set({
                    global_id: "FOREIGN",
                    owner_uids: [`other-${suffix}`],
                    account_status: "claimed",
                }),
        ]);

        const preferred = await resolveActorContext(db, uid, "ACTIVE-1");
        assert.equal(preferred.actorUid, uid);
        assert.equal(preferred.actorGlobalId, "ACTIVE-1");
        assert.deepEqual(preferred.actorGlobalIds?.sort(), ["ACTIVE-1", "ACTIVE-2"]);

        const relevant = await resolveActorContext(db, uid);
        assert.equal(relevant.actorGlobalId, "ACTIVE-2");
        assert.equal(relevant.actorGlobalIds, undefined);
    });

    it("keeps client error payloads within the hard limits", () => {
        assert.ok(sanitizeClientError("x".repeat(2_000)).length <= 1_024);
        assert.ok(sanitizeClientStack("x".repeat(12_000)).length <= 8_192);
        const structuredStack = safeAuditValueForTests({stack: "x".repeat(9_000)}) as {stack: string};
        assert.ok(structuredStack.stack.length <= 8_192);
        assert.equal(
            sanitizeClientError("failed for jane@example.com token=secret"),
            "failed for [redacted-email] token=[redacted]",
        );
    });

    it("audits only authenticated unknown principals", () => {
        for (const authType of ["service_account", "api_key", "system", "unauthenticated"]) {
            assert.equal(shouldAuditFirestoreUserWrite(authType, "uid-1"), false);
        }
        assert.equal(shouldAuditFirestoreUserWrite("unknown"), false);
        assert.equal(shouldAuditFirestoreUserWrite("unknown", ""), false);
        assert.equal(shouldAuditFirestoreUserWrite("unknown", "  "), false);
        assert.equal(shouldAuditFirestoreUserWrite("unknown", "uid-1"), true);
    });
});
