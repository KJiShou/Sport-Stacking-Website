import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, before, beforeEach, describe, it} from "node:test";
import {getApps, initializeApp} from "firebase-admin/app";
import {type DocumentData, Timestamp, getFirestore} from "firebase-admin/firestore";
import firebaseFunctionsTest from "firebase-functions-test";
import {type ImportJournalEntry, stableChecksum} from "../importIdempotency.js";
import {previewTournamentImportRevert, revertTournamentImport} from "../index.js";
import {
    importJournalEntryMatches,
    projectRegistrationTeams,
    syncTournamentRegistrationTeams,
} from "../registrationTeamSnapshots.js";

const tournamentId = `undo-${randomUUID()}`;
const team = (id: string): DocumentData => ({
    id,
    tournament_id: tournamentId,
    name: id,
    leader_id: "leader",
    members: [{global_id: "member", verified: true}],
    looking_for_member: false,
});
const teamA = team("team-a");
const teamB = team("team-b");
const registration: DocumentData = {
    tournament_id: tournamentId,
    user_global_id: "member",
    registration_status: "approved",
    import_batch_id: "original-import",
    updated_at: Timestamp.fromMillis(1000),
};
const entry = (path: string, afterData: DocumentData | null, beforeData: DocumentData | null = null): ImportJournalEntry => ({
    path,
    before: beforeData,
    after: afterData,
    afterChecksum: stableChecksum(afterData),
});
const oldRegistration = {...registration, teams: projectRegistrationTeams(registration, [teamA])};
const registrationEntry = entry("registrations/registration", oldRegistration, {...registration, registration_status: "pending"});
const journal = [registrationEntry, entry("teams/team-a", teamA), entry("teams/team-b", teamB)];
const syncedRegistration = {
    ...oldRegistration,
    teams: projectRegistrationTeams(oldRegistration, [teamA, teamB]),
    updated_at: Timestamp.fromMillis(2000),
};

describe("import undo cache compatibility", () => {
    it("accepts a legacy snapshot captured before automatic team synchronization", () => {
        assert.equal(importJournalEntryMatches(registrationEntry, syncedRegistration, journal, [teamA, teamB]), true);
        assert.equal(
            importJournalEntryMatches(
                registrationEntry,
                {
                    ...oldRegistration,
                    updated_at: Timestamp.now(),
                },
                journal,
                [teamA, teamB],
            ),
            true,
        );
    });

    it("accepts timestamps and team order without ignoring team contents", () => {
        const finalized = entry(registrationEntry.path, syncedRegistration);
        const current = {...syncedRegistration, teams: [...syncedRegistration.teams].reverse(), updated_at: Timestamp.now()};
        assert.equal(importJournalEntryMatches(finalized, current, journal, [teamA, teamB]), true);
        assert.equal(importJournalEntryMatches(finalized, {...current, teams: []}, journal, [teamA, teamB]), false);
    });

    it("accepts a timestamp-only update on a registration with no teams", () => {
        assert.equal(
            importJournalEntryMatches(
                entry("registrations/no-team", registration),
                {
                    ...registration,
                    updated_at: Timestamp.now(),
                },
                [],
                [],
            ),
            true,
        );
    });

    it("blocks manual fields, payment evidence and subsequent imports", () => {
        for (const change of [
            {registration_status: "rejected"},
            {payment_proof_path: "proof/new.png"},
            {payment_proof_url: "https://example.com/proof"},
            {import_batch_id: "newer-import"},
            {user_name: "Edited name"},
        ]) {
            assert.equal(
                importJournalEntryMatches(registrationEntry, {...syncedRegistration, ...change}, journal, [teamA, teamB]),
                false,
            );
        }
    });

    it("blocks new teams and source changes even before the cache catches up", () => {
        for (const source of [
            [teamA, teamB, team("new-team")],
            [teamA, {...teamB, name: "Manual name"}],
            [teamA, {...teamB, members: [{global_id: "another-member", verified: true}]}],
            [teamA],
        ]) {
            assert.equal(importJournalEntryMatches(registrationEntry, syncedRegistration, journal, source), false);
            assert.equal(importJournalEntryMatches(registrationEntry, oldRegistration, journal, source), false);
        }
    });

    it("keeps timestamp checks strict outside registration caches", () => {
        const profile = {name: "Profile", updated_at: Timestamp.fromMillis(1000)};
        assert.equal(
            importJournalEntryMatches(entry("users/profile", profile), {...profile, updated_at: Timestamp.now()}, [], []),
            false,
        );
    });

    it("does not accept edits to an unjournaled source team", () => {
        const old = entry(registrationEntry.path, oldRegistration);
        assert.equal(importJournalEntryMatches(old, {...oldRegistration, updated_at: Timestamp.now()}, [], [teamA]), true);
        assert.equal(importJournalEntryMatches(old, syncedRegistration, [], [teamA, teamB]), false);
        const editedTeam = {...teamA, leader_id: "new-leader"};
        const editedCache = {...oldRegistration, teams: projectRegistrationTeams(oldRegistration, [editedTeam])};
        assert.equal(importJournalEntryMatches(old, editedCache, [], [editedTeam]), false);
    });
});

