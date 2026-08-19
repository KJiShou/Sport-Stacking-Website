import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {type DocumentData, type DocumentSnapshot, type Firestore, Timestamp, getFirestore} from "firebase-admin/firestore";

const PRIMARY_DATABASE = "(default)";
const DEFAULT_PROJECT_ID = "sport-stacking-website";
export const CLEANUP_TOURNAMENT_ID = "qzhR8w2Zs7MNUtlycL9N";

type CleanupOptions = {
    databaseId: string;
    tournamentId: string;
    commit: boolean;
    allowPrimaryReadOnly: boolean;
    repairId: string;
    effectiveAt: Timestamp;
    effectiveAtIso: string;
    expectedChecksum?: string;
};

type CleanupOperation = {
    path: string;
    action: "delete" | "set";
    data?: DocumentData;
};

type GuardFailure = {path: string; code: string; detail: string};

const argumentValue = (args: readonly string[], name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};

export const cleanupConfirmation = (databaseId: string, tournamentId: string): string =>
    `clear-imported-participants-${tournamentId}-from-${databaseId === PRIMARY_DATABASE ? "default" : databaseId}`;

export const parseCleanupTournamentImportArgs = (args: readonly string[]): CleanupOptions => {
    const valueFlags = new Set([
        "--database",
        "--tournament",
        "--confirm",
        "--primary-confirm",
        "--repair-id",
        "--as-of",
        "--expected-checksum",
    ]);
    const booleanFlags = new Set(["--commit", "--allow-primary-read-only", "--allow-primary"]);
    const allowed = new Set([...valueFlags, ...booleanFlags]);
    const seen = new Set<string>();
    for (let index = 0; index < args.length; index += 1) {
        const entry = args[index];
        if (!entry?.startsWith("--")) throw new Error(`Unexpected positional argument: ${entry ?? ""}`);
        if (!allowed.has(entry)) throw new Error(`Unknown cleanup argument: ${entry}`);
        if (seen.has(entry)) throw new Error(`Duplicate cleanup argument: ${entry}`);
        seen.add(entry);
        if (valueFlags.has(entry)) {
            const value = args[index + 1];
            if (!value || value.startsWith("--")) throw new Error(`${entry} requires a value.`);
            index += 1;
        }
    }

    const databaseId = argumentValue(args, "--database")?.trim() ?? "";
    const tournamentId = argumentValue(args, "--tournament")?.trim() ?? "";
    const commit = args.includes("--commit");
    const allowPrimaryReadOnly = args.includes("--allow-primary-read-only");
    const allowPrimary = args.includes("--allow-primary");
    if (!databaseId || !tournamentId) throw new Error("Cleanup requires explicit --database and --tournament values.");
    const effectiveAtValue = argumentValue(args, "--as-of")?.trim() ?? "";
    const effectiveAtDate = new Date(effectiveAtValue);
    if (!effectiveAtValue || Number.isNaN(effectiveAtDate.valueOf())) {
        throw new Error("Cleanup requires a valid explicit UTC ISO timestamp in --as-of.");
    }
    const effectiveAtIso = effectiveAtDate.toISOString();
    if (effectiveAtValue !== effectiveAtIso) {
        throw new Error(`--as-of must use the canonical UTC ISO form ${effectiveAtIso}.`);
    }
    if (databaseId !== PRIMARY_DATABASE) throw new Error("This cleanup is restricted to the production (default) database.");
    if (tournamentId !== CLEANUP_TOURNAMENT_ID) {
        throw new Error(`This cleanup is restricted to tournament ${CLEANUP_TOURNAMENT_ID}.`);
    }
    if (databaseId === PRIMARY_DATABASE && !commit && !allowPrimaryReadOnly) {
        throw new Error("A production dry-run requires --allow-primary-read-only.");
    }
    if (databaseId === PRIMARY_DATABASE && commit) {
        if (!allowPrimary || argumentValue(args, "--primary-confirm") !== "cleanup-imported-participants-on-default") {
            throw new Error(
                "A production commit requires --allow-primary --primary-confirm cleanup-imported-participants-on-default.",
            );
        }
    }
    if (commit && argumentValue(args, "--confirm") !== cleanupConfirmation(databaseId, tournamentId)) {
        throw new Error(`Commit requires --confirm ${cleanupConfirmation(databaseId, tournamentId)}.`);
    }
    const expectedChecksum = argumentValue(args, "--expected-checksum")?.trim();
    if (commit && !/^[a-f0-9]{64}$/.test(expectedChecksum ?? "")) {
        throw new Error("Commit requires the exact 64-character SHA-256 value from --expected-checksum.");
    }
    if (!commit && expectedChecksum !== undefined) {
        throw new Error("--expected-checksum is only valid with --commit.");
    }
    if (!commit && argumentValue(args, "--confirm") !== undefined) {
        throw new Error("--confirm is only valid with --commit.");
    }
    const repairId = argumentValue(args, "--repair-id")?.trim() ?? `tournament-import-cleanup-${tournamentId}-${databaseId}`;
    if (!/^[A-Za-z0-9._()-]+$/.test(repairId)) throw new Error("--repair-id contains unsupported characters.");
    return {
        databaseId,
        tournamentId,
        commit,
        allowPrimaryReadOnly,
        repairId,
        effectiveAt: Timestamp.fromDate(effectiveAtDate),
        effectiveAtIso,
        expectedChecksum,
    };
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

const hasNoOwners = (data: DocumentData): boolean =>
    (!Array.isArray(data.owner_uids) || data.owner_uids.length === 0) &&
    !String(data.email ?? "").trim() &&
    !String(data.primary_owner_email ?? "").trim();

const registrationProfileId = (data: DocumentData): string => String(data.profile_id ?? data.user_id ?? "").trim();
const registrationGlobalId = (data: DocumentData): string => String(data.global_id ?? data.user_global_id ?? "").trim();

const teamGlobalIds = (data: DocumentData): string[] =>
    [
        typeof data.leader_id === "string" ? data.leader_id : "",
        ...(Array.isArray(data.members)
            ? data.members.flatMap((member: unknown) =>
                  member && typeof member === "object" && typeof (member as {global_id?: unknown}).global_id === "string"
                      ? [(member as {global_id: string}).global_id]
                      : [],
              )
            : []),
    ].filter(Boolean);

const identityFields = new Set([
    "global_id",
    "globalId",
    "user_global_id",
    "participant_global_id",
    "target_global_id",
    "member_id",
    "leader_id",
    "participant_id",
    "member_global_id",
    "member_global_ids",
    "participant_global_ids",
    "memberIds",
    "participantIds",
    "profile_id",
    "profileId",
    "user_id",
]);

const containsCandidateIdentity = (value: unknown, profileIds: Set<string>, globalIds: Set<string>, field?: string): boolean => {
    if (typeof value === "string") {
        return Boolean(field && identityFields.has(field) && (profileIds.has(value) || globalIds.has(value)));
    }
    if (Array.isArray(value)) return value.some((entry) => containsCandidateIdentity(entry, profileIds, globalIds, field));
    if (value && typeof value === "object") {
        return Object.entries(value as Record<string, unknown>).some(([key, entry]) =>
            containsCandidateIdentity(entry, profileIds, globalIds, key),
        );
    }
    return false;
};

const addOperation = (operations: Map<string, CleanupOperation>, operation: CleanupOperation): void => {
    operations.set(operation.path, operation);
};

const isImportedDocument = (data: DocumentData, batchIds: Set<string>): boolean =>
    data.registration_source === "admin_import" || batchIds.has(String(data.import_batch_id ?? ""));

const authUserExists = async (profileId: string): Promise<boolean> => {
    try {
        await getAuth().getUser(profileId);
        return true;
    } catch (error) {
        if ((error as {code?: string}).code === "auth/user-not-found") return false;
        throw error;
    }
};

const loadTopLevel = async (database: Firestore, collection: string) => database.collection(collection).get();

export const buildCleanupPlan = async (
    database: Firestore,
    options: CleanupOptions,
    lookupAuthUser: (profileId: string) => Promise<boolean> = authUserExists,
): Promise<{
    operations: CleanupOperation[];
    failures: GuardFailure[];
    retainedAnomalies: GuardFailure[];
    counts: Record<string, number>;
    candidateProfileIds: string[];
    candidateGlobalIds: string[];
}> => {
    const {tournamentId, repairId} = options;
    const [tournament, batches, registrations, teams, events, counter, existingManifest, allUsers] = await Promise.all([
        database.collection("tournaments").doc(tournamentId).get(),
        database.collection("import_batches").where("tournament_id", "==", tournamentId).get(),
        database.collection("registrations").where("tournament_id", "==", tournamentId).get(),
        database.collection("teams").where("tournament_id", "==", tournamentId).get(),
        database.collection("events").where("tournament_id", "==", tournamentId).get(),
        database.collection("counters").doc("userCounter").get(),
        database.collection("repair_manifests").doc(repairId).get(),
        loadTopLevel(database, "users"),
    ]);
    if (!tournament.exists) throw new Error(`Tournament ${tournamentId} does not exist.`);
    if (existingManifest.data()?.status === "complete") {
        return {
            operations: [],
            failures: [],
            retainedAnomalies: [],
            counts: {alreadyCompleted: 1},
            candidateProfileIds: [],
            candidateGlobalIds: [],
        };
    }

    const batchIds = new Set(batches.docs.map((document) => document.id));
    const importedRegistrations = registrations.docs.filter((document) => isImportedDocument(document.data(), batchIds));
    const candidateProfiles = allUsers.docs.filter((document) => {
        const data = document.data();
        return data.source === "admin_import" && batchIds.has(String(data.import_batch_id ?? ""));
    });
    const candidateProfileIds = new Set(candidateProfiles.map((document) => document.id));
    const candidateGlobalIds = new Set(
        candidateProfiles.map((document) => String(document.data().global_id ?? "")).filter(Boolean),
    );
    const failures: GuardFailure[] = [];
    for (const profile of candidateProfiles) {
        if (!profile.exists) {
            failures.push({path: profile.ref.path, code: "MISSING_PROFILE", detail: "Imported registration profile is missing."});
            continue;
        }
        const data = profile.data() ?? {};
        if (data.source !== "admin_import" || data.account_status !== "unclaimed" || !hasNoOwners(data)) {
            failures.push({
                path: profile.ref.path,
                code: "PROFILE_NOT_SAFE_TO_DELETE",
                detail: "Profile is claimed, owned, has contact ownership, or was not created by an admin import.",
            });
        }
        if (!batchIds.has(String(data.import_batch_id ?? ""))) {
            failures.push({
                path: profile.ref.path,
                code: "PROFILE_BATCH_OUT_OF_SCOPE",
                detail: "Profile import batch does not belong to the target tournament.",
            });
        }
        if (await lookupAuthUser(profile.id)) {
            failures.push({
                path: profile.ref.path,
                code: "AUTH_USER_EXISTS",
                detail: "An Auth account uses this profile document ID.",
            });
        }
    }

    for (const registration of importedRegistrations) {
        const data = registration.data();
        if (data.payment_proof_path || data.payment_proof_url) {
            failures.push({
                path: registration.ref.path,
                code: "PAYMENT_PROOF_PRESENT",
                detail: "Cleanup will not delete a registration that references payment evidence.",
            });
        }
    }

    const allRegistrations = await loadTopLevel(database, "registrations");
    for (const registration of allRegistrations.docs) {
        const data = registration.data();
        if (!candidateProfileIds.has(registrationProfileId(data)) && !candidateGlobalIds.has(registrationGlobalId(data))) {
            continue;
        }
        if (data.tournament_id === tournamentId && !isImportedDocument(data, batchIds)) {
            failures.push({
                path: registration.ref.path,
                code: "MANUAL_REGISTRATION_REFERENCE",
                detail: "A non-import registration references an import-created profile.",
            });
        } else if (data.tournament_id !== tournamentId) {
            failures.push({
                path: registration.ref.path,
                code: "OTHER_TOURNAMENT_REGISTRATION",
                detail: "Candidate profile is registered in another tournament.",
            });
        }
    }

    const blockingCollections = [
        "results",
        "records",
        "prelim_records",
        "overall_records",
        "globalResult",
        "leaderboard_entries",
        "user_tournament_history",
        "finalists",
        "profile_claim_requests",
        "individual_recruitment",
        "double_recruitment",
        "team_recruitment",
        "verification_requests",
        "notifications",
    ];
    for (const collectionName of blockingCollections) {
        const snapshot = await loadTopLevel(database, collectionName);
        for (const document of snapshot.docs) {
            const data = document.data();
            if (!containsCandidateIdentity(data, candidateProfileIds, candidateGlobalIds)) continue;
            failures.push({
                path: document.ref.path,
                code: collectionName.includes("claim") ? "PROFILE_CLAIM_REFERENCE" : "EXTERNAL_BUSINESS_REFERENCE",
                detail: `Candidate identity is referenced by ${collectionName}.`,
            });
        }
    }

    const retainedAnomalies: GuardFailure[] = [];
    for (const team of teams.docs) {
        if (isImportedDocument(team.data(), batchIds)) continue;
        const intersects = teamGlobalIds(team.data()).some((globalId) => candidateGlobalIds.has(globalId));
        if (intersects) {
            failures.push({
                path: team.ref.path,
                code: "MANUAL_TEAM_REFERENCE",
                detail: "A non-import team references an imported candidate profile.",
            });
        } else if (
            !team.data().registration_id ||
            !(await database.collection("registrations").doc(String(team.data().registration_id)).get()).exists
        ) {
            retainedAnomalies.push({
                path: team.ref.path,
                code: "RETAINED_ORPHAN_TEAM",
                detail: "Non-import team is outside this cleanup and remains unchanged.",
            });
        }
    }

    const operations = new Map<string, CleanupOperation>();
    if (failures.length === 0) {
        for (const registration of importedRegistrations)
            addOperation(operations, {path: registration.ref.path, action: "delete"});
        for (const team of teams.docs) {
            if (isImportedDocument(team.data(), batchIds)) addOperation(operations, {path: team.ref.path, action: "delete"});
        }
        const profileIdentityIndexes = await loadTopLevel(database, "profile_identity_keys");
        const registrationIndexes = await loadTopLevel(database, "registration_unique_keys");
        const teamIndexes = await loadTopLevel(database, "team_import_keys");
        const importedRegistrationIds = new Set(importedRegistrations.map((document) => document.id));
        for (const index of profileIdentityIndexes.docs) {
            if (candidateProfileIds.has(String(index.data().profile_id ?? ""))) {
                addOperation(operations, {path: index.ref.path, action: "delete"});
            }
        }
        for (const index of registrationIndexes.docs) {
            if (
                index.data().tournament_id === tournamentId &&
                (candidateProfileIds.has(String(index.data().profile_id ?? "")) ||
                    importedRegistrationIds.has(String(index.data().registration_id ?? "")))
            ) {
                addOperation(operations, {path: index.ref.path, action: "delete"});
            }
        }
        for (const index of teamIndexes.docs) {
            if (index.data().tournament_id === tournamentId) addOperation(operations, {path: index.ref.path, action: "delete"});
        }

        const now = options.effectiveAt;
        for (const profile of candidateProfiles) {
            if (!profile.exists) continue;
            const data = profile.data() ?? {};
            const globalId = String(data.global_id ?? "");
            addOperation(operations, {path: profile.ref.path, action: "delete"});
            if (globalId) {
                addOperation(operations, {
                    path: `retired_global_ids/${globalId}`,
                    action: "set",
                    data: {
                        global_id: globalId,
                        reason: "reverted_tournament_import",
                        tournament_id: tournamentId,
                        source_profile_id: profile.id,
                        import_batch_id: data.import_batch_id ?? null,
                        repair_id: repairId,
                        retired_at: now,
                        schema_version: 1,
                    },
                });
            }
        }
        for (const batch of batches.docs) {
            addOperation(operations, {
                path: batch.ref.path,
                action: "set",
                data: {
                    ...batch.data(),
                    status: "reverted",
                    reverted_by_repair_id: repairId,
                    reverted_at: now,
                    updated_at: now,
                },
            });
        }

        const remainingRegistrations = registrations.docs.filter((document) => !operations.has(document.ref.path));
        const approved = remainingRegistrations.filter((document) => {
            const data = document.data();
            return data.registration_status === "approved" || data.status === "confirmed";
        });
        addOperation(operations, {
            path: tournament.ref.path,
            action: "set",
            data: {...(tournament.data() ?? {}), participants: approved.length, updated_at: now},
        });
        for (const event of events.docs) {
            const accepted = new Set(
                [event.id, event.data().type, ...(Array.isArray(event.data().codes) ? event.data().codes : [])]
                    .filter((entry): entry is string => typeof entry === "string")
                    .map((entry) => entry.trim().toLowerCase()),
            );
            const count = approved.filter((registration) => {
                const eventIds = registration.data().events_registered ?? registration.data().event_ids ?? [];
                return (
                    Array.isArray(eventIds) &&
                    eventIds.some((entry) => typeof entry === "string" && accepted.has(entry.trim().toLowerCase()))
                );
            }).length;
            addOperation(operations, {
                path: event.ref.path,
                action: "set",
                data: {...event.data(), approved_participants: count, updated_at: now},
            });
        }

        const existingRetired = await loadTopLevel(database, "retired_global_ids");
        const maxExisting = Math.max(
            0,
            ...allUsers.docs.map((document) => Number(document.data().global_id)).filter(Number.isFinite),
            ...[...candidateGlobalIds].map(Number).filter(Number.isFinite),
            ...existingRetired.docs.map((document) => Number(document.id)).filter(Number.isFinite),
        );
        const currentCount = Number(counter.data()?.count ?? 0);
        addOperation(operations, {
            path: counter.ref.path,
            action: "set",
            data: {
                ...(counter.data() ?? {}),
                count: Math.max(currentCount, maxExisting),
                retired_count: new Set([...existingRetired.docs.map((document) => document.id), ...candidateGlobalIds]).size,
                last_reconciled_at: now,
                last_repair_id: repairId,
                updated_at: now,
            },
        });
    }

    return {
        operations: [...operations.values()].sort((left, right) => left.path.localeCompare(right.path)),
        failures: failures.sort((left, right) => left.path.localeCompare(right.path)),
        retainedAnomalies,
        counts: {
            importBatches: batches.size,
            importedRegistrations: importedRegistrations.length,
            importedTeams: teams.docs.filter((document) => isImportedDocument(document.data(), batchIds)).length,
            candidateProfiles: candidateProfiles.filter((document) => document.exists).length,
            candidateGlobalIds: candidateGlobalIds.size,
            retainedTeams: teams.docs.filter((document) => !isImportedDocument(document.data(), batchIds)).length,
        },
        candidateProfileIds: [...candidateProfileIds].sort(),
        candidateGlobalIds: [...candidateGlobalIds].sort(),
    };
};

const writeReport = async (report: Record<string, unknown>): Promise<string> => {
    await mkdir("release-reports", {recursive: true});
    const databaseId = String(report.databaseId).replace(/[()]/g, "");
    const reportPath = `release-reports/tournament-import-cleanup-${databaseId}-${Date.now()}.json`;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return reportPath;
};

const operationManifest = async (database: Firestore, operations: CleanupOperation[]) => {
    const snapshots = new Map<string, DocumentSnapshot>();
    for (let offset = 0; offset < operations.length; offset += 300) {
        const chunk = operations.slice(offset, offset + 300);
        const loaded = await database.getAll(...chunk.map((operation) => database.doc(operation.path)));
        for (const snapshot of loaded) snapshots.set(snapshot.ref.path, snapshot);
    }
    return operations.map((operation) => {
        const before = snapshots.get(operation.path);
        return {
            path: operation.path,
            action: operation.action,
            beforeExists: before?.exists ?? false,
            beforeData: before?.data() ?? null,
            beforeChecksum: checksum(before?.data() ?? null),
            afterExists: operation.action === "set",
            afterData: operation.data ?? null,
            afterChecksum: checksum(operation.data ?? null),
        };
    });
};

export const runCleanupTournamentImport = async (
    args: readonly string[],
    dependencies: {
        authUserExists?: (profileId: string) => Promise<boolean>;
        database?: Firestore;
        skipMaintenanceCheck?: boolean;
    } = {},
): Promise<Record<string, unknown>> => {
    const options = parseCleanupTournamentImportArgs(args);
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID;
    const app = getApps()[0] ?? initializeApp({projectId});
    const database =
        dependencies.database ??
        (options.databaseId === PRIMARY_DATABASE ? getFirestore(app) : getFirestore(app, options.databaseId));
    if (options.commit && options.databaseId === PRIMARY_DATABASE && !dependencies.skipMaintenanceCheck) {
        const writeControl = await database.doc("system_config/write_control").get();
        if (writeControl.data()?.writes_enabled !== false) {
            throw new Error("Primary import cleanup requires write-control read-only mode.");
        }
    }
    const plan = await buildCleanupPlan(database, options, dependencies.authUserExists);
    const manifest = await operationManifest(database, plan.operations);
    const planChecksum = checksum(
        manifest.map(({path, action, beforeChecksum, afterChecksum}) => ({path, action, beforeChecksum, afterChecksum})),
    );
    const manifestChecksum = checksum(
        manifest.map(({path, beforeExists, beforeChecksum, afterExists, afterChecksum}) => ({
            path,
            beforeExists,
            beforeChecksum,
            afterExists,
            afterChecksum,
        })),
    );
    const report: Record<string, unknown> = {
        reportVersion: 1,
        databaseId: options.databaseId,
        tournamentId: options.tournamentId,
        repairId: options.repairId,
        mode: options.commit ? "commit" : "dry-run",
        generatedAt: new Date().toISOString(),
        effectiveAt: options.effectiveAtIso,
        counts: plan.counts,
        operationCount: plan.operations.length,
        planChecksum,
        manifestChecksum,
        blockingFailures: plan.failures,
        retainedAnomalies: plan.retainedAnomalies,
        candidateProfileIds: plan.candidateProfileIds,
        candidateGlobalIds: plan.candidateGlobalIds,
        operations: manifest.map(({path, action, beforeChecksum, afterChecksum}) => ({
            path,
            action,
            beforeChecksum,
            afterChecksum,
        })),
        firebaseWritesPerformed: false,
        authTouched: false,
        storageTouched: false,
    };

    if (options.commit) {
        if (plan.failures.length > 0) throw new Error(`Cleanup has ${plan.failures.length} blocking safety failures.`);
        if (options.expectedChecksum !== planChecksum) {
            throw new Error(
                `Cleanup plan checksum changed: expected ${options.expectedChecksum}, received ${planChecksum}. Run a fresh dry-run.`,
            );
        }
        const manifestRef = database.collection("repair_manifests").doc(options.repairId);
        const existing = await manifestRef.get();
        if (existing.data()?.status === "complete") {
            report.alreadyCompleted = true;
        } else {
            const startedAt = Timestamp.now();
            await manifestRef.set({
                repair_id: options.repairId,
                database_id: options.databaseId,
                tournament_id: options.tournamentId,
                status: "applying",
                plan_checksum: planChecksum,
                manifest_checksum: manifestChecksum,
                operation_count: manifest.length,
                created_at: existing.data()?.created_at ?? startedAt,
                updated_at: startedAt,
            });
            for (let offset = 0; offset < manifest.length; offset += 150) {
                const batch = database.batch();
                for (const entry of manifest.slice(offset, offset + 150)) {
                    batch.set(manifestRef.collection("entries").doc(checksum(entry.path)), {
                        path: entry.path,
                        action: entry.action,
                        before_exists: entry.beforeExists,
                        before_data: entry.beforeData,
                        before_checksum: entry.beforeChecksum,
                        after_exists: entry.afterExists,
                        after_checksum: entry.afterChecksum,
                    });
                }
                await batch.commit();
            }
            for (let offset = 0; offset < plan.operations.length; offset += 300) {
                const chunk = plan.operations.slice(offset, offset + 300);
                const current = await database.getAll(...chunk.map((operation) => database.doc(operation.path)));
                for (const [index, snapshot] of current.entries()) {
                    if (checksum(snapshot.data() ?? null) !== manifest[offset + index]?.beforeChecksum) {
                        throw new Error(`Cleanup target changed after dry-run: ${snapshot.ref.path}`);
                    }
                }
                const batch = database.batch();
                for (const operation of chunk) {
                    if (operation.action === "delete") batch.delete(database.doc(operation.path));
                    else batch.set(database.doc(operation.path), operation.data ?? {});
                }
                await batch.commit();
                const postSnapshots = await database.getAll(...chunk.map((operation) => database.doc(operation.path)));
                for (const [index, snapshot] of postSnapshots.entries()) {
                    const expected = manifest[offset + index];
                    if (
                        snapshot.exists !== expected?.afterExists ||
                        checksum(snapshot.data() ?? null) !== expected.afterChecksum
                    ) {
                        throw new Error(`Cleanup postcondition failed: ${snapshot.ref.path}`);
                    }
                }
            }
            const postState: Array<{path: string; exists: boolean; data: DocumentData | null}> = [];
            const beforeState: Array<{path: string; exists: boolean; data: DocumentData | null}> = [];
            for (let offset = 0; offset < manifest.length; offset += 300) {
                const chunk = manifest.slice(offset, offset + 300);
                const snapshots = await database.getAll(...chunk.map((entry) => database.doc(entry.path)));
                for (const [index, snapshot] of snapshots.entries()) {
                    const entry = chunk[index];
                    if (!entry) continue;
                    postState.push({path: entry.path, exists: snapshot.exists, data: snapshot.data() ?? null});
                    beforeState.push({path: entry.path, exists: entry.beforeExists, data: entry.beforeData});
                }
            }
            postState.sort((left, right) => left.path.localeCompare(right.path));
            beforeState.sort((left, right) => left.path.localeCompare(right.path));
            await manifestRef.set(
                {
                    status: "complete",
                    completed_at: Timestamp.now(),
                    updated_at: Timestamp.now(),
                    post_checksum: planChecksum,
                    post_state_checksum: checksum(postState),
                    before_state_checksum: checksum(beforeState),
                },
                {merge: true},
            );
            report.postStateChecksum = checksum(postState);
            report.firebaseWritesPerformed = true;
        }
    }
    const reportPath = await writeReport(report);
    return {...report, reportPath};
};

const invokedDirectly = process.argv[1]?.endsWith("cleanupTournamentImport.js");
if (invokedDirectly) {
    runCleanupTournamentImport(process.argv.slice(2))
        .then((report) =>
            console.info(
                JSON.stringify(
                    {
                        databaseId: report.databaseId,
                        tournamentId: report.tournamentId,
                        repairId: report.repairId,
                        mode: report.mode,
                        effectiveAt: report.effectiveAt,
                        counts: report.counts,
                        operationCount: report.operationCount,
                        planChecksum: report.planChecksum,
                        manifestChecksum: report.manifestChecksum,
                        blockingFailures: report.blockingFailures,
                        retainedAnomalies: report.retainedAnomalies,
                        firebaseWritesPerformed: report.firebaseWritesPerformed,
                        reportPath: report.reportPath,
                    },
                    null,
                    2,
                ),
            ),
        )
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
}
