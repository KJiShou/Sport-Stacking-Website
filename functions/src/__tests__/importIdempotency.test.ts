import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, before, describe, it} from "node:test";
import ExcelJS from "exceljs";
import {getApps, initializeApp} from "firebase-admin/app";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import firebaseFunctionsTest from "firebase-functions-test";
import {
    type ImportAthleteInput,
    type ParsedWorkbookInput,
    buildImportPlan,
    commitIdempotentImport,
    importIdentityKey,
    nextAllowedGlobalIdNumber,
    stableChecksum,
} from "../importIdempotency.js";
import {importTournamentWorkbook} from "../index.js";

const suffix = randomUUID();
const tournamentId = `import-idempotency-${suffix}`;
const individualEventId = `individual-${suffix}`;
const cycleEventId = `cycle-${suffix}`;
const teamEventId = `team-${suffix}`;
const database = getFirestore(getApps()[0] ?? initializeApp({projectId: "sport-stacking-website-test"}));
const trackedProfileIds = new Set<string>();
const trackedGlobalIds = new Set<string>();
const testFeatures = firebaseFunctionsTest({projectId: "sport-stacking-website-test"});
const importWorkbook = testFeatures.wrap(importTournamentWorkbook);

const authContext = (uid: string) => ({
    uid,
    token: {
        aud: "sport-stacking-website-test",
        auth_time: 0,
        exp: 0,
        firebase: {identities: {}, sign_in_provider: "custom"},
        iat: 0,
        iss: "https://securetoken.google.com/sport-stacking-website-test",
        sub: uid,
        uid,
    },
    rawToken: "",
});

const callImportWorkbook = (
    uid: string,
    data: {
        tournamentId: string;
        fileBase64: string;
        mode: "preview" | "commit";
        expectedPlanChecksum?: string;
        operationId: string;
    },
): Promise<unknown> =>
    importWorkbook({
        data: {
            tournamentId: data.tournamentId,
            fileBase64: data.fileBase64,
            fileName: "import-idempotency-test.xlsx",
            mode: data.mode,
            defaultCountry: "Malaysia",
            defaultState: "Selangor",
            expectedPlanChecksum: data.expectedPlanChecksum,
            meta: {operationId: data.operationId, release: "test"},
        },
        auth: authContext(uid),
        rawRequest: {} as never,
        acceptsStreaming: false,
    });

const athlete = (name: string, birthdate: string): ImportAthleteInput => ({
    workbookKey: `NO_ID:${name}:${birthdate}`,
    name,
    identityType: "NONE",
    identityNumber: null,
    identityKey: null,
    passportCountry: null,
    birthdate: new Date(`${birthdate}T00:00:00.000Z`),
    gender: "Male",
    country: ["Malaysia", "Selangor"],
    sourceSheet: "Individual",
    sourceRow: 2,
    parentOnly: false,
});

const parsed = (
    athletes: ImportAthleteInput[],
    eventsByName: Record<string, string[]>,
    teams: ParsedWorkbookInput["teams"] = [],
): ParsedWorkbookInput => ({
    athletes: new Map(athletes.map((entry) => [entry.workbookKey, entry])),
    invalidAthleteKeys: new Set(),
    baseRosterKeys: new Set(athletes.map((entry) => entry.workbookKey)),
    registrationsByAthleteKey: new Map(
        athletes.map((entry) => [entry.workbookKey, new Set(eventsByName[entry.name] ?? [individualEventId])]),
    ),
    teams,
    rows: [],
});

const track = (entries: ImportAthleteInput[]): void => {
    for (const entry of entries) {
        if (entry.userDocId) trackedProfileIds.add(entry.userDocId);
        if (entry.globalId) trackedGlobalIds.add(entry.globalId);
    }
};

