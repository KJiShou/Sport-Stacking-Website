import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, describe, it} from "node:test";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import firebaseFunctionsTest from "firebase-functions-test";
import {releaseOwnedProfile} from "../index.js";

const testFeatures = firebaseFunctionsTest({projectId: process.env.GCLOUD_PROJECT ?? "sport-stacking-website-test"});
const releaseProfile = testFeatures.wrap(releaseOwnedProfile);
const db = getFirestore();

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

const callReleaseProfile = (profileId: string, uid: string): Promise<unknown> =>
    releaseProfile({
        data: {profileId},
        auth: authContext(uid),
        rawRequest: {} as never,
        acceptsStreaming: false,
    });

const callReleaseProfileUnauthenticated = (profileId: string): Promise<unknown> =>
    releaseProfile({
        data: {profileId},
        rawRequest: {} as never,
        acceptsStreaming: false,
    });

describe("releaseOwnedProfile", () => {
    after(() => testFeatures.cleanup());

    it("rejects unauthenticated requests", async () => {
        const profileId = `release-unauthenticated-${randomUUID()}`;
        await assert.rejects(
            () => callReleaseProfileUnauthenticated(profileId),
            (error: {code?: string}) => error.code === "unauthenticated",
        );
    });

    it("rejects a profile owned by another account", async () => {
        const suffix = randomUUID();
        const profileId = `release-foreign-${suffix}`;
        await db.collection("users").doc(profileId).set({owner_uids: [`other-${suffix}`], global_id: `FOREIGN-${suffix}`});

        await assert.rejects(
            () => callReleaseProfile(profileId, `owner-${suffix}`),
            (error: {code?: string}) => error.code === "permission-denied",
        );
    });

    it("does not allow the primary profile to be released", async () => {
        const suffix = randomUUID();
        const uid = `primary-owner-${suffix}`;
        await db.collection("users").doc(uid).set({id: uid, owner_uids: [uid], global_id: `00001-${suffix}`});

        await assert.rejects(
            () => callReleaseProfile(uid, uid),
            (error: {code?: string}) => error.code === "failed-precondition",
        );
    });

    it("unlinks a secondary profile while preserving its history", async () => {
        const suffix = randomUUID();
        const uid = `release-owner-${suffix}`;
        const profileId = `release-secondary-${suffix}`;
        const registrationRecords = [
            {
                tournament_id: `tournament-${suffix}`,
                events: ["3-3-3"],
                registration_date: Timestamp.now(),
                status: "approved",
            },
        ];
        await Promise.all([
            db.collection("users").doc(uid).set({id: uid, owner_uids: [uid], global_id: `00001-${suffix}`}),
            db.collection("users").doc(profileId).set({
                id: profileId,
                owner_uids: [uid],
                global_id: `00002-${suffix}`,
                email: "owner@example.com",
                registration_records: registrationRecords,
            }),
        ]);

        const result = (await callReleaseProfile(profileId, uid)) as {
            profileId: string;
            owner_uids: string[];
            account_status: string;
        };
        const releasedProfile = await db.collection("users").doc(profileId).get();

        assert.equal(result.profileId, profileId);
        assert.deepEqual(result.owner_uids, []);
        assert.equal(result.account_status, "unclaimed");
        assert.deepEqual(releasedProfile.data()?.owner_uids, []);
        assert.equal(releasedProfile.data()?.account_status, "unclaimed");
        assert.equal(releasedProfile.data()?.email, null);
        assert.deepEqual(releasedProfile.data()?.registration_records, registrationRecords);
    });

    it("keeps a profile claimed when another owner remains", async () => {
        const suffix = randomUUID();
        const uid = `release-shared-owner-${suffix}`;
        const remainingUid = `release-remaining-owner-${suffix}`;
        const profileId = `release-shared-${suffix}`;
        await Promise.all([
            db.collection("users").doc(uid).set({id: uid, owner_uids: [uid], global_id: `00001-${suffix}`}),
            db.collection("users").doc(profileId).set({
                id: profileId,
                owner_uids: [uid, remainingUid],
                global_id: `00002-${suffix}`,
                email: "remaining@example.com",
            }),
        ]);

        const result = (await callReleaseProfile(profileId, uid)) as {
            owner_uids: string[];
            account_status: string;
            email: string | null;
        };

        assert.deepEqual(result.owner_uids, [remainingUid]);
        assert.equal(result.account_status, "claimed");
        assert.equal(result.email, "remaining@example.com");
    });

    it("rejects a repeated release after ownership has been removed", async () => {
        const suffix = randomUUID();
        const uid = `release-repeat-owner-${suffix}`;
        const profileId = `release-repeat-${suffix}`;
        await Promise.all([
            db.collection("users").doc(uid).set({id: uid, owner_uids: [uid], global_id: `00001-${suffix}`}),
            db.collection("users").doc(profileId).set({id: profileId, owner_uids: [uid], global_id: `00002-${suffix}`}),
        ]);

        await callReleaseProfile(profileId, uid);
        await assert.rejects(
            () => callReleaseProfile(profileId, uid),
            (error: {code?: string}) => error.code === "permission-denied",
        );
    });
});
