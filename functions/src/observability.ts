import {randomUUID} from "node:crypto";
import {type Firestore, Timestamp, type Transaction, getFirestore} from "firebase-admin/firestore";
import {type LogSeverity, info as cloudInfo, warn as cloudWarn, write as writeLog} from "firebase-functions/logger";

export type OperationMeta = {
    operationId?: unknown;
    activeProfileGlobalId?: unknown;
    release?: unknown;
};

export type ActorContext = {
    actorUid: string | null;
    actorGlobalId: string | null;
    actorGlobalIds?: string[];
};

/**
 * Firestore auth-context events do not expose a `user` auth type. Authenticated
 * application writes are represented as `unknown` with the principal ID; all
 * other auth types are non-user, system, or unauthenticated writes.
 */
export const shouldAuditFirestoreUserWrite = (authType: string, authId?: string): boolean =>
    authType === "unknown" && typeof authId === "string" && authId.trim().length > 0;

export type AuditInput = ActorContext & {
    action: string;
    status: "success" | "failure" | "warning";
    entityType: string;
    entityId: string;
    tournamentId?: string | null;
    changedFields?: string[];
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
    operationId?: string | null;
    source: "callable" | "firestore-trigger" | "script";
};

const MAX_MESSAGE_LENGTH = 1_024;
const MAX_STACK_LENGTH = 8_192;
const AUDIT_TTL_MS = 365 * 24 * 60 * 60 * 1_000;
const RELEASE = process.env.RELEASE_SHA ?? process.env.K_REVISION ?? "unknown";
const SENSITIVE_KEY_PATTERN = /(email|phone|name|ic|passport|token|secret|password|proof|video_url|image_url|address)/i;

const redactSensitiveText = (value: string): string =>
    value
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
        .replace(/\b(?:\+?\d[\d\s().-]{7,}\d)\b/g, "[redacted-phone]")
        .replace(/\bBearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted-token]")
        .replace(/\b(token|secret|password|authorization)=([^\s&]+)/gi, "$1=[redacted]");

const truncate = (value: string, maxLength: number): string =>
    (() => {
        const redacted = redactSensitiveText(value);
        return redacted.length > maxLength ? `${redacted.slice(0, Math.max(0, maxLength - 1))}…` : redacted;
    })();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Timestamp);

const safeValue = (value: unknown, depth = 0, stringLimit = MAX_MESSAGE_LENGTH): unknown => {
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return truncate(value, stringLimit);
    if (value instanceof Timestamp) return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (depth >= 3) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 100).map((entry) => safeValue(entry, depth + 1));
    if (isPlainObject(value)) {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([key]) => key === "errorName" || !SENSITIVE_KEY_PATTERN.test(key))
                .slice(0, 50)
                .map(([key, entry]) => [key, safeValue(entry, depth + 1, key === "stack" ? MAX_STACK_LENGTH : stringLimit)]),
        );
    }
    return String(value);
};

const cleanFields = (fields: Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(
        Object.entries(fields)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => [key, safeValue(value, 0, key === "stack" ? MAX_STACK_LENGTH : MAX_MESSAGE_LENGTH)]),
    );

export const createOperationId = (): string => randomUUID();

export const normalizeOperationMeta = (
    input: unknown,
): {operationId: string; activeProfileGlobalId: string | null; release: string} => {
    const data = input && typeof input === "object" ? (input as OperationMeta) : {};
    const operationId =
        typeof data.operationId === "string" && data.operationId.trim().length > 0 && data.operationId.length <= 128
            ? data.operationId.trim()
            : createOperationId();
    const activeProfileGlobalId =
        typeof data.activeProfileGlobalId === "string" && data.activeProfileGlobalId.trim().length <= 64
            ? data.activeProfileGlobalId.trim() || null
            : null;
    const release =
        typeof data.release === "string" && data.release.trim().length > 0 && data.release.trim().length <= 128
            ? data.release.trim()
            : RELEASE;
    return {operationId, activeProfileGlobalId, release};
};

const writeStructured = (severity: LogSeverity, event: string, fields: Record<string, unknown>): void => {
    const payload = cleanFields({
        event,
        status: fields.status ?? (severity === "ERROR" ? "failure" : "success"),
        operationId: fields.operationId ?? createOperationId(),
        elapsedMs: fields.elapsedMs ?? null,
        ...fields,
        // The service release is trusted server metadata. Client-provided
        // releases are carried separately as clientRelease.
        release: RELEASE,
    });
    writeLog({severity, message: event, ...payload});
};

