import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {getApps, initializeApp} from "firebase-admin/app";
import {type DocumentData, type Firestore, Timestamp, getFirestore} from "firebase-admin/firestore";
import {CLEANUP_TOURNAMENT_ID} from "./cleanupTournamentImport.js";

const canonicalize = (value: unknown): unknown => {
    if (value instanceof Timestamp) return {__timestamp: value.toDate().toISOString()};
    if (value instanceof Date) return {__date: value.toISOString()};
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }
    return value;
};

const checksum = (value: unknown): string =>
    createHash("sha256")
        .update(JSON.stringify(canonicalize(value)))
        .digest("hex");

const argumentValue = (args: readonly string[], name: string): string => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1]?.trim() ?? "") : "";
};

export const runValidateTournamentImportCleanup = async (
    args: readonly string[],
    dependencies: {database?: Firestore} = {},
): Promise<Record<string, unknown>> => {
    const valueFlags = new Set(["--database", "--tournament", "--repair-id", "--expect-writes", "--expected-manifest-checksum"]);
    const booleanFlags = new Set(["--allow-primary-read-only"]);
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
        const entry = args[index];
        if (!entry?.startsWith("--") || (!valueFlags.has(entry) && !booleanFlags.has(entry))) {
            throw new Error(`Unknown validation argument: ${entry ?? ""}`);
        }
        if (seen.has(entry)) throw new Error(`Duplicate validation argument: ${entry}`);
        seen.add(entry);
        if (valueFlags.has(entry)) {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new Error(`${entry} requires a value.`);
            index += 1;
        }
    }
    const databaseId = argumentValue(args, "--database");
    const tournamentId = argumentValue(args, "--tournament");
    const repairId = argumentValue(args, "--repair-id");
    const expectedWrites = argumentValue(args, "--expect-writes") || "disabled";
    const expectedManifestChecksum = argumentValue(args, "--expected-manifest-checksum");
    if (databaseId !== "(default)" || !args.includes("--allow-primary-read-only")) {
        throw new Error("Validation is restricted to explicitly acknowledged production (default) reads.");
    }
    if (tournamentId !== CLEANUP_TOURNAMENT_ID) {
        throw new Error(`Validation is restricted to tournament ${CLEANUP_TOURNAMENT_ID}.`);
    }
    if (!repairId) throw new Error("Validation requires --repair-id.");
    if (!new Set(["enabled", "disabled"]).has(expectedWrites)) {
        throw new Error("--expect-writes must be enabled or disabled.");
    }
    if (expectedManifestChecksum && !/^[a-f0-9]{64}$/.test(expectedManifestChecksum)) {
        throw new Error("--expected-manifest-checksum must be a 64-character SHA-256 value.");
    }

    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "sport-stacking-website";
    const app = getApps()[0] ?? initializeApp({projectId});
    const database = dependencies.database ?? getFirestore(app);
    const manifestRef = database.collection("repair_manifests").doc(repairId);
    const [manifest, entries, tournament, events, registrations, teams, batches, counter, retired, writeControl] =
        await Promise.all([
            manifestRef.get(),
            manifestRef.collection("entries").get(),
            database.collection("tournaments").doc(tournamentId).get(),
            database.collection("events").where("tournament_id", "==", tournamentId).get(),
            database.collection("registrations").where("tournament_id", "==", tournamentId).get(),
            database.collection("teams").where("tournament_id", "==", tournamentId).get(),
            database.collection("import_batches").where("tournament_id", "==", tournamentId).get(),
            database.collection("counters").doc("userCounter").get(),
            database.collection("retired_global_ids").get(),
            database.doc("system_config/write_control").get(),
        ]);

    const normalizedEntries = entries.docs
        .map((entry) => ({
            path: String(entry.data().path ?? ""),
            beforeExists: entry.data().before_exists === true,
            beforeChecksum: String(entry.data().before_checksum ?? ""),
            afterExists: entry.data().after_exists === true,
            afterChecksum: String(entry.data().after_checksum ?? ""),
        }))
        .filter((entry) => entry.path)
        .sort((left, right) => left.path.localeCompare(right.path));
    const manifestChecksum = checksum(normalizedEntries);
    const failures: string[] = [];
    const check = (condition: boolean, message: string): void => {
        if (!condition) failures.push(message);
    };
    check(manifest.data()?.status === "complete", "repair manifest is not complete");
    check(entries.size === Number(manifest.data()?.operation_count ?? -1), "manifest operation count does not match entries");
    check(manifest.data()?.manifest_checksum === manifestChecksum, "recorded manifest checksum does not match entries");
    if (expectedManifestChecksum) check(manifestChecksum === expectedManifestChecksum, "manifest checksum changed");

    for (let offset = 0; offset < normalizedEntries.length; offset += 300) {
        const chunk = normalizedEntries.slice(offset, offset + 300);
        const snapshots = await database.getAll(...chunk.map((entry) => database.doc(entry.path)));
        for (const [index, snapshot] of snapshots.entries()) {
            const expected = chunk[index];
            check(snapshot.exists === expected?.afterExists, `${snapshot.ref.path} existence differs from the manifest`);
            check(
                checksum(snapshot.data() ?? null) === expected?.afterChecksum,
                `${snapshot.ref.path} checksum differs from the manifest`,
            );
        }
    }

    const batchIds = new Set(batches.docs.map((batch) => batch.id));
    const imported = (data: DocumentData): boolean =>
        data.registration_source === "admin_import" || batchIds.has(String(data.import_batch_id ?? ""));
    const importedRegistrations = registrations.docs.filter((document) => imported(document.data()));
    const importedTeams = teams.docs.filter((document) => imported(document.data()));
    check(tournament.exists, "target tournament is missing");
    check(importedRegistrations.length === 0, `${importedRegistrations.length} import registrations remain`);
    check(importedTeams.length === 0, `${importedTeams.length} import teams remain`);
    for (const batch of batches.docs) {
        check(batch.data().status === "reverted", `${batch.ref.path} is not reverted`);
        check(batch.data().reverted_by_repair_id === repairId, `${batch.ref.path} has a different repair ID`);
    }

    const retiredPaths = normalizedEntries.filter((entry) => entry.path.startsWith("retired_global_ids/"));
    const maximumRetiredId = Math.max(
        0,
        ...retiredPaths.map((entry) => Number(entry.path.split("/")[1])).filter(Number.isFinite),
    );
    check(Number(counter.data()?.count ?? 0) >= maximumRetiredId, "Global ID counter is below a retired ID");
    check(Number(counter.data()?.retired_count ?? -1) === retired.size, "counter.retired_count does not match retired IDs");
    check(counter.data()?.last_repair_id === repairId, "counter.last_repair_id does not match this repair");
    check(
        (writeControl.data()?.writes_enabled !== false) === (expectedWrites === "enabled"),
        `production write control is not ${expectedWrites}`,
    );

    const report: Record<string, unknown> = {
        reportVersion: 1,
        databaseId,
        tournamentId,
        repairId,
        passed: failures.length === 0,
        failures,
        manifestChecksum,
        counts: {
            manifestEntries: entries.size,
            remainingImportedRegistrations: importedRegistrations.length,
            remainingImportedTeams: importedTeams.length,
            events: events.size,
            revertedBatches: batches.docs.filter((batch) => batch.data().status === "reverted").length,
            retiredByRepair: retiredPaths.length,
            retiredTotal: retired.size,
        },
        counter: {
            count: Number(counter.data()?.count ?? 0),
            retiredCount: Number(counter.data()?.retired_count ?? 0),
            lastRepairId: counter.data()?.last_repair_id ?? null,
        },
        tournamentParticipants: Number(tournament.data()?.participants ?? -1),
        eventApprovedParticipants: Object.fromEntries(
            events.docs.map((event) => [event.id, Number(event.data().approved_participants ?? -1)]),
        ),
        writesEnabled: writeControl.data()?.writes_enabled !== false,
        generatedAt: new Date().toISOString(),
    };
    await mkdir("release-reports", {recursive: true});
    const reportPath = `release-reports/tournament-import-cleanup-validation-${Date.now()}.json`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    if (failures.length > 0) throw new Error(`Cleanup validation failed: ${failures.join("; ")}`);
    return {...report, reportPath};
};

const invokedDirectly = process.argv[1]?.endsWith("validateTournamentImportCleanup.js");
if (invokedDirectly) {
    runValidateTournamentImportCleanup(process.argv.slice(2))
        .then((report) => console.info(JSON.stringify(report, null, 2)))
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
}
