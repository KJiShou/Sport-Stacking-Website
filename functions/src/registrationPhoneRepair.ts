import {
    type DocumentData,
    type DocumentSnapshot,
    FieldValue,
    type Firestore,
    Timestamp,
    type Transaction,
} from "firebase-admin/firestore";
import {stableChecksum} from "./importIdempotency.js";
import {setAuditLogInTransaction} from "./observability.js";

export const PHONE_REPAIR_TOURNAMENT_ID = "qzhR8w2Zs7MNUtlycL9N";
const KIND = "registration_phone_repair";
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const eligible = (data: DocumentData, tournamentId: string): boolean =>
    data.tournament_id === tournamentId && data.registration_status === "approved" && data.registration_source === "admin_import";

type Options = {tournamentId: string; repairId: string; apply: boolean; restore?: boolean};
export type PhoneRepairReport = {repairId: string; apply: boolean; restore: boolean; records: Record<string, string[]>};

const resolveProfile = async (
    db: Firestore,
    transaction: Transaction,
    registration: DocumentData,
): Promise<DocumentSnapshot | "identity_conflict" | "missing_profile" | "ambiguous_profile"> => {
    const ids = [...new Set([text(registration.profile_id), text(registration.user_id)].filter(Boolean))];
    if (ids.length > 1) return "identity_conflict";
    const direct = ids[0] ? await transaction.get(db.collection("users").doc(ids[0])) : null;
    const globalId = text(registration.user_global_id);
    if (text(registration.global_id) && globalId && text(registration.global_id) !== globalId) return "identity_conflict";
    const resolvedGlobalId = globalId || text(registration.global_id);
    const matches = resolvedGlobalId
        ? await transaction.get(db.collection("users").where("global_id", "==", resolvedGlobalId).limit(2))
        : null;
    if (matches && matches.size > 1) return "ambiguous_profile";
    if (direct?.exists) {
        if (resolvedGlobalId && (text(direct.data()?.global_id) !== resolvedGlobalId || matches?.docs[0]?.id !== direct.id)) {
            return "identity_conflict";
        }
        return direct;
    }
    return matches?.docs[0] ?? "missing_profile";
};

export const runRegistrationPhoneRepair = async (db: Firestore, options: Options): Promise<PhoneRepairReport> => {
    if (!options.tournamentId || !options.repairId || options.repairId.includes("/"))
        throw new Error("Explicit tournament and repair ID required.");
    const manifestRef = db.collection("repair_manifests").doc(options.repairId);
    const manifest = await manifestRef.get();
    if (manifest.exists && (manifest.data()?.kind !== KIND || manifest.data()?.tournament_id !== options.tournamentId)) {
        throw new Error("Repair manifest belongs to another operation.");
    }
    const report: PhoneRepairReport = {
        repairId: options.repairId,
        apply: options.apply,
        restore: Boolean(options.restore),
        records: {},
    };
    const entries = manifestRef.collection("entries");
    if (options.restore && !manifest.exists) throw new Error("Repair manifest not found.");
    const snapshots = options.restore
        ? await entries.get()
        : await db.collection("registrations").where("tournament_id", "==", options.tournamentId).get();
    for (const snapshot of snapshots.docs) {
        const registrationRef = db.collection("registrations").doc(snapshot.id);
        const entryRef = entries.doc(snapshot.id);
        const result = await db.runTransaction(async (transaction) => {
            const [registration, entry, currentManifest] = await Promise.all([
                transaction.get(registrationRef),
                transaction.get(entryRef),
                transaction.get(manifestRef),
            ]);
            if (
                currentManifest.exists &&
                (currentManifest.data()?.kind !== KIND || currentManifest.data()?.tournament_id !== options.tournamentId)
            ) {
                throw new Error("Repair manifest belongs to another operation.");
            }
            const current = registration.data();
            if (!current || !eligible(current, options.tournamentId)) return "out_of_scope";
            const now = Timestamp.now();
            if (options.restore) {
                const saved = entry.data();
                if (!saved || saved.restored_at) return "already_restored";
                if (stableChecksum(current) !== saved.after_checksum) return "changed_since_repair";
                if (!options.apply) return "would_restore";
                const before = saved.before as DocumentData;
                transaction.update(registrationRef, {
                    phone_number: Object.prototype.hasOwnProperty.call(before, "phone_number")
                        ? before.phone_number
                        : FieldValue.delete(),
                    updated_at: Object.prototype.hasOwnProperty.call(before, "updated_at")
                        ? before.updated_at
                        : FieldValue.delete(),
                });
                transaction.update(entryRef, {restored_at: now});
                setAuditLogInTransaction(
                    transaction,
                    db,
                    {
                        action: "registration.phone_repair.restore",
                        status: "success",
                        source: "script",
                        actorUid: null,
                        actorGlobalId: null,
                        entityType: "registration",
                        entityId: registration.id,
                        tournamentId: options.tournamentId,
                        operationId: options.repairId,
                        changedFields: ["phone_number", "updated_at"],
                    },
                    now,
                );
                return "restored";
            }
            if (text(current.phone_number)) return "already_has_phone";
            if (entry.exists) return "previously_repaired";
            const profile = await resolveProfile(db, transaction, current);
            if (typeof profile === "string") return profile;
            const phone = text(profile.data()?.phone_number);
            if (!phone) return "profile_without_phone";
            if (!options.apply) return "would_update";
            const after = {...current, phone_number: phone, updated_at: now};
            transaction.set(manifestRef, {kind: KIND, tournament_id: options.tournamentId, updated_at: now}, {merge: true});
            transaction.create(entryRef, {
                before: current,
                after,
                after_checksum: stableChecksum(after),
                profile_id: profile.id,
                created_at: now,
            });
            transaction.update(registrationRef, {phone_number: phone, updated_at: now});
            setAuditLogInTransaction(
                transaction,
                db,
                {
                    action: "registration.phone_repair",
                    status: "success",
                    source: "script",
                    actorUid: null,
                    actorGlobalId: null,
                    entityType: "registration",
                    entityId: registration.id,
                    tournamentId: options.tournamentId,
                    operationId: options.repairId,
                    changedFields: ["phone_number", "updated_at"],
                },
                now,
            );
            return "updated";
        });
        report.records[result] ??= [];
        report.records[result].push(snapshot.id);
    }
    return report;
};
