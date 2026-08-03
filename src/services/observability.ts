import {httpsCallable} from "firebase/functions";
import {auth, functions} from "./firebase/config";

export type OperationMeta = {
    operationId?: string;
    activeProfileGlobalId?: string | null;
    release?: string;
};

export type ClientErrorContext = OperationMeta & {
    route?: string;
    tournamentId?: string;
    entityType?: string;
    entityId?: string;
};

type ClientErrorInput = ClientErrorContext & {
    message: string;
    stack?: string;
};

const MAX_MESSAGE_LENGTH = 1_024;
const MAX_STACK_LENGTH = 8_192;
const DEDUPE_WINDOW_MS = 60_000;
const fingerprints = new Map<string, number>();

const release = import.meta.env.VITE_APP_RELEASE?.trim() || import.meta.env.VITE_RELEASE_SHA?.trim() || "development";

const truncate = (value: string, maxLength: number): string =>
    value.length > maxLength ? `${value.slice(0, Math.max(0, maxLength - 1))}…` : value;

const asError = (value: unknown): {message: string; stack: string} => {
    if (value instanceof Error) return {message: value.message, stack: value.stack ?? ""};
    if (typeof value === "string") return {message: value, stack: ""};
    if (value && typeof value === "object") {
        const candidate = value as {message?: unknown; stack?: unknown};
        return {
            message: typeof candidate.message === "string" ? candidate.message : "Unknown client error",
            stack: typeof candidate.stack === "string" ? candidate.stack : "",
        };
    }
    return {message: "Unknown client error", stack: ""};
};

const fingerprint = (message: string, stack: string, route: string): string =>
    `${message}\n${stack.split("\n").slice(0, 3).join("\n")}\n${route}`;

export const createOperationId = (): string => {
    return crypto.randomUUID();
};

export const captureClientError = async (value: unknown, context: ClientErrorContext = {}): Promise<void> => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;

    const error = asError(value);
    const route = context.route ?? (typeof window !== "undefined" ? window.location.pathname : "unknown");
    const key = fingerprint(error.message, error.stack, route);
    const now = Date.now();
    for (const [knownFingerprint, timestamp] of fingerprints) {
        if (now - timestamp >= DEDUPE_WINDOW_MS) fingerprints.delete(knownFingerprint);
    }
    const previous = fingerprints.get(key) ?? 0;
    if (now - previous < DEDUPE_WINDOW_MS) return;
    fingerprints.set(key, now);

    const payload: ClientErrorInput = {
        message: truncate(error.message, MAX_MESSAGE_LENGTH),
        stack: truncate(error.stack, MAX_STACK_LENGTH),
        route: truncate(route, 512),
        operationId: context.operationId ?? createOperationId(),
        release: context.release ?? release,
        ...(context.activeProfileGlobalId ? {activeProfileGlobalId: context.activeProfileGlobalId} : {}),
        ...(context.tournamentId ? {tournamentId: context.tournamentId} : {}),
        ...(context.entityType ? {entityType: context.entityType} : {}),
        ...(context.entityId ? {entityId: context.entityId} : {}),
    };

    try {
        const callable = httpsCallable<ClientErrorInput, {accepted: boolean}>(functions, "reportClientError");
        await callable(payload);
    } catch (reportingError) {
        if (import.meta.env.DEV) console.warn("Failed to report client error", reportingError);
    }
};

export const initializeClientErrorHandlers = (): (() => void) => {
    if (typeof window === "undefined") return () => undefined;

    const handleError = (event: ErrorEvent) => {
        void captureClientError(event.error ?? event.message);
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
        void captureClientError(event.reason);
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
        window.removeEventListener("error", handleError);
        window.removeEventListener("unhandledrejection", handleRejection);
    };
};

export const getRelease = (): string => release;