describe("idempotent tournament workbook import", () => {
    before(async () => {
        const batch = database.batch();
        batch.set(database.collection("tournaments").doc(tournamentId), {
            name: "Import Idempotency Test",
            participants: 0,
            start_date: Timestamp.fromDate(new Date("2026-11-07T00:00:00.000Z")),
            max_participants: 50,
        });
        batch.set(database.collection("events").doc(individualEventId), {
            id: individualEventId,
            tournament_id: tournamentId,
            type: "Individual",
            max_participants: 50,
        });
        batch.set(database.collection("events").doc(cycleEventId), {
            id: cycleEventId,
            tournament_id: tournamentId,
            type: "Cycle",
            codes: ["Cycle"],
            max_participants: 50,
        });
        batch.set(database.collection("events").doc(teamEventId), {
            id: teamEventId,
            tournament_id: tournamentId,
            type: "Double",
            max_participants: 50,
        });
        await batch.commit();
    });

    after(async () => {
        const batch = database.batch();
        for (const collectionName of [
            "registrations",
            "registration_unique_keys",
            "teams",
            "team_import_keys",
            "profile_identity_keys",
        ]) {
            const snapshot = await database.collection(collectionName).get();
            for (const document of snapshot.docs) {
                const data = document.data();
                if (
                    data.tournament_id === tournamentId ||
                    trackedProfileIds.has(String(data.profile_id ?? "")) ||
                    trackedGlobalIds.has(String(data.global_id ?? ""))
                ) {
                    batch.delete(document.ref);
                }
            }
        }
        for (const profileId of trackedProfileIds) batch.delete(database.collection("users").doc(profileId));
        batch.delete(database.collection("tournaments").doc(tournamentId));
        batch.delete(database.collection("events").doc(individualEventId));
        batch.delete(database.collection("events").doc(cycleEventId));
        batch.delete(database.collection("events").doc(teamEventId));
        await batch.commit();
        testFeatures.cleanup();
    });

    it("creates stable checksums for equivalent workbook inputs", () => {
        assert.equal(stableChecksum({b: 2, a: 1}), stableChecksum({a: 1, b: 2}));
        assert.notEqual(stableChecksum({a: 1}), stableChecksum({a: 2}));
        assert.equal(nextAllowedGlobalIdNumber(3), 5);
    });

    it("matches a normalized MyKad to a legacy profile", async () => {
        const profileRef = database.collection("users").doc(`legacy-mykad-${suffix}`);
        const imported: ImportAthleteInput = {
            ...athlete(`Legacy MyKad ${suffix}`, "2010-01-01"),
            identityType: "MYKAD",
            identityNumber: "100101-10-1234",
            identityKey: "MYKAD:100101101234",
        };
        await profileRef.set({
            id: profileRef.id,
            global_id: `LEGACY-${suffix}`,
            name: imported.name,
            name_search: imported.name.toLowerCase(),
            IC: "100101101234",
            birthdate: Timestamp.fromDate(imported.birthdate),
            gender: imported.gender,
            country: imported.country,
            account_status: "unclaimed",
        });

        const plan = await buildImportPlan(database, tournamentId, parsed([imported], {}), "legacy-workbook");
        assert.equal(plan.summary.profilesReused, 1);
        assert.equal(plan.summary.profilesCreated, 0);
        await profileRef.delete();
    });

    it("reuses no-ID profiles, registrations, and teams across repeated imports", async () => {
        const firstAthletes = [
            athlete(`Repeat Athlete A ${suffix}`, "2012-02-03"),
            athlete(`Repeat Athlete B ${suffix}`, "2011-04-05"),
        ];
        const firstParsed = parsed(
            firstAthletes,
            Object.fromEntries(firstAthletes.map((entry) => [entry.name, [individualEventId, teamEventId]])),
            [
                {
                    eventId: teamEventId,
                    eventType: "Double",
                    sheetName: "Double",
                    sourceRow: 2,
                    name: `Repeat Team ${suffix}`,
                    members: firstAthletes.map((entry) => entry.workbookKey),
                },
            ],
        );
        const initialPlan = await buildImportPlan(database, tournamentId, firstParsed, "workbook-one");
        assert.equal(initialPlan.summary.profilesCreated, 2);
        assert.equal(initialPlan.summary.registrationsCreated, 2);
        assert.equal(initialPlan.summary.teamsCreated, 1);
        assert.equal(initialPlan.summary.conflicts, 0);

        const first = await commitIdempotentImport(
            database,
            tournamentId,
            new Date("2026-11-07T00:00:00.000Z"),
            firstParsed,
            "batch-one",
        );
        assert.equal(first.profilesCreated, 2);
        assert.equal(first.registrationsCreated, 2);
        assert.equal(first.teamsCreated, 1);
        track(firstAthletes);

        const repeatedAthletes = [athlete(firstAthletes[0].name, "2012-02-03"), athlete(firstAthletes[1].name, "2011-04-05")];
        const repeatedParsed = parsed(
            repeatedAthletes,
            Object.fromEntries(repeatedAthletes.map((entry) => [entry.name, [individualEventId, teamEventId]])),
            [
                {
                    eventId: teamEventId,
                    eventType: "Double",
                    sheetName: "Double",
                    sourceRow: 2,
                    name: `Repeat Team ${suffix}`,
                    members: repeatedAthletes.map((entry) => entry.workbookKey),
                },
            ],
        );
        const repeated = await commitIdempotentImport(
            database,
            tournamentId,
            new Date("2026-11-07T00:00:00.000Z"),
            repeatedParsed,
            "batch-two",
        );
        assert.equal(repeated.profilesCreated, 0);
        assert.equal(repeated.profilesReused, 2);
        assert.equal(repeated.registrationsUnchanged, 2);
        assert.equal(repeated.teamsUnchanged, 1);
        track(repeatedAthletes);
        assert.equal((await database.collection("registrations").where("tournament_id", "==", tournamentId).get()).size, 2);
        assert.equal((await database.collection("teams").where("tournament_id", "==", tournamentId).get()).size, 1);
    });

    it("updates an included athlete while preserving athletes absent from a corrected workbook", async () => {
        const corrected = athlete(`Repeat Athlete A ${suffix}`, "2012-02-03");
        await commitIdempotentImport(
            database,
            tournamentId,
            new Date("2026-11-07T00:00:00.000Z"),
            parsed([corrected], {[corrected.name]: [cycleEventId]}),
            "batch-corrected",
        );
        track([corrected]);
        const registrations = await database.collection("registrations").where("tournament_id", "==", tournamentId).get();
        assert.equal(registrations.size, 2);
        const correctedRegistration = registrations.docs.find(
            (document) => document.data().user_global_id === corrected.globalId,
        );
        assert.deepEqual(correctedRegistration?.data().events_registered, [cycleEventId]);
    });

    it("converges concurrent imports on one profile and registration", async () => {
        const name = `Concurrent Athlete ${suffix}`;
        const firstAthlete = athlete(name, "2015-10-11");
        const secondAthlete = athlete(name, "2015-10-11");
        await Promise.all([
            commitIdempotentImport(
                database,
                tournamentId,
                new Date("2026-11-07T00:00:00.000Z"),
                parsed([firstAthlete], {[name]: [individualEventId]}),
                "concurrent-one",
            ),
            commitIdempotentImport(
                database,
                tournamentId,
                new Date("2026-11-07T00:00:00.000Z"),
                parsed([secondAthlete], {[name]: [individualEventId]}),
                "concurrent-two",
            ),
        ]);
        track([firstAthlete, secondAthlete]);
        assert.equal(firstAthlete.userDocId, secondAthlete.userDocId);
        assert.equal(firstAthlete.globalId, secondAthlete.globalId);
        assert.equal(
            (await database.collection("users").where("import_identity_key", "==", importIdentityKey(firstAthlete)).get()).size,
            1,
        );
    });

    it("reports a manual registration conflict instead of overwriting it", async () => {
        const manual = athlete(`Manual Athlete ${suffix}`, "2010-06-07");
        const profileId = `manual-profile-${suffix}`;
        const globalId = `M-${suffix}`;
        trackedProfileIds.add(profileId);
        trackedGlobalIds.add(globalId);
        const batch = database.batch();
        batch.set(database.collection("users").doc(profileId), {
            id: profileId,
            global_id: globalId,
            name: manual.name,
            name_search: manual.name.toLowerCase(),
            birthdate: Timestamp.fromDate(manual.birthdate),
            gender: manual.gender,
            country: manual.country,
            import_identity_key: importIdentityKey(manual),
            account_status: "claimed",
            owner_uids: ["owner"],
        });
        batch.set(database.collection("registrations").doc(`manual-registration-${suffix}`), {
            tournament_id: tournamentId,
            user_id: profileId,
            user_global_id: globalId,
            registration_source: "member",
            events_registered: [individualEventId],
        });
        await batch.commit();

        const plan = await buildImportPlan(database, tournamentId, parsed([manual], {[manual.name]: [cycleEventId]}), "manual");
        assert.equal(plan.summary.conflicts, 1);
        assert.match(plan.conflicts[0] ?? "", /will not be overwritten/);
    });

    it("requires a fresh preview and replays an already committed workbook", async () => {
        const callableTournamentId = `callable-import-${suffix}`;
        const callableEventId = `callable-event-${suffix}`;
        const uid = `callable-admin-${suffix}`;
        const adminGlobalId = `ADMIN-${suffix}`;
        const importedName = `Callable Athlete ${suffix}`;
        const setup = database.batch();
        setup.set(database.collection("tournaments").doc(callableTournamentId), {
            name: "Callable Import Test",
            participants: 0,
            editor: adminGlobalId,
            start_date: Timestamp.fromDate(new Date("2026-11-07T00:00:00.000Z")),
        });
        setup.set(database.collection("events").doc(callableEventId), {
            id: callableEventId,
            tournament_id: callableTournamentId,
            type: "Individual",
            max_participants: 50,
        });
        setup.set(database.collection("users").doc(uid), {
            id: uid,
            global_id: adminGlobalId,
            owner_uids: [uid],
            roles: {edit_tournament: true},
        });
        await setup.commit();

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Individual");
        worksheet.addRow(["No", "Name", "IC / Passport", "Birthdate", "Gender", "Country", "State"]);
        worksheet.addRow([1, importedName, "", "03/02/2012", "Male", "Malaysia", "Selangor"]);
        const fileBase64 = Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");

        const preview = (await callImportWorkbook(uid, {
            tournamentId: callableTournamentId,
            fileBase64,
            mode: "preview",
            operationId: `preview-${suffix}`,
        })) as {summary: {planChecksum: string}};
        assert.match(preview.summary.planChecksum, /^[a-f0-9]{64}$/);

        await assert.rejects(
            () =>
                callImportWorkbook(uid, {
                    tournamentId: callableTournamentId,
                    fileBase64,
                    mode: "commit",
                    operationId: `missing-preview-${suffix}`,
                }),
            (error: {code?: string}) => error.code === "aborted",
        );

        const staleTeamRef = database.collection("teams").doc(`stale-team-${suffix}`);
        await staleTeamRef.set({
            tournament_id: callableTournamentId,
            event_id: callableEventId,
            leader_id: "unrelated-athlete",
            members: [],
            name: "Unrelated manual team",
        });
        await assert.rejects(
            () =>
                callImportWorkbook(uid, {
                    tournamentId: callableTournamentId,
                    fileBase64,
                    mode: "commit",
                    operationId: `stale-preview-${suffix}`,
                    expectedPlanChecksum: preview.summary.planChecksum,
                }),
            (error: {code?: string}) => error.code === "aborted",
        );
        await staleTeamRef.delete();

        const refreshedPreview = (await callImportWorkbook(uid, {
            tournamentId: callableTournamentId,
            fileBase64,
            mode: "preview",
            operationId: `refreshed-preview-${suffix}`,
        })) as {summary: {planChecksum: string}};

        const concurrentResults = (await Promise.all([
            callImportWorkbook(uid, {
                tournamentId: callableTournamentId,
                fileBase64,
                mode: "commit",
                operationId: `commit-${suffix}`,
                expectedPlanChecksum: refreshedPreview.summary.planChecksum,
            }),
            callImportWorkbook(uid, {
                tournamentId: callableTournamentId,
                fileBase64,
                mode: "commit",
                operationId: `concurrent-commit-${suffix}`,
                expectedPlanChecksum: refreshedPreview.summary.planChecksum,
            }),
        ])) as Array<{committed: boolean; idempotentReplay: boolean; summary: {importBatchId: string}}>;
        const committed = concurrentResults.find((result) => !result.idempotentReplay);
        assert.ok(committed);
        assert.equal(committed.committed, true);
        assert.equal(committed.idempotentReplay, false);
        assert.equal(concurrentResults.filter((result) => result.idempotentReplay).length, 1);

        const replay = (await callImportWorkbook(uid, {
            tournamentId: callableTournamentId,
            fileBase64,
            mode: "commit",
            operationId: `replay-${suffix}`,
            expectedPlanChecksum: refreshedPreview.summary.planChecksum,
        })) as {committed: boolean; idempotentReplay: boolean};
        assert.equal(replay.committed, true);
        assert.equal(replay.idempotentReplay, true);

        const importedProfiles = await database.collection("users").where("name_search", "==", importedName.toLowerCase()).get();
        assert.equal(importedProfiles.size, 1);
        track(
            importedProfiles.docs.map((document) => ({
                ...athlete(importedName, "2012-02-03"),
                userDocId: document.id,
                globalId: String(document.data().global_id ?? ""),
            })),
        );

        const cleanup = database.batch();
        cleanup.delete(database.collection("import_batches").doc(committed.summary.importBatchId));
        cleanup.delete(database.collection("users").doc(uid));
        cleanup.delete(database.collection("tournaments").doc(callableTournamentId));
        cleanup.delete(database.collection("events").doc(callableEventId));
        const registrations = await database.collection("registrations").where("tournament_id", "==", callableTournamentId).get();
        for (const registration of registrations.docs) cleanup.delete(registration.ref);
        await cleanup.commit();
    });
});
