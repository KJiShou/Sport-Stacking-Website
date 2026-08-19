import {strict as assert} from "node:assert";
import {describe, it} from "node:test";
import type {Firestore} from "firebase-admin/firestore";
import {assertWritesEnabled, maintenanceAllowsOperation, readMaintenanceState} from "../maintenance.js";

const databaseWith = (data: Record<string, unknown> | undefined): Firestore =>
    ({
        doc: () => ({
            get: async () => ({data: () => data}),
        }),
    }) as unknown as Firestore;

describe("maintenance write guard", () => {
    it("keeps writes enabled when the control document is missing", async () => {
        const state = await readMaintenanceState(databaseWith(undefined));
        assert.equal(state.writes_enabled, true);
        await assert.doesNotReject(() => assertWritesEnabled(databaseWith(undefined)));
    });

    it("fails closed except for an exact allowed operation", async () => {
        const database = databaseWith({
            writes_enabled: false,
            message: "Import maintenance",
            allowed_operations: ["tournament.import:qzhR8w2Zs7MNUtlycL9N"],
        });
        const state = await readMaintenanceState(database);
        assert.equal(maintenanceAllowsOperation(state), false);
        assert.equal(maintenanceAllowsOperation(state, "tournament.import:other"), false);
        assert.equal(maintenanceAllowsOperation(state, "tournament.import:qzhR8w2Zs7MNUtlycL9N"), true);
        await assert.rejects(
            () => assertWritesEnabled(database),
            (error: {code?: string}) => error.code === "failed-precondition",
        );
        await assert.doesNotReject(() => assertWritesEnabled(database, "tournament.import:qzhR8w2Zs7MNUtlycL9N"));
    });
});
