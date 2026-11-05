import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, describe, it} from "node:test";
import {getApps, initializeApp} from "firebase-admin/app";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {runRegistrationPhoneRepair} from "../registrationPhoneRepair.js";
import {parsePhoneRepairArgs} from "../scripts/repairRegistrationPhones.js";

const db = getFirestore(getApps()[0] ?? initializeApp({projectId: "sport-stacking-website-test"}));
const tournamentId = `phone-repair-${randomUUID()}`;
const repairId = tournamentId;
const options = {tournamentId, repairId, apply: false};
const trackedUsers: string[] = [];
const trackedRegistrations: string[] = [];
const seed = async (
    suffix: string,
    registration = {},
    profile: Record<string, unknown> | null = {phone_number: " 0123456789 "},
) => {
    const id = `${tournamentId}-${suffix}`;
    const user = db.collection("users").doc(id);
    trackedUsers.push(id);
    trackedRegistrations.push(id);
    if (profile) await user.set({global_id: id, ...profile});
    const ref = db.collection("registrations").doc(id);
    await ref.set({
        tournament_id: tournamentId,
        profile_id: id,
        user_id: id,
        user_global_id: id,
        registration_source: "admin_import",
        registration_status: "approved",
        phone_number: "",
        updated_at: Timestamp.fromMillis(1000),
        ...registration,
    });
    return ref;
};

describe("registration phone repair", () => {
    after(async () => {
        const batch = db.batch();
        for (const id of trackedUsers) batch.delete(db.collection("users").doc(id));
        for (const id of trackedRegistrations) batch.delete(db.collection("registrations").doc(id));
        const manifest = db.collection("repair_manifests").doc(repairId);
        for (const entry of (await manifest.collection("entries").get()).docs) batch.delete(entry.ref);
        batch.delete(manifest);
        for (const audit of (await db.collection("audit_logs").where("operationId", "==", repairId).get()).docs)
            batch.delete(audit.ref);
        await batch.commit();
    });

    it("requires explicit production scope and defaults to a dry run", () => {
        assert.throws(() => parsePhoneRepairArgs([]));
        assert.throws(() => parsePhoneRepairArgs(["--database", "develop2", "--tournament", tournamentId]));
        assert.throws(() => parsePhoneRepairArgs(["--database", "(default)", "--tournament", tournamentId]));
        const parsed = parsePhoneRepairArgs(["--database", "(default)", "--tournament", "qzhR8w2Zs7MNUtlycL9N"]);
        assert.equal(parsed.apply, false);
        assert.equal(parsed.restore, false);
        assert.throws(() => parsePhoneRepairArgs(["--repair-id", "--apply"]));
    });

    it("previews without writes, preserves contacts and rejects ambiguous identities", async () => {
        const good = await seed("good");
        const whitespace = await seed("whitespace", {phone_number: "  "});
        const fallback = await seed("fallback", {user_id: "missing-user", profile_id: "missing-user"});
        const missing = await seed("missing", {}, null);
        const empty = await seed("empty", {}, {phone_number: " "});
        const existing = await seed("existing", {phone_number: "0999999999"});
        const conflict = await seed("conflict", {user_id: "different-user"});
        const globalConflict = await seed("global-conflict", {user_global_id: `${tournamentId}-good`});
        const ambiguous = await seed("ambiguous");
        const duplicateId = `${tournamentId}-duplicate`;
        trackedUsers.push(duplicateId);
        await db.collection("users").doc(duplicateId).set({global_id: ambiguous.id, phone_number: "012"});
        const pending = await seed("pending", {registration_status: "pending"});
        const member = await seed("member", {registration_source: "member"});
        const other = await seed("other", {tournament_id: "another-tournament"});
        const before = (await good.get()).data();
        const report = await runRegistrationPhoneRepair(db, options);
        assert.deepEqual(report.records.would_update?.sort(), [good.id, whitespace.id, fallback.id].sort());
        assert.deepEqual(report.records.missing_profile, [missing.id]);
        assert.deepEqual(report.records.profile_without_phone, [empty.id]);
        assert.deepEqual(report.records.already_has_phone, [existing.id]);
        assert.deepEqual(report.records.identity_conflict?.sort(), [conflict.id, globalConflict.id].sort());
        assert.deepEqual(report.records.ambiguous_profile, [ambiguous.id]);
        assert.deepEqual(report.records.out_of_scope?.sort(), [pending.id, member.id].sort());
        assert.equal(Object.values(report.records).flat().includes(other.id), false);
        assert.deepEqual((await good.get()).data(), before);
        assert.equal((await db.collection("repair_manifests").doc(repairId).get()).exists, false);
        // An operator edits the contact between preview and apply.
        await whitespace.update({phone_number: "0111111111"});
        const applied = await Promise.all([
            runRegistrationPhoneRepair(db, {...options, apply: true}),
            runRegistrationPhoneRepair(db, {...options, apply: true}),
        ]);
        assert.deepEqual(applied.flatMap((report) => report.records.updated ?? []).sort(), [good.id, fallback.id].sort());
        assert.equal((await whitespace.get()).data()?.phone_number, "0111111111");
        assert.equal((await good.get()).data()?.phone_number, "0123456789");
        const again = await runRegistrationPhoneRepair(db, {...options, apply: true});
        assert.equal(again.records.updated, undefined);
        const entry = await db.collection("repair_manifests").doc(repairId).collection("entries").doc(good.id).get();
        assert.deepEqual(entry.data()?.before, before);
        assert.equal(entry.data()?.after.phone_number, "0123456789");
        assert.equal((await db.collection("audit_logs").where("operationId", "==", repairId).get()).size, 2);
        // Restoration cannot clobber any subsequent edit, even on another field.
        await fallback.update({organizer: "Edited after repair"});
        const preview = await runRegistrationPhoneRepair(db, {...options, restore: true});
        assert.deepEqual(preview.records.would_restore, [good.id]);
        assert.deepEqual(preview.records.changed_since_repair, [fallback.id]);
        assert.equal((await good.get()).data()?.phone_number, "0123456789");
        const restored = await runRegistrationPhoneRepair(db, {...options, apply: true, restore: true});
        assert.deepEqual(restored.records.restored, [good.id]);
        assert.deepEqual((await good.get()).data(), before);
        const restoreAgain = await runRegistrationPhoneRepair(db, {...options, apply: true, restore: true});
        assert.deepEqual(restoreAgain.records.already_restored, [good.id]);
    });
});