export const logInfo = (event: string, fields: Record<string, unknown> = {}): void => {
    cloudInfo(
        event,
        cleanFields({
            event,
            status: fields.status ?? "success",
            operationId: fields.operationId ?? createOperationId(),
            elapsedMs: fields.elapsedMs ?? null,
            ...fields,
            release: RELEASE,
        }),
    );
};

export const logWarning = (event: string, fields: Record<string, unknown> = {}): void => {
    cloudWarn(
        event,
        cleanFields({
            event,
            status: fields.status ?? "warning",
            operationId: fields.operationId ?? createOperationId(),
            elapsedMs: fields.elapsedMs ?? null,
            ...fields,
            release: RELEASE,
        }),
    );
};

export const logError = (event: string, error: unknown, fields: Record<string, unknown> = {}): void => {
    const errorValue = error instanceof Error ? error : new Error(String(error));
    writeStructured("ERROR", event, {
        ...fields,
        errorName: errorValue.name,
        errorMessage: truncate(errorValue.message, MAX_MESSAGE_LENGTH),
        stack: truncate(errorValue.stack ?? "", MAX_STACK_LENGTH),
    });
};

export const logClientError = (message: string, stack: string, fields: Record<string, unknown> = {}): void => {
    writeStructured("ERROR", "client.error", {
        ...fields,
        errorName: "ClientError",
        errorMessage: truncate(message, MAX_MESSAGE_LENGTH),
        stack: truncate(stack, MAX_STACK_LENGTH),
    });
};

export const buildAuditDiff = (
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    allowedFields: readonly string[],
): Pick<AuditInput, "changedFields" | "before" | "after"> => {
    const changedFields: string[] = [];
    const beforeSafe: Record<string, unknown> = {};
    const afterSafe: Record<string, unknown> = {};
    for (const field of allowedFields) {
        const beforeValue = before?.[field];
        const afterValue = after?.[field];
        if (JSON.stringify(safeValue(beforeValue)) === JSON.stringify(safeValue(afterValue))) continue;
        changedFields.push(field);
        if (beforeValue !== undefined) beforeSafe[field] = safeValue(beforeValue);
        if (afterValue !== undefined) afterSafe[field] = safeValue(afterValue);
    }
    return {
        changedFields,
        before: Object.keys(beforeSafe).length ? beforeSafe : null,
        after: Object.keys(afterSafe).length ? afterSafe : null,
    };
};

const profileBelongsToUid = (docId: string, data: Record<string, unknown>, uid: string): boolean => {
    const owners = data.owner_uids;
    return Array.isArray(owners) ? owners.includes(uid) : docId === uid;
};

export const resolveActorContext = async (
    db: Firestore,
    uid: string | null | undefined,
    requestedGlobalId?: string | null,
    tournamentId?: string | null,
): Promise<ActorContext> => {
    if (!uid) return {actorUid: null, actorGlobalId: null};
    const [owned, legacy, tournament] = await Promise.all([
        db.collection("users").where("owner_uids", "array-contains", uid).get(),
        db.collection("users").doc(uid).get(),
        tournamentId ? db.collection("tournaments").doc(tournamentId).get() : Promise.resolve(null),
    ]);
    const profiles = new Map<string, Record<string, unknown>>();
    for (const snapshot of owned.docs) profiles.set(snapshot.id, snapshot.data() as Record<string, unknown>);
    if (legacy.exists && profileBelongsToUid(legacy.id, legacy.data() as Record<string, unknown>, uid)) {
        profiles.set(legacy.id, legacy.data() as Record<string, unknown>);
    }
    const tournamentData = tournament?.data() as {editor?: string; recorder?: string} | undefined;
    const activeProfiles = [...profiles.values()].filter((profile) => {
        const accountStatus = typeof profile.account_status === "string" ? profile.account_status.toLowerCase() : "";
        return !["inactive", "disabled", "suspended", "deleted", "deactivated", "archived"].includes(accountStatus);
    });
    const privilegedProfiles = activeProfiles.filter((profile) => {
        const globalId = typeof profile.global_id === "string" ? profile.global_id.trim() : "";
        const roles = (profile.roles ?? {}) as {
            modify_admin?: boolean;
            edit_tournament?: boolean;
            record_tournament?: boolean;
            verify_record?: boolean;
        };
        return (
            globalId === requestedGlobalId ||
            roles.modify_admin === true ||
            roles.edit_tournament === true ||
            roles.record_tournament === true ||
            roles.verify_record === true ||
            globalId === tournamentData?.editor ||
            globalId === tournamentData?.recorder
        );
    });
    // Prefer a profile that is relevant to the operation. If the owner has no
    // role flags (the common registrant path), fall back to all profiles owned
    // by the UID so direct browser writes still identify the actor by Global ID.
    const candidateProfiles = privilegedProfiles.length > 0 ? privilegedProfiles : activeProfiles;
    const globalIds = Array.from(
        new Set(
            candidateProfiles
                .map((profile) => (typeof profile.global_id === "string" ? profile.global_id.trim() : ""))
                .filter(Boolean),
        ),
    );
    const selected =
        requestedGlobalId && globalIds.includes(requestedGlobalId)
            ? requestedGlobalId
            : globalIds.length === 1
              ? globalIds[0]
              : null;
    return {actorUid: uid, actorGlobalId: selected, ...(globalIds.length > 1 ? {actorGlobalIds: globalIds} : {})};
};

