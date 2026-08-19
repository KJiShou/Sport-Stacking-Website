import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {getApps, initializeApp} from "firebase-admin/app";
import {type DocumentData, type Firestore, Timestamp, getFirestore} from "firebase-admin/firestore";

const PRIMARY_DATABASE = "(default)";

type ReverseOptions = {
    databaseId: string;
    repairId: string;
    commit: boolean;
    expectedManifestChecksum?: string;
};

const argumentValue = (args: readonly string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

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

export const parseReverseTournamentImportArgs = (args: readonly string[]): ReverseOptions => {
    const valueFlags = new Set(["--database", "--repair-id", "--primary-confirm", "--confirm", "--expected-manifest-checksum"]);
    const booleanFlags = new Set(["--commit", "--allow-primary-read-only", "--allow-primary"]);
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
        const entry = args[index];
        if (!entry?.startsWith("--") || (!valueFlags.has(entry) && !booleanFlags.has(entry))) {
            throw new Error(`Unknown reverse argument: ${entry ?? ""}`);
        }
        if (seen.has(entry)) throw new Error(`Duplicate reverse argument: ${entry}`);
        seen.add(entry);
        if (valueFlags.has(entry)) {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new Error(`${entry} requires a value.`);
            index += 1;
        }
    }
    const databaseId = argumentValue(args, "--database")?.trim() ?? "";
    const repairId = argumentValue(args, "--repair-id")?.trim() ?? "";
    const commit = args.includes("--commit");
    if (databaseId !== PRIMARY_DATABASE) throw new Error("Reverse cleanup is restricted to the production (default) database.");
    if (!repairId) throw new Error("Reverse cleanup requires --repair-id.");
    if (!commit && !args.includes("--allow-primary-read-only")) {
        throw new Error("A production reverse dry-run requires --allow-primary-read-only.");
    }
    if (commit) {
        if (!args.includes("--allow-primary")) throw new Error("Refusing to mutate (default) without --allow-primary.");
        if (argumentValue(args, "--primary-confirm") !== "reverse-import-cleanup-on-default") {
            throw new Error("Production reverse requires --primary-confirm reverse-import-cleanup-on-default.");
        }
        if (argumentValue(args, "--confirm") !== `reverse-${repairId}`) {
            throw new Error(`Reverse commit requires --confirm reverse-${repairId}.`);
        }
    }
    const expectedManifestChecksum = argumentValue(args, "--expected-manifest-checksum")?.trim();
    if (commit && !/^[a-f0-9]{64}$/.test(expectedManifestChecksum ?? "")) {
        throw new Error("Reverse commit requires the dry-run --expected-manifest-checksum value.");
    }
    if (!commit && expectedManifestChecksum) {
        throw new Error("--expected-manifest-checksum is only valid with --commit.");
    }
    return {databaseId, repairId, commit, expectedManifestChecksum};
};

