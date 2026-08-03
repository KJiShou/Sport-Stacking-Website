import {getApps, initializeApp} from "firebase-admin/app";
import {type QueryDocumentSnapshot, Timestamp, getFirestore} from "firebase-admin/firestore";
import {writeScriptAudit} from "../observability.js";

type RegistrationRecord = {
    tournament_id: string;
    events: string[];
    registration_date: Timestamp;
    status: "pending" | "approved" | "rejected";
    rejection_reason: string | null;
    created_at: Timestamp;
    updated_at: Timestamp;
} & Record<string, unknown>;

type RegistrationSource = {
    id?: string;
    tournament_id?: unknown;
    user_id?: unknown;
    user_global_id?: unknown;
    events_registered?: unknown;
    registration_status?: unknown;
    rejection_reason?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
};

type UserSource = {global_id?: unknown; registration_records?: unknown};

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const requestedDatabaseIndex = args.indexOf("--database");
const requestedDatabase = requestedDatabaseIndex >= 0 ? (args[requestedDatabaseIndex + 1] ?? "").trim() : "";

if (!getApps().length) initializeApp();
const firebaseApp = getApps()[0] ?? initializeApp();
const firestoreDatabaseId = requestedDatabase === "default" ? "" : process.env.FIRESTORE_DATABASE_ID?.trim() || requestedDatabase;
const db = firestoreDatabaseId ? getFirestore(firebaseApp, firestoreDatabaseId) : getFirestore(firebaseApp);

const isStatus = (value: unknown): value is RegistrationRecord["status"] =>
    value === "pending" || value === "approved" || value === "rejected";
const asNonEmptyString = (value: unknown): string | null =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asTimestamp = (value: unknown, fallback: Timestamp): Timestamp => (value instanceof Timestamp ? value : fallback);
const recordsEqual = (left: RegistrationRecord, right: RegistrationRecord): boolean =>
    left.tournament_id === right.tournament_id &&
    left.status === right.status &&
    left.rejection_reason === right.rejection_reason &&
    left.events.length === right.events.length &&
    left.events.every((event, index) => event === right.events[index]);

const buildRecord = (source: RegistrationSource, now: Timestamp): RegistrationRecord => ({
    tournament_id: asNonEmptyString(source.tournament_id) ?? "",
    events: Array.isArray(source.events_registered)
        ? source.events_registered.filter((event): event is string => typeof event === "string")
        : [],
    registration_date: asTimestamp(source.created_at, now),
    status: isStatus(source.registration_status) ? source.registration_status : "pending",
    rejection_reason: typeof source.rejection_reason === "string" ? source.rejection_reason : null,
    created_at: asTimestamp(source.created_at, now),
    updated_at: asTimestamp(source.updated_at, now),
});