export const buildAuditRecord = (input: AuditInput, now = Timestamp.now()): Record<string, unknown> => ({
    action: truncate(input.action, 128),
    status:
        input.status === "success" &&
        input.source !== "script" &&
        (!input.actorUid || (!input.actorGlobalId && !input.actorGlobalIds?.length))
            ? "warning"
            : input.status,
    actorUid: input.actorUid,
    actorGlobalId: input.actorGlobalId ? truncate(input.actorGlobalId, 64) : null,
    ...(input.actorGlobalIds
        ? {actorGlobalIds: input.actorGlobalIds.slice(0, 50).map((globalId) => truncate(globalId, 64))}
        : {}),
    entityType: truncate(input.entityType, 64),
    entityId: truncate(input.entityId, 256),
    tournamentId: input.tournamentId ? truncate(input.tournamentId, 128) : null,
    changedFields: (input.changedFields ?? []).slice(0, 100).map((field) => truncate(field, 128)),
    before: input.before ? (safeValue(input.before) as Record<string, unknown>) : null,
    after: input.after ? (safeValue(input.after) as Record<string, unknown>) : null,
    operationId: input.operationId ? truncate(input.operationId, 128) : createOperationId(),
    source: input.source,
    createdAt: now,
    expireAt: Timestamp.fromMillis(now.toMillis() + AUDIT_TTL_MS),
});

export const setAuditLogInTransaction = (
    transaction: Transaction,
    db: Firestore,
    input: AuditInput,
    now = Timestamp.now(),
): string => {
    const auditRef = db.collection("audit_logs").doc();
    transaction.create(auditRef, buildAuditRecord(input, now));
    return auditRef.id;
};

export const writeAuditLog = async (db: Firestore, input: AuditInput): Promise<string> => {
    const auditRef = db.collection("audit_logs").doc();
    await auditRef.create(buildAuditRecord(input));
    return auditRef.id;
};

export const writeAuditLogBestEffort = async (db: Firestore, input: AuditInput): Promise<string | null> => {
    try {
        return await writeAuditLog(db, input);
    } catch (error) {
        logError("audit.write_failed", error, {
            action: input.action,
            entityType: input.entityType,
            entityId: input.entityId,
            tournamentId: input.tournamentId,
            operationId: input.operationId,
        });
        return null;
    }
};

export const writeScriptAudit = async (
    db: Firestore,
    input: Omit<AuditInput, "actorUid" | "actorGlobalId" | "source">,
): Promise<string> =>
    writeAuditLog(db, {
        ...input,
        actorUid: null,
        actorGlobalId: null,
        source: "script",
    });

export const getFirestoreClient = (): Firestore => getFirestore();

export const sanitizeClientError = (value: unknown): string =>
    truncate(typeof value === "string" ? value : String(value ?? "Unknown client error"), MAX_MESSAGE_LENGTH);

export const sanitizeClientStack = (value: unknown): string => truncate(typeof value === "string" ? value : "", MAX_STACK_LENGTH);

export const safeAuditValueForTests = (value: unknown): unknown => safeValue(value);
