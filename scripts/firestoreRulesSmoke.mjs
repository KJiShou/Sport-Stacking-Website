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

const read = async (collection, id) => fetch(`${baseUrl}/${collection}/${id}`);

const deniedCollections = ["audit_logs", "client_error_rate_limits"];
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
console.info("Firestore observability rules smoke test passed");