const main = async (): Promise<void> => {
    const [registrationSnapshot, userSnapshot] = await Promise.all([
        db.collection("registrations").get(),
        db.collection("users").get(),
    ]);
    const usersById = new Map(userSnapshot.docs.map((user) => [user.id, user]));
    const usersByGlobalId = new Map<string, QueryDocumentSnapshot>();
    const duplicateUserGlobalIds = new Set<string>();

    for (const user of userSnapshot.docs) {
        const globalId = asNonEmptyString((user.data() as UserSource).global_id);
        if (!globalId) continue;
        if (usersByGlobalId.has(globalId)) duplicateUserGlobalIds.add(globalId);
        else usersByGlobalId.set(globalId, user);
    }

    const registrationsByUserTournament = new Map<string, QueryDocumentSnapshot[]>();
    const unmatchedRegistrations: string[] = [];
    const ambiguousRegistrations: string[] = [];
    const targetByRegistrationId = new Map<string, QueryDocumentSnapshot>();

    for (const registration of registrationSnapshot.docs) {
        const source = registration.data() as RegistrationSource;
        const userId = asNonEmptyString(source.user_id);
        const globalId = asNonEmptyString(source.user_global_id);
        const userById = userId ? usersById.get(userId) : undefined;
        const userByGlobalId = globalId ? usersByGlobalId.get(globalId) : undefined;
        const target = userById ?? userByGlobalId;

        if (!target) {
            unmatchedRegistrations.push(registration.id);
            continue;
        }
        // user_id is the canonical reference. A Global ID is only used as a
        // fallback, so duplicate or conflicting Global IDs must not override it.
        if (!userById && globalId && duplicateUserGlobalIds.has(globalId)) {
            ambiguousRegistrations.push(registration.id);
            continue;
        }

        const tournamentId = asNonEmptyString(source.tournament_id);
        if (!tournamentId) {
            ambiguousRegistrations.push(registration.id);
            continue;
        }
        targetByRegistrationId.set(registration.id, target);
        const key = `${target.id}:${tournamentId}`;
        registrationsByUserTournament.set(key, [...(registrationsByUserTournament.get(key) ?? []), registration]);
    }

    const duplicateRegistrations = Array.from(registrationsByUserTournament.entries())
        .filter(([, registrations]) => registrations.length > 1)
        .map(([key, registrations]) => ({key, registrationIds: registrations.map((registration) => registration.id)}));
    const duplicateKeys = new Set(duplicateRegistrations.map((duplicate) => duplicate.key));
    const now = Timestamp.now();
    const updates = new Map<string, {user: QueryDocumentSnapshot; records: RegistrationRecord[]}>();
    let synchronized = 0;

    for (const [key, registrations] of registrationsByUserTournament) {
        if (duplicateKeys.has(key)) continue;
        const registration = registrations[0];
        const user = targetByRegistrationId.get(registration.id);
        if (!user) continue;
        const source = registration.data() as RegistrationSource;
        const record = buildRecord(source, now);
        const userData = user.data() as UserSource;
        const currentRecords = Array.isArray(userData.registration_records)
            ? (userData.registration_records.filter((item): item is RegistrationRecord =>
                  Boolean(item && typeof item === "object"),
              ) as RegistrationRecord[])
            : [];
        const existing = currentRecords.find((item) => item.tournament_id === record.tournament_id);
        if (existing && recordsEqual(existing, record)) {
            synchronized += 1;
            continue;
        }
        const pending = updates.get(user.id) ?? {user, records: currentRecords};
        pending.records = [
            ...pending.records.filter((item) => item.tournament_id !== record.tournament_id),
            // Results are maintained by the scoring flow, not registrations.
            // Preserve them when repairing the registration-derived fields.
            {...existing, ...record},
        ];
        updates.set(user.id, pending);
    }

    const report = {
        mode: apply ? "apply" : "dry-run",
        database: firestoreDatabaseId || "default",
        registrationsScanned: registrationSnapshot.size,
        usersScanned: userSnapshot.size,
        recordsAlreadySynchronized: synchronized,
        usersToUpdate: updates.size,
        unmatchedRegistrationIds: unmatchedRegistrations,
        ambiguousRegistrationIds: ambiguousRegistrations,
        duplicateRegistrations,
        duplicateUserGlobalIds: Array.from(duplicateUserGlobalIds),
    };
    console.info(JSON.stringify(report, null, 2));
    if (!apply || updates.size === 0) return;

    const updateEntries = Array.from(updates.values());
    for (let index = 0; index < updateEntries.length; index += 450) {
        const batch = db.batch();
        for (const update of updateEntries.slice(index, index + 450)) {
            batch.update(update.user.ref, {registration_records: update.records, updated_at: now});
        }
        await batch.commit();
    }
    await writeScriptAudit(db, {
        action: "repair.registration-records.apply",
        status: "success",
        entityType: "registration-records",
        entityId: "batch",
        changedFields: ["registration_records"],
        after: {
            usersUpdated: updates.size,
            registrationsScanned: registrationSnapshot.size,
            unmatchedRegistrations: unmatchedRegistrations.length,
            ambiguousRegistrations: ambiguousRegistrations.length,
        },
    });
    console.info(`Synchronized registration records for ${updates.size} user(s).`);
};

void main();
