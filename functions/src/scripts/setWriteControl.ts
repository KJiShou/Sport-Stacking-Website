import {getApps, initializeApp} from "firebase-admin/app";
import {Timestamp, getFirestore} from "firebase-admin/firestore";

const args = process.argv.slice(2);
const repeatableFlags = new Set(["--allow-operation"]);
const valueFlags = new Set(["--database", "--primary-confirm", "--message", "--actor", ...repeatableFlags]);
const booleanFlags = new Set(["--disabled", "--enabled", "--allow-primary"]);
const seen = new Set<string>();
for (let index = 0; index < args.length; index += 1) {
    const entry = args[index];
    if (!entry?.startsWith("--") || (!valueFlags.has(entry) && !booleanFlags.has(entry))) {
        throw new Error(`Unknown write-control argument: ${entry ?? ""}`);
    }
    if (seen.has(entry) && !repeatableFlags.has(entry)) throw new Error(`Duplicate write-control argument: ${entry}`);
    seen.add(entry);
    if (valueFlags.has(entry)) {
        const value = args[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`${entry} requires a value.`);
        index += 1;
    }
}
const readArg = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const readArgs = (name: string): string[] =>
    args.flatMap((entry, index) => (entry === name && args[index + 1] ? [String(args[index + 1]).trim()] : []));
const databaseId = readArg("--database")?.trim() || process.env.RANKINGSTACK_FIRESTORE_DATABASE_ID?.trim() || "";
const disabled = args.includes("--disabled");
const enabled = args.includes("--enabled");
const allowPrimary = args.includes("--allow-primary");
const primaryConfirmation = readArg("--primary-confirm")?.trim();
if (disabled === enabled) throw new Error("Choose exactly one of --disabled or --enabled.");
if (!databaseId) throw new Error("Write control requires an explicit database.");
if (databaseId === "(default)" && (!allowPrimary || primaryConfirmation !== "change-default-write-control")) {
    throw new Error("Changing (default) write control requires --allow-primary --primary-confirm change-default-write-control.");
}
const message = readArg("--message")?.trim() || "RankingStack is temporarily read-only while maintenance is in progress.";
const actor = readArg("--actor")?.trim() || "production-maintenance-window";
const allowedOperations = enabled ? [] : readArgs("--allow-operation").filter(Boolean);
const targetImportOperation = "tournament.import:qzhR8w2Zs7MNUtlycL9N";
if (enabled && readArgs("--allow-operation").length > 0) {
    throw new Error("--allow-operation is only valid while writes are disabled.");
}
for (const operation of allowedOperations) {
    if (operation !== targetImportOperation) throw new Error(`Unsupported maintenance exception: ${operation}`);
}
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "sport-stacking-website";
const app = getApps()[0] ?? initializeApp({projectId});
const firestore = databaseId === "(default)" ? getFirestore(app) : getFirestore(app, databaseId);
const now = Timestamp.now();
await firestore.doc("system_config/write_control").set(
    {
        writes_enabled: enabled,
        allowed_operations: allowedOperations,
        message,
        updated_by: actor,
        updated_at: now,
        schema_version: 1,
    },
    {merge: true},
);
console.info(
    JSON.stringify(
        {databaseId, writes_enabled: enabled, allowedOperations, actor, updatedAt: now.toDate().toISOString()},
        null,
        2,
    ),
);
