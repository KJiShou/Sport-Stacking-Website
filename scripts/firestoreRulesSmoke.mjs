const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const projectId = process.env.GCLOUD_PROJECT ?? "demo-observability";
const baseUrl = `http://${emulatorHost}/v1/projects/${projectId}/databases/(default)/documents`;
const suffix = `observability-${Date.now()}`;

const write = async (collection, id, fields) =>
    fetch(`${baseUrl}/${collection}/${id}`, {
        method: "PATCH",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({fields}),
    });

const adminWrite = async (collection, id, fields) =>
    fetch(`${baseUrl}/${collection}/${id}`, {
        method: "PATCH",
        headers: {authorization: "Bearer owner", "content-type": "application/json"},
        body: JSON.stringify({fields}),
    });

const read = async (collection, id) => fetch(`${baseUrl}/${collection}/${id}`);

const deniedCollections = [
    "audit_logs",
    "client_error_rate_limits",
    "profile_identity_keys",
    "registration_unique_keys",
    "team_import_keys",
    "retired_global_ids",
    "repair_manifests",
];
for (const collection of deniedCollections) {
    const response = await write(collection, suffix, {probe: {stringValue: "rules-test"}});
    if (response.status !== 403) {
        throw new Error(`${collection} should reject client writes, received HTTP ${response.status}: ${await response.text()}`);
    }
    const readResponse = await read(collection, suffix);
    if (readResponse.status !== 403) {
        throw new Error(
            `${collection} should reject client reads, received HTTP ${readResponse.status}: ${await readResponse.text()}`,
        );
    }
}

const legacyResponse = await write("users", suffix, {probe: {stringValue: "rules-test"}});
if (!legacyResponse.ok) {
    throw new Error(
        `Legacy collection behavior changed unexpectedly: HTTP ${legacyResponse.status}: ${await legacyResponse.text()}`,
    );
}

await fetch(`${baseUrl}/users/${suffix}`, {method: "DELETE"});

const teamsWriteResponse = await write("teams", suffix, {probe: {stringValue: "rules-test"}});
if (teamsWriteResponse.status !== 403) {
    throw new Error(`Teams should keep rejecting client writes, received HTTP ${teamsWriteResponse.status}`);
}
const teamsReadResponse = await read("teams", suffix);
if (teamsReadResponse.status === 403) {
    throw new Error("Teams should keep allowing client reads");
}

const clientControlResponse = await write("system_config", "write_control", {writes_enabled: {booleanValue: false}});
if (clientControlResponse.status !== 403) {
    throw new Error(`Clients must not change write control, received HTTP ${clientControlResponse.status}`);
}
const disableResponse = await adminWrite("system_config", "write_control", {
    writes_enabled: {booleanValue: false},
    allowed_operations: {arrayValue: {values: [{stringValue: "tournament.import:qzhR8w2Zs7MNUtlycL9N"}]}},
});
if (!disableResponse.ok) {
    throw new Error(`Failed to set emulator maintenance state: HTTP ${disableResponse.status}: ${await disableResponse.text()}`);
}
const blockedLegacyResponse = await write("users", `${suffix}-blocked`, {probe: {stringValue: "rules-test"}});
if (blockedLegacyResponse.status !== 403) {
    throw new Error(`Maintenance should reject ordinary client writes, received HTTP ${blockedLegacyResponse.status}`);
}
const enableResponse = await adminWrite("system_config", "write_control", {writes_enabled: {booleanValue: true}});
if (!enableResponse.ok) {
    throw new Error(`Failed to restore emulator writes: HTTP ${enableResponse.status}: ${await enableResponse.text()}`);
}
const restoredLegacyResponse = await write("users", `${suffix}-restored`, {probe: {stringValue: "rules-test"}});
if (!restoredLegacyResponse.ok) {
    throw new Error(`Writes did not recover after maintenance: HTTP ${restoredLegacyResponse.status}`);
}

console.info("Firestore maintenance and server-only collection rules smoke test passed");
