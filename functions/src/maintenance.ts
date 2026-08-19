import {type Firestore, Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

export const MAINTENANCE_DOCUMENT = "system_config/write_control";

export type MaintenanceState = {
    writes_enabled: boolean;
    message: string;
    allowed_operations: string[];
    updated_at?: Timestamp;
    updated_by?: string;
};

/**
 * A missing control document means normal operation. The document itself is
 * only writable by an operator using Admin SDK, so clients cannot bypass a
 * maintenance window by changing this state.
 */
export const readMaintenanceState = async (database: Firestore): Promise<MaintenanceState> => {
    const snapshot = await database.doc(MAINTENANCE_DOCUMENT).get();
    const data = snapshot.data() ?? {};
    return {
        writes_enabled: data.writes_enabled !== false,
        message: typeof data.message === "string" && data.message.trim() ? data.message.trim() : "Maintenance in progress.",
        allowed_operations: Array.isArray(data.allowed_operations)
            ? data.allowed_operations.filter((value): value is string => typeof value === "string")
            : [],
        ...(data.updated_at instanceof Timestamp ? {updated_at: data.updated_at} : {}),
        ...(typeof data.updated_by === "string" ? {updated_by: data.updated_by} : {}),
    };
};

export const maintenanceAllowsOperation = (state: MaintenanceState, operation?: string): boolean =>
    state.writes_enabled || Boolean(operation && state.allowed_operations.includes(operation));

export const assertWritesEnabled = async (database: Firestore, operation?: string): Promise<void> => {
    const state = await readMaintenanceState(database);
    if (!maintenanceAllowsOperation(state, operation)) {
        throw new HttpsError("failed-precondition", state.message, {code: "MAINTENANCE_READ_ONLY"});
    }
};
