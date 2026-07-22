import {execFileSync} from "node:child_process";

const PROJECT_ID = "sport-stacking-website";
const SOURCE_DATABASE_ID = "develop2";
const DESTINATION_DATABASE_ID = "(default)";
const SELECTED_GLOBAL_IDS = ["00510", "00511", "00512", "00513", "00520"] as const;
const SELECTED_PROFILE_UIDS: Record<SelectedGlobalId, string> = {
    "00510": "hocpkSlSHzo43nYRzgYn",
    "00511": "qK2rYwGklV5loTV9Xs0Z",
    "00512": "rKTL9F3a703wPX5YmTEO",
    "00513": "ZEM6xOx3WHoSMZv4kNkM",
    "00520": "G4y7eTF3IbRqgaNE0VigkUaMff03",
};
const ROOT_COLLECTIONS = [
    "counters",
    "double_recruitment",
    "events",
    "finalists",
    "homeCarousel",
    "import_batches",
    "individual_recruitment",
    "notifications",
    "overall_records",
    "passwordResetEmailThrottle",
    "prelim_records",
    "profile_ownership_audits",
    "profiles",
    "records",
    "registrations",
    "team_recruitment",
    "teams",
    "tournaments",
    "user_tournament_history",
    "users",
    "verification_requests",
] as const;

type SelectedGlobalId = (typeof SELECTED_GLOBAL_IDS)[number];
type FirestoreFields = Record<string, FirestoreValue>;
type FirestoreValue = {
    stringValue?: string;
    mapValue?: {fields?: FirestoreFields};
    arrayValue?: {values?: FirestoreValue[]};
    [key: string]: unknown;
};
type FirestoreDocument = {name: string; fields?: FirestoreFields; updateTime?: string};
type SourceProfile = {uid: string; oldGlobalId: SelectedGlobalId; document: FirestoreDocument};
type MigrationCandidate = {collectionId: string; sourceId: string; targetId: string; fields: FirestoreFields};