export const runReverseTournamentImportCleanup = async (
    args: readonly string[],
    dependencies: {database?: Firestore; skipMaintenanceCheck?: boolean} = {},
): Promise<Record<string, unknown>> => {
    const options = parseReverseTournamentImportArgs(args);
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "sport-stacking-website";
    const app = getApps()[0] ?? initializeApp({projectId});
    const database = dependencies.database ?? getFirestore(app);
    const manifestRef = database.collection("repair_manifests").doc(options.repairId);
    const [manifest, entriesSnapshot] = await Promise.all([manifestRef.get(), manifestRef.collection("entries").get()]);
    if (!manifest.exists || manifest.data()?.status !== "complete") {
        throw new Error(`Repair manifest ${options.repairId} is missing or is not complete.`);
    }
    if (options.commit && !dependencies.skipMaintenanceCheck) {
        const writeControl = await database.doc("system_config/write_control").get();
        if (writeControl.data()?.writes_enabled !== false) {
            throw new Error("Production reverse requires write-control read-only mode.");
        }
    }

    const entries = entriesSnapshot.docs
        .map((document) => {
            const data = document.data();
            return {
                path: String(data.path ?? ""),
                beforeExists: data.before_exists === true,
                beforeData: (data.before_data ?? null) as DocumentData | null,
                beforeChecksum: String(data.before_checksum ?? ""),
                afterExists: data.after_exists === true,
                afterChecksum: String(data.after_checksum ?? ""),
            };
        })
        .filter((entry) => entry.path)
        .sort((left, right) => right.path.split("/").length - left.path.split("/").length || left.path.localeCompare(right.path));
    const manifestChecksum = checksum(
        entries
            .map(({path, beforeExists, beforeChecksum, afterExists, afterChecksum}) => ({
                path,
                beforeExists,
                beforeChecksum,
                afterExists,
                afterChecksum,
            }))
            .sort((left, right) => left.path.localeCompare(right.path)),
    );
    if (manifest.data()?.manifest_checksum !== manifestChecksum) {
        throw new Error("Repair manifest entries do not match the recorded manifest checksum.");
    }
    if (options.commit && options.expectedManifestChecksum !== manifestChecksum) {
        throw new Error("Reverse manifest checksum changed. Run a fresh reverse dry-run.");
    }

    const state: Array<{path: string; exists: boolean; data: DocumentData | null}> = [];
    for (let offset = 0; offset < entries.length; offset += 300) {
        const chunk = entries.slice(offset, offset + 300);
        const snapshots = await database.getAll(...chunk.map((entry) => database.doc(entry.path)));
        for (const [index, snapshot] of snapshots.entries()) {
            const expected = chunk[index];
            if (snapshot.exists !== expected?.afterExists || checksum(snapshot.data() ?? null) !== expected.afterChecksum) {
                throw new Error(`Reverse refused because post-cleanup data drifted: ${snapshot.ref.path}`);
            }
            state.push({path: expected.path, exists: snapshot.exists, data: snapshot.data() ?? null});
        }
    }
    state.sort((left, right) => left.path.localeCompare(right.path));
    if (typeof manifest.data()?.post_state_checksum === "string" && checksum(state) !== manifest.data()?.post_state_checksum) {
        throw new Error("Reverse refused because the aggregate post-cleanup checksum drifted.");
    }

    const irreversible = (path: string): boolean => path.startsWith("retired_global_ids/") || path === "counters/userCounter";
    const reversibleEntries = entries.filter((entry) => !irreversible(entry.path));
    if (options.commit) {
        for (let offset = 0; offset < reversibleEntries.length; offset += 300) {
            const chunk = reversibleEntries.slice(offset, offset + 300);
            const current = await database.getAll(...chunk.map((entry) => database.doc(entry.path)));
            for (const [index, snapshot] of current.entries()) {
                const expected = chunk[index];
                if (snapshot.exists !== expected?.afterExists || checksum(snapshot.data() ?? null) !== expected.afterChecksum) {
                    throw new Error(`Reverse target drifted before write: ${snapshot.ref.path}`);
                }
            }
            const batch = database.batch();
            for (const entry of chunk) {
                if (entry.beforeExists && entry.beforeData) batch.set(database.doc(entry.path), entry.beforeData);
                else batch.delete(database.doc(entry.path));
            }
            await batch.commit();
            const restored = await database.getAll(...chunk.map((entry) => database.doc(entry.path)));
            for (const [index, snapshot] of restored.entries()) {
                const expected = chunk[index];
                if (snapshot.exists !== expected?.beforeExists || checksum(snapshot.data() ?? null) !== expected.beforeChecksum) {
                    throw new Error(`Reverse restore verification failed: ${snapshot.ref.path}`);
                }
            }
        }
        await manifestRef.set(
            {
                status: "reversed",
                reversed_at: Timestamp.now(),
                updated_at: Timestamp.now(),
                irreversible_paths_preserved: entries.filter((entry) => irreversible(entry.path)).map((entry) => entry.path),
            },
            {merge: true},
        );
    }

    const report: Record<string, unknown> = {
        reportVersion: 1,
        databaseId: options.databaseId,
        repairId: options.repairId,
        mode: options.commit ? "commit" : "dry-run",
        operationCount: entries.length,
        reversibleOperationCount: reversibleEntries.length,
        irreversiblePaths: entries.filter((entry) => irreversible(entry.path)).map((entry) => entry.path),
        postStateChecksum: checksum(state),
        manifestChecksum,
        firebaseWritesPerformed: options.commit,
        generatedAt: new Date().toISOString(),
    };
    await mkdir("release-reports", {recursive: true});
    const reportPath = `release-reports/tournament-import-cleanup-reverse-default-${Date.now()}.json`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return {...report, reportPath};
};

const invokedDirectly = process.argv[1]?.endsWith("reverseTournamentImportCleanup.js");
if (invokedDirectly) {
    runReverseTournamentImportCleanup(process.argv.slice(2))
        .then((report) => console.info(JSON.stringify(report, null, 2)))
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
}
