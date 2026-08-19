import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {describe, it} from "node:test";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {CLEANUP_TOURNAMENT_ID, cleanupConfirmation, runCleanupTournamentImport} from "../scripts/cleanupTournamentImport.js";
import {runReverseTournamentImportCleanup} from "../scripts/reverseTournamentImportCleanup.js";
import {runValidateTournamentImportCleanup} from "../scripts/validateTournamentImportCleanup.js";

describe("guarded tournament import cleanup", () => {
    it("cleans, validates, detects reverse drift, and reverses without reusing retired IDs", async () => {
        const suffix = randomUUID().replace(/-/g, "");
        const app = getApps()[0] ?? initializeApp({projectId: "sport-stacking-website-test"});
        const database = getFirestore(app, `cleanup-${suffix}`);
        const repairId = `cleanup-test-${suffix}`;
        const batchId = `import-batch-${suffix}`;
        const profileId = `import-profile-${suffix}`;
        const registrationId = `import-registration-${suffix}`;
        const teamId = `import-team-${suffix}`;
        const eventId = `import-event-${suffix}`;
        const globalId = "70001";
        const asOf = "2026-08-20T00:00:00.000Z";
        const setup = database.batch();
        setup.set(database.collection("tournaments").doc(CLEANUP_TOURNAMENT_ID), {
            name: "Cleanup Test",
            participants: 1,
        });
        setup.set(database.collection("events").doc(eventId), {
            id: eventId,
            tournament_id: CLEANUP_TOURNAMENT_ID,
            type: "Individual",
            approved_participants: 1,
        });
        setup.set(database.collection("import_batches").doc(batchId), {
            tournament_id: CLEANUP_TOURNAMENT_ID,
            status: "committed",
        });
        setup.set(database.collection("users").doc(profileId), {
            id: profileId,
            global_id: globalId,
            name: "Cleanup Athlete",
            source: "admin_import",
            account_status: "unclaimed",
            owner_uids: [],
            email: null,
            primary_owner_email: null,
            import_batch_id: batchId,
        });
        setup.set(database.collection("registrations").doc(registrationId), {
            tournament_id: CLEANUP_TOURNAMENT_ID,
            profile_id: profileId,
            user_id: profileId,
            global_id: globalId,
            user_global_id: globalId,
            registration_source: "admin_import",
            import_batch_id: batchId,
            registration_status: "approved",
            events_registered: [eventId],
        });
        setup.set(database.collection("teams").doc(teamId), {
            tournament_id: CLEANUP_TOURNAMENT_ID,
            event_id: eventId,
            leader_id: globalId,
            members: [],
            registration_source: "admin_import",
            import_batch_id: batchId,
        });
        setup.set(database.collection("profile_identity_keys").doc(`identity-${suffix}`), {profile_id: profileId});
        setup.set(database.collection("registration_unique_keys").doc(`registration-${suffix}`), {
            tournament_id: CLEANUP_TOURNAMENT_ID,
            profile_id: profileId,
            registration_id: registrationId,
        });
        setup.set(database.collection("team_import_keys").doc(`team-${suffix}`), {
            tournament_id: CLEANUP_TOURNAMENT_ID,
            team_id: teamId,
        });
        setup.set(database.collection("counters").doc("userCounter"), {count: 70001, retired_count: 0});
        await setup.commit();

        const dryRunArgs = [
            "--database",
            "(default)",
            "--tournament",
            CLEANUP_TOURNAMENT_ID,
            "--repair-id",
            repairId,
            "--as-of",
            asOf,
            "--allow-primary-read-only",
        ];
        await database
            .collection("users")
            .doc(profileId)
            .update({owner_uids: ["claimed-owner"]});
        await database.collection("registrations").doc(registrationId).update({payment_proof_path: "proof.jpg"});
        const blocked = await runCleanupTournamentImport(dryRunArgs, {
            database,
            authUserExists: async () => true,
        });
        const failureCodes = (blocked.blockingFailures as Array<{code: string}>).map((failure) => failure.code);
        assert.ok(failureCodes.includes("PROFILE_NOT_SAFE_TO_DELETE"));
        assert.ok(failureCodes.includes("AUTH_USER_EXISTS"));
        assert.ok(failureCodes.includes("PAYMENT_PROOF_PRESENT"));
        assert.equal(blocked.operationCount, 0);
        await database.collection("users").doc(profileId).update({owner_uids: []});
        await database.collection("registrations").doc(registrationId).update({payment_proof_path: null});

        const dryRun = await runCleanupTournamentImport(dryRunArgs, {
            database,
            authUserExists: async () => false,
        });
        assert.equal((dryRun.blockingFailures as unknown[]).length, 0);
        assert.match(String(dryRun.planChecksum), /^[a-f0-9]{64}$/);
        const committed = await runCleanupTournamentImport(
            [
                ...dryRunArgs.filter((entry) => entry !== "--allow-primary-read-only"),
                "--commit",
                "--allow-primary",
                "--primary-confirm",
                "cleanup-imported-participants-on-default",
                "--confirm",
                cleanupConfirmation("(default)", CLEANUP_TOURNAMENT_ID),
                "--expected-checksum",
                String(dryRun.planChecksum),
            ],
            {database, authUserExists: async () => false, skipMaintenanceCheck: true},
        );
        assert.equal(committed.firebaseWritesPerformed, true);
        assert.equal((await database.collection("users").doc(profileId).get()).exists, false);
        assert.equal((await database.collection("registrations").doc(registrationId).get()).exists, false);
        assert.equal((await database.collection("teams").doc(teamId).get()).exists, false);
        assert.equal((await database.collection("retired_global_ids").doc(globalId).get()).exists, true);

        const validation = await runValidateTournamentImportCleanup(
            [
                "--database",
                "(default)",
                "--tournament",
                CLEANUP_TOURNAMENT_ID,
                "--repair-id",
                repairId,
                "--expect-writes",
                "enabled",
                "--expected-manifest-checksum",
                String(committed.manifestChecksum),
                "--allow-primary-read-only",
            ],
            {database},
        );
        assert.equal(validation.passed, true);

        const reverseDryRunArgs = ["--database", "(default)", "--repair-id", repairId, "--allow-primary-read-only"];
        const reverseDryRun = await runReverseTournamentImportCleanup(reverseDryRunArgs, {database});
        const tournamentAfterCleanup = await database.collection("tournaments").doc(CLEANUP_TOURNAMENT_ID).get();
        await tournamentAfterCleanup.ref.update({participants: 99});
        await assert.rejects(
            () => runReverseTournamentImportCleanup(reverseDryRunArgs, {database}),
            /data drifted|checksum drifted/,
        );
        await tournamentAfterCleanup.ref.set(tournamentAfterCleanup.data() ?? {});

        const reversed = await runReverseTournamentImportCleanup(
            [
                "--database",
                "(default)",
                "--repair-id",
                repairId,
                "--commit",
                "--allow-primary",
                "--primary-confirm",
                "reverse-import-cleanup-on-default",
                "--confirm",
                `reverse-${repairId}`,
                "--expected-manifest-checksum",
                String(reverseDryRun.manifestChecksum),
            ],
            {database, skipMaintenanceCheck: true},
        );
        assert.equal(reversed.firebaseWritesPerformed, true);
        assert.equal((await database.collection("users").doc(profileId).get()).exists, true);
        assert.equal((await database.collection("registrations").doc(registrationId).get()).exists, true);
        assert.equal((await database.collection("teams").doc(teamId).get()).exists, true);
        assert.equal((await database.collection("retired_global_ids").doc(globalId).get()).exists, true);
        assert.equal(Number((await database.collection("counters").doc("userCounter").get()).data()?.count ?? 0), 70001);

        const manifestEntries = await database.collection("repair_manifests").doc(repairId).collection("entries").get();
        const cleanup = database.batch();
        for (const entry of manifestEntries.docs) cleanup.delete(entry.ref);
        for (const collection of [
            "tournaments",
            "events",
            "import_batches",
            "users",
            "registrations",
            "teams",
            "profile_identity_keys",
            "registration_unique_keys",
            "team_import_keys",
            "retired_global_ids",
            "counters",
            "repair_manifests",
        ]) {
            const documents = await database.collection(collection).get();
            for (const document of documents.docs) cleanup.delete(document.ref);
        }
        await cleanup.commit();
    });
});