const apply = process.argv.slice(2).includes("--apply");
const apiBase = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases`;

const gcloudAccessToken = execFileSync("gcloud", ["auth", "print-access-token"], {encoding: "utf8"}).trim();

const request = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(url, {
        ...init,
        headers: {Authorization: `Bearer ${gcloudAccessToken}`, "Content-Type": "application/json", ...init.headers},
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    return (await response.json()) as T;
};

const databaseDocumentsUrl = (databaseId: string): string => `${apiBase}/${databaseId}/documents`;
const documentName = (databaseId: string, collectionId: string, documentId: string): string =>
    `projects/${PROJECT_ID}/databases/${databaseId}/documents/${collectionId}/${documentId}`;
const documentUrl = (databaseId: string, collectionId: string, documentId: string): string =>
    `${databaseDocumentsUrl(databaseId)}/${encodeURIComponent(collectionId)}/${encodeURIComponent(documentId)}`;
const documentIdFromName = (name: string): string => {
    const segments = name.split("/");
    return segments[segments.length - 1] ?? "";
};

const getDocument = async (databaseId: string, collectionId: string, documentId: string): Promise<FirestoreDocument | null> => {
    const response = await fetch(documentUrl(databaseId, collectionId, documentId), {
        headers: {Authorization: `Bearer ${gcloudAccessToken}`},
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    return (await response.json()) as FirestoreDocument;
};

const queryCollection = async (databaseId: string, collectionId: string): Promise<FirestoreDocument[]> => {
    const rows = await request<Array<{document?: FirestoreDocument}>>(`${databaseDocumentsUrl(databaseId)}:runQuery`, {
        method: "POST",
        body: JSON.stringify({structuredQuery: {from: [{collectionId}]}}),
    });
    return rows.flatMap((row) => (row.document ? [row.document] : []));
};

const nextGlobalIdNumber = (current: number): number => {
    let next = current + 1;
    while (String(next).includes("4")) next += 1;
    return next;
};
const formatGlobalId = (value: number): string => String(value).padStart(5, "0");

const rewriteValue = (value: FirestoreValue, globalIdMap: ReadonlyMap<string, string>): FirestoreValue => {
    if (typeof value.stringValue === "string") return {...value, stringValue: globalIdMap.get(value.stringValue) ?? value.stringValue};
    if (value.arrayValue?.values) return {...value, arrayValue: {values: value.arrayValue.values.map((item) => rewriteValue(item, globalIdMap))}};
    if (value.mapValue?.fields) {
        return {
            ...value,
            mapValue: {
                fields: Object.fromEntries(
                    Object.entries(value.mapValue.fields).map(([key, item]) => [key, rewriteValue(item, globalIdMap)]),
                ),
            },
        };
    }
    return value;
};

const rewriteFields = (fields: FirestoreFields, globalIdMap: ReadonlyMap<string, string>): FirestoreFields =>
    Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, rewriteValue(value, globalIdMap)]));

const containsSelectedReference = (value: FirestoreValue, oldGlobalIds: ReadonlySet<string>, sourceUids: ReadonlySet<string>): boolean => {
    if (typeof value.stringValue === "string") return oldGlobalIds.has(value.stringValue) || sourceUids.has(value.stringValue);
    if (value.arrayValue?.values) return value.arrayValue.values.some((item) => containsSelectedReference(item, oldGlobalIds, sourceUids));
    if (value.mapValue?.fields) return Object.values(value.mapValue.fields).some((item) => containsSelectedReference(item, oldGlobalIds, sourceUids));
    return false;
};

const rewriteDocumentId = (documentId: string, globalIdMap: ReadonlyMap<string, string>): string => {
    let nextId = documentId;
    for (const [oldGlobalId, newGlobalId] of globalIdMap) nextId = nextId.split(oldGlobalId).join(newGlobalId);
    return nextId;
};

const getSelectedProfiles = async (): Promise<SourceProfile[]> =>
    Promise.all(
        SELECTED_GLOBAL_IDS.map(async (oldGlobalId) => {
            const uid = SELECTED_PROFILE_UIDS[oldGlobalId];
            const document = await getDocument(SOURCE_DATABASE_ID, "users", uid);
            if (!document) throw new Error(`Selected develop2 user document ${uid} does not exist.`);
            if (document.fields?.global_id?.stringValue !== oldGlobalId) {
                throw new Error(`Selected develop2 user ${uid} no longer has Global ID ${oldGlobalId}.`);
            }
            return {uid, oldGlobalId, document};
        }),
    );

const getCounter = async (): Promise<{count: number; updateTime: string}> => {
    const document = await getDocument(DESTINATION_DATABASE_ID, "counters", "userCounter");
    const count = document?.fields?.count?.integerValue;
    if (!document?.updateTime || typeof count !== "string") throw new Error("default counters/userCounter is invalid.");
    return {count: Number.parseInt(count, 10), updateTime: document.updateTime};
};

const planGlobalIds = (counter: number): Map<string, string> => {
    let next = counter;
    const globalIdMap = new Map<string, string>();
    for (const oldGlobalId of SELECTED_GLOBAL_IDS) {
        next = nextGlobalIdNumber(next);
        globalIdMap.set(oldGlobalId, formatGlobalId(next));
    }
    return globalIdMap;
};

const buildCandidates = async (profiles: SourceProfile[], globalIdMap: ReadonlyMap<string, string>): Promise<MigrationCandidate[]> => {
    const oldGlobalIds = new Set(globalIdMap.keys());
    const sourceUids = new Set(profiles.map((profile) => profile.uid));
    const snapshots = await Promise.all(ROOT_COLLECTIONS.filter((collectionId) => collectionId !== "users" && collectionId !== "counters").map(async (collectionId) => [collectionId, await queryCollection(SOURCE_DATABASE_ID, collectionId)] as const));
    const candidates: MigrationCandidate[] = [];
    for (const [collectionId, documents] of snapshots) {
        for (const document of documents) {
            const sourceId = documentIdFromName(document.name);
            const targetId = rewriteDocumentId(sourceId, globalIdMap);
            const fields = document.fields ?? {};
            if (targetId === sourceId && !Object.values(fields).some((value) => containsSelectedReference(value, oldGlobalIds, sourceUids))) continue;
            candidates.push({collectionId, sourceId, targetId, fields: rewriteFields(fields, globalIdMap)});
        }
    }
    const keys = new Set<string>();
    for (const candidate of candidates) {
        const key = `${candidate.collectionId}/${candidate.targetId}`;
        if (keys.has(key)) throw new Error(`Multiple source documents resolve to ${key}.`);
        keys.add(key);
    }
    return candidates;
};

const findExistingTargets = async (profiles: SourceProfile[], candidates: MigrationCandidate[]): Promise<string[]> => {
    const checks = [
        ...profiles.map((profile) => ["users", profile.uid] as const),
        ...candidates.map((candidate) => [candidate.collectionId, candidate.targetId] as const),
    ];
    const documents = await Promise.all(checks.map(([collectionId, documentId]) => getDocument(DESTINATION_DATABASE_ID, collectionId, documentId)));
    return documents.flatMap((document, index) => (document ? [`${checks[index][0]}/${checks[index][1]}`] : []));
};

const summarizeCandidates = (candidates: MigrationCandidate[]): Record<string, number> =>
    candidates.reduce<Record<string, number>>((summary, candidate) => {
        summary[candidate.collectionId] = (summary[candidate.collectionId] ?? 0) + 1;
        return summary;
    }, {});

const candidatePath = (candidate: MigrationCandidate): string => `${candidate.collectionId}/${candidate.targetId}`;

const commit = async (writes: unknown[], transaction?: string): Promise<void> => {
    await request(`${databaseDocumentsUrl(DESTINATION_DATABASE_ID)}:commit`, {
        method: "POST",
        body: JSON.stringify({writes, ...(transaction ? {transaction} : {})}),
    });
};

const createProfilesAndAdvanceCounter = async (profiles: SourceProfile[]): Promise<Map<string, string>> => {
    const {transaction} = await request<{transaction: string}>(`${databaseDocumentsUrl(DESTINATION_DATABASE_ID)}:beginTransaction`, {
        method: "POST",
        body: "{}",
    });
    const counterName = documentName(DESTINATION_DATABASE_ID, "counters", "userCounter");
    const reads = await request<Array<{found?: FirestoreDocument}>>(`${databaseDocumentsUrl(DESTINATION_DATABASE_ID)}:batchGet`, {
        method: "POST",
        body: JSON.stringify({documents: [counterName], transaction}),
    });
    const counterDocument = reads[0]?.found;
    const counterRaw = counterDocument?.fields?.count?.integerValue;
    if (!counterDocument?.updateTime || typeof counterRaw !== "string") throw new Error("Unable to read default userCounter in transaction.");
    const globalIdMap = planGlobalIds(Number.parseInt(counterRaw, 10));
    const lastGlobalId = globalIdMap.get(SELECTED_GLOBAL_IDS[SELECTED_GLOBAL_IDS.length - 1]);
    if (!lastGlobalId) throw new Error("Failed to allocate Global IDs.");

    const writes = [
        ...profiles.map((profile) => ({
            update: {
                name: documentName(DESTINATION_DATABASE_ID, "users", profile.uid),
                fields: {
                    ...rewriteFields(profile.document.fields ?? {}, globalIdMap),
                    global_id: {stringValue: globalIdMap.get(profile.oldGlobalId)},
                    updated_at: {timestampValue: new Date().toISOString()},
                },
            },
            currentDocument: {exists: false},
        })),
        {
            update: {name: counterName, fields: {count: {integerValue: lastGlobalId.replace(/^0+/, "") || "0"}}},
            currentDocument: {updateTime: counterDocument.updateTime},
        },
    ];
    await commit(writes, transaction);
    return globalIdMap;
};

const createCandidates = async (candidates: MigrationCandidate[]): Promise<void> => {
    for (let index = 0; index < candidates.length; index += 400) {
        await commit(
            candidates.slice(index, index + 400).map((candidate) => ({
                update: {name: documentName(DESTINATION_DATABASE_ID, candidate.collectionId, candidate.targetId), fields: candidate.fields},
                currentDocument: {exists: false},
            })),
        );
    }
};

const main = async (): Promise<void> => {
    const [profiles, counter] = await Promise.all([getSelectedProfiles(), getCounter()]);
    const previewGlobalIdMap = planGlobalIds(counter.count);
    const previewCandidates = await buildCandidates(profiles, previewGlobalIdMap);
    const [existingProfileTargets, existingCandidateTargets] = await Promise.all([
        findExistingTargets(profiles, []),
        findExistingTargets([], previewCandidates),
    ]);
    const existingCandidateTargetSet = new Set(existingCandidateTargets);
    const previewCandidatesToCreate = previewCandidates.filter((candidate) => !existingCandidateTargetSet.has(candidatePath(candidate)));
    console.info(JSON.stringify({mode: apply ? "apply" : "dry-run", counterBefore: counter.count, selectedProfiles: profiles.map((profile) => ({uid: profile.uid, name: profile.document.fields?.name?.stringValue ?? "", oldGlobalId: profile.oldGlobalId, newGlobalId: previewGlobalIdMap.get(profile.oldGlobalId)})), candidateCount: previewCandidates.length, candidatesToCreate: previewCandidatesToCreate.length, candidatesByCollection: summarizeCandidates(previewCandidatesToCreate), skippedExistingTargets: existingCandidateTargets, existingProfileTargets}, null, 2));
    if (existingProfileTargets.length > 0) throw new Error("Migration aborted because one or more destination user profiles already exist.");
    if (!apply) return;

    const actualGlobalIdMap = await createProfilesAndAdvanceCounter(profiles);
    const candidates = await buildCandidates(profiles, actualGlobalIdMap);
    const existingCandidateTargetsAfterProfileMigration = await findExistingTargets([], candidates);
    const existingCandidateTargetSetAfterProfileMigration = new Set(existingCandidateTargetsAfterProfileMigration);
    const candidatesToCreate = candidates.filter((candidate) => !existingCandidateTargetSetAfterProfileMigration.has(candidatePath(candidate)));
    await createCandidates(candidatesToCreate);
    console.info(JSON.stringify({status: "complete", globalIdMap: Object.fromEntries(actualGlobalIdMap), counterAfter: Number.parseInt(actualGlobalIdMap.get(SELECTED_GLOBAL_IDS[SELECTED_GLOBAL_IDS.length - 1]) ?? "0", 10), candidatesCreated: candidatesToCreate.length, candidatesByCollection: summarizeCandidates(candidatesToCreate), skippedExistingTargets: existingCandidateTargetsAfterProfileMigration}, null, 2));
};

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
