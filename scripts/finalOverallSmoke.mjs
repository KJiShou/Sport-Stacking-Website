import assert from "node:assert/strict";
import {rm, writeFile} from "node:fs/promises";
import {build} from "esbuild";
import {initializeApp} from "firebase/app";
import {collection, connectFirestoreEmulator, doc, getDocs, getFirestore, setDoc, terminate} from "firebase/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error("Run this test with the Firestore emulator; production is never used.");
const projectId = "demo-final-overall";
const db = getFirestore(initializeApp({projectId}));
const [hostname, port] = host.split(":");
connectFirestoreEmulator(db, hostname, Number(port));
const bundle = new URL(".final-score-test-bundle.mjs", import.meta.url);
try {
    const compiled = await build({
        entryPoints: ["src/services/firebase/finalScoreService.ts"],
        bundle: true,
        platform: "node",
        format: "esm",
        external: ["firebase/*"],
        write: false,
    });
    await writeFile(bundle, compiled.outputFiles[0].text);
    const {saveFinalIndividualScores: save} = await import(bundle.href);
    const base = {
        id: "",
        tournament_id: `test-${Date.now()}`,
        event_id: "individual",
        event: "Individual",
        participant_global_id: "00170",
        participant_id: "nicholas",
        participant_name: "Nicholas Tong",
        gender: "Male",
        classification: "intermediate",
        status: "submitted",
        submitted_at: new Date().toISOString(),
    };
    const score = (code, time, extra = {}) => ({
        ...base,
        code,
        best_time: time,
        try1: time,
        try2: 99.999,
        try3: 99.999,
        ...extra,
    });
    const overalls = async () => (await getDocs(collection(db, "overall_records"))).docs.map((snapshot) => snapshot.data());
    // Previously saved random-ID scores must be read even when absent from the modal.
    await setDoc(doc(db, "records", "legacy-three"), score("3-3-3", 1.925, {id: "legacy-three"}));
    await save(db, [score("3-6-3", 2.32)]);
    assert.equal((await overalls()).length, 0);
    await save(db, [score("Cycle", 7.16)]);
    assert.equal((await overalls())[0].overall_time, 11.405);
    await save(db, [score("Cycle", 7.16)]);
    assert.equal((await overalls()).length, 1, "retries must not duplicate Overall");
    await save(db, [score("3-3-3", 1.8)]);
    assert.equal((await overalls())[0].overall_time, 11.28);
    assert.equal((await getDocs(collection(db, "records"))).size, 3, "legacy records must be reused");
    // Different rounds and events must not borrow the other group's scores.
    await save(db, [score("Cycle", 6, {classification: "advance"})]);
    await save(db, [score("Cycle", 6, {event_id: "open", event: "Open Age Individual"})]);
    assert.equal((await overalls()).length, 1);
    // Concurrent independent judges must eventually create one complete Overall.
    await Promise.all(
        [
            ["3-3-3", 2],
            ["3-6-3", 3],
            ["Cycle", 8],
        ].map(([code, time]) =>
            save(db, [score(code, time, {participant_global_id: "concurrent", participant_id: "concurrent"})]),
        ),
    );
    const concurrent = (await overalls()).filter((record) => record.participant_global_id === "concurrent");
    assert.equal(concurrent.length, 1);
    assert.equal(concurrent[0].overall_time, 13);
    // A rejected transaction must leave both the individual and Overall unchanged.
    const controlUrl = `http://${host}/v1/projects/${projectId}/databases/(default)/documents/system_config/write_control`;
    const response = await fetch(controlUrl, {
        method: "PATCH",
        headers: {authorization: "Bearer owner", "content-type": "application/json"},
        body: JSON.stringify({fields: {writes_enabled: {booleanValue: false}}}),
    });
    assert.equal(response.ok, true);
    try {
        await assert.rejects(save(db, [score("Cycle", 5)]));
        assert.equal((await overalls()).find((record) => record.participant_global_id === "00170").overall_time, 11.28);
        const cycle = (await getDocs(collection(db, "records"))).docs
            .map((snapshot) => snapshot.data())
            .find(
                (record) =>
                    record.code === "Cycle" &&
                    record.participant_global_id === "00170" &&
                    record.classification === "intermediate" &&
                    record.event_id === "individual",
            );
        assert.equal(cycle.best_time, 7.16);
    } finally {
        await fetch(controlUrl, {method: "DELETE", headers: {authorization: "Bearer owner"}});
    }
    console.info(
        "Final Overall smoke tests passed: stale modal, partial scores, edits, retries, isolation, concurrency, rollback.",
    );
} finally {
    await terminate(db);
    await rm(bundle, {force: true});
}