const database = getFirestore(getApps()[0] ?? initializeApp({projectId: "sport-stacking-website-test"}));
const features = firebaseFunctionsTest({projectId: "sport-stacking-website-test"});
const preview = features.wrap(previewTournamentImportRevert);
const revert = features.wrap(revertTournamentImport);
const adminId = `undo-admin-${randomUUID()}`;
const batchId = `undo-batch-${randomUUID()}`;
const registrationRef = database.collection("registrations").doc(`undo-registration-${randomUUID()}`);
const batchRef = database.collection("import_batches").doc(batchId);
const teamRef = database.collection("teams").doc(`undo-team-${randomUUID()}`);
const importedTeam: DocumentData = {...teamA, id: teamRef.id};
const priorTeam: DocumentData = {...importedTeam, name: "Previous team name"};
const priorRegistration = {...registration, teams: projectRegistrationTeams(registration, [priorTeam])};
const intermediateRegistration = {...priorRegistration, registration_status: "approved"};
const call = (data: Record<string, unknown>) => ({
    data: {tournamentId, importBatchId: batchId, ...data},
    auth: {uid: adminId, token: {} as never, rawToken: ""},
    rawRequest: {} as never,
    acceptsStreaming: false,
});

describe("import undo in Firestore", () => {
    before(async () => {
        await database
            .collection("users")
            .doc(adminId)
            .set({roles: {modify_admin: true}, global_id: adminId});
        await database.collection("tournaments").doc(tournamentId).set({participants: 1});
    });

    beforeEach(async () => {
        const write = database.batch();
        write.set(batchRef, {tournament_id: tournamentId, status: "committed", journal_version: 1, revertible: true});
        write.set(teamRef, importedTeam);
        write.set(registrationRef, intermediateRegistration);
        write.set(
            batchRef.collection("changes").doc("registration"),
            entry(registrationRef.path, intermediateRegistration, priorRegistration),
        );
        write.set(batchRef.collection("changes").doc("team"), entry(teamRef.path, importedTeam, priorTeam));
        await write.commit();
    });

    after(async () => {
        const changes = await batchRef.collection("changes").get();
        const audits = await database.collection("audit_logs").where("tournamentId", "==", tournamentId).get();
        const cleanup = database.batch();
        for (const snapshot of [...changes.docs, ...audits.docs]) cleanup.delete(snapshot.ref);
        for (const ref of [
            batchRef,
            teamRef,
            registrationRef,
            database.doc(`users/${adminId}`),
            database.doc(`tournaments/${tournamentId}`),
        ]) {
            cleanup.delete(ref);
        }
        await cleanup.commit();
        features.cleanup();
    });

    it("finishes synchronization before a journal is captured and repeated synchronization is a no-op", async () => {
        await syncTournamentRegistrationTeams(database, tournamentId);
        const first = await registrationRef.get();
        assert.deepEqual(first.data()?.teams, projectRegistrationTeams(intermediateRegistration, [importedTeam]));
        await syncTournamentRegistrationTeams(database, tournamentId);
        const second = await registrationRef.get();
        assert.ok(first.updateTime?.isEqual(second.updateTime as Timestamp));
        assert.equal(((await preview(call({}))) as {canRevert: boolean}).canRevert, true);
    });

    it("reads current source state after a delayed event and never recreates a deleted team", async () => {
        await teamRef.delete();
        await syncTournamentRegistrationTeams(database, tournamentId, new Set(["member"]));
        assert.deepEqual((await registrationRef.get()).data()?.teams, []);
        await syncTournamentRegistrationTeams(database, tournamentId, new Set(["member"]));
        assert.deepEqual((await registrationRef.get()).data()?.teams, []);
    });

    it("restores legacy imports and rebuilds the cache from restored teams", async () => {
        await syncTournamentRegistrationTeams(database, tournamentId);
        assert.equal(((await preview(call({}))) as {canRevert: boolean}).canRevert, true);
        await revert(call({confirm: true}));
        assert.equal((await batchRef.get()).data()?.status, "reverted");
        assert.deepEqual((await registrationRef.get()).data()?.teams, priorRegistration.teams);
        assert.equal((await teamRef.get()).data()?.name, priorTeam.name);
        await assert.rejects(revert(call({confirm: true})), /already been reverted/);
    });

    it("rechecks changes made after a successful preview and restores nothing", async () => {
        await syncTournamentRegistrationTeams(database, tournamentId);
        assert.equal(((await preview(call({}))) as {canRevert: boolean}).canRevert, true);
        await registrationRef.update({registration_status: "rejected"});
        await assert.rejects(revert(call({confirm: true})), /changed after this import/);
        assert.equal((await teamRef.get()).data()?.name, importedTeam.name);
        assert.equal((await batchRef.get()).data()?.status, "committed");
    });

    it("preserves the payment-evidence blocker for newly created registrations", async () => {
        const paid = {...intermediateRegistration, payment_proof_path: "proof/existing.png"};
        await registrationRef.set(paid);
        await batchRef.collection("changes").doc("registration").set(entry(registrationRef.path, paid));
        const result = (await preview(call({}))) as {canRevert: boolean; blockers: string[]};
        assert.equal(result.canRevert, false);
        assert.ok(result.blockers.some((blocker) => blocker.includes("payment evidence")));
        await assert.rejects(revert(call({confirm: true})), /payment evidence/);
    });

    it("restores more than 500 journal entries in a single atomic transaction", async () => {
        const refs = Array.from({length: 510}, (_, index) => database.collection("undo_test_records").doc(`${batchId}-${index}`));
        try {
            for (let offset = 0; offset < refs.length; offset += 200) {
                const write = database.batch();
                for (const ref of refs.slice(offset, offset + 200)) {
                    const data = {import_batch_id: batchId};
                    write.set(ref, data);
                    write.set(batchRef.collection("changes").doc(ref.id), entry(ref.path, data));
                }
                await write.commit();
            }
            await syncTournamentRegistrationTeams(database, tournamentId);
            const result = (await revert(call({confirm: true}))) as {changes: number};
            assert.equal(result.changes, 512);
            const restored = await database.getAll(...refs);
            assert.ok(restored.every((snapshot) => !snapshot.exists));
            assert.equal((await batchRef.get()).data()?.status, "reverted");
        } finally {
            for (let offset = 0; offset < refs.length; offset += 200) {
                const cleanup = database.batch();
                for (const ref of refs.slice(offset, offset + 200)) {
                    cleanup.delete(ref);
                    cleanup.delete(batchRef.collection("changes").doc(ref.id));
                }
                await cleanup.commit();
            }
        }
    });
});
