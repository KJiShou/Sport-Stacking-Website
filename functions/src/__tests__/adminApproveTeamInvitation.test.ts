import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, before, describe, it} from "node:test";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import firebaseFunctionsTest from "firebase-functions-test";
import {adminApproveTeamInvitation, adminCreateTournamentRegistration} from "../index.js";

const testFeatures = firebaseFunctionsTest({projectId: process.env.GCLOUD_PROJECT ?? "sport-stacking-website-test"});
const approveInvitation = testFeatures.wrap(adminApproveTeamInvitation);
const createAdminRegistration = testFeatures.wrap(adminCreateTournamentRegistration);
const db = getFirestore();

type FixtureOptions = {
    profileRecords?: unknown[];
    duplicateProfiles?: boolean;
    parentChild?: boolean;
};

type Fixture = {
    tournamentId: string;
    requestId: string;
    targetGlobalId: string;
    targetDocIds: string[];
    teamId: string;
    registrationId?: string;
    eventId: string;
};

const callApproveInvitation = (requestId: string): Promise<unknown> =>
    approveInvitation({
        data: {requestId},
        auth: {
            uid: "admin-uid",
            token: {
                aud: "sport-stacking-website-test",
                auth_time: 0,
                exp: 0,
                firebase: {identities: {}, sign_in_provider: "custom"},
                iat: 0,
                iss: "https://securetoken.google.com/sport-stacking-website-test",
                sub: "admin-uid",
                uid: "admin-uid",
            },
            rawToken: "",
        },
        rawRequest: {} as never,
        acceptsStreaming: false,
    });

const callAdminCreateRegistration = (data: Record<string, unknown>): Promise<unknown> =>
    createAdminRegistration({
        data,
        auth: {
            uid: "admin-uid",
            token: {
                aud: "sport-stacking-website-test",
                auth_time: 0,
                exp: 0,
                firebase: {identities: {}, sign_in_provider: "custom"},
                iat: 0,
                iss: "https://securetoken.google.com/sport-stacking-website-test",
                sub: "admin-uid",
                uid: "admin-uid",
            },
            rawToken: "",
        },
        rawRequest: {} as never,
        acceptsStreaming: false,
    });

const createFixture = async (options: FixtureOptions = {}): Promise<Fixture> => {
    const suffix = randomUUID().replace(/-/g, "");
    const tournamentId = `approval-test-${suffix}`;
    const teamId = `team-${suffix}`;
    const eventId = `event-${suffix}`;
    const targetGlobalId = `TARGET-${suffix}`;
    const targetDocIds = [`target-${suffix}`];
    const requestId = `${tournamentId}_${teamId}_${targetGlobalId}`;
    const parentChild = options.parentChild === true;
    const now = Timestamp.now();
    const eventType = parentChild ? "Parent & Child" : "Double";

    if (options.duplicateProfiles) {
        targetDocIds.push(`target-duplicate-${suffix}`);
    }

    const targetProfile = {
        id: targetDocIds[0],
        global_id: targetGlobalId,
        name: "Target Member",
        birthdate: Timestamp.fromDate(new Date("2010-01-01T00:00:00.000Z")),
        gender: "Male",
        country: ["MY"],
        ...(options.profileRecords === undefined ? {} : {registration_records: options.profileRecords}),
    };

    const writes: Promise<unknown>[] = [
        db
            .collection("users")
            .doc("admin-profile")
            .set({
                id: "admin-profile",
                global_id: "ADMIN",
                owner_uids: ["admin-uid"],
                roles: {edit_tournament: true, modify_admin: false},
            }),
        db.collection("users").doc(targetDocIds[0]).set(targetProfile),
        db.collection("tournaments").doc(tournamentId).set({
            id: tournamentId,
            name: "Approval Test Tournament",
            editor: "ADMIN",
            recorder: "",
            participants: 1,
        }),
        db.collection("events").doc(eventId).set({
            id: eventId,
            tournament_id: tournamentId,
            type: eventType,
            gender: "Mixed",
            codes: [],
            max_participants: 20,
        }),
        db
            .collection("teams")
            .doc(teamId)
            .set({
                id: teamId,
                tournament_id: tournamentId,
                name: "Approval Team",
                leader_id: "LEADER",
                members: [{global_id: targetGlobalId, verified: false}],
                event_id: eventId,
                event: [eventType],
            }),
        db
            .collection("verification_requests")
            .doc(requestId)
            .set({
                id: requestId,
                target_global_id: targetGlobalId,
                member_id: targetGlobalId,
                tournament_id: tournamentId,
                team_id: teamId,
                registration_id: parentChild ? "" : `registration-${suffix}`,
                status: "pending",
                event_label: eventType,
                team_name: "Approval Team",
                leader_label: "Leader (LEADER)",
                created_at: now,
            }),
    ];

    if (!parentChild) {
        const registrationId = `registration-${suffix}`;
        writes.push(
            db
                .collection("registrations")
                .doc(registrationId)
                .set({
                    id: registrationId,
                    tournament_id: tournamentId,
                    user_id: targetDocIds[0],
                    user_global_id: targetGlobalId,
                    user_name: "Target Member",
                    events_registered: ["Individual"],
                    registration_status: "approved",
                    rejection_reason: null,
                    created_at: now,
                    updated_at: now,
                }),
        );
    }

    if (options.duplicateProfiles) {
        writes.push(
            db
                .collection("users")
                .doc(targetDocIds[1])
                .set({
                    ...targetProfile,
                    id: targetDocIds[1],
                }),
        );
    }

    await Promise.all(writes);
    return {
        tournamentId,
        requestId,
        targetGlobalId,
        targetDocIds,
        teamId,
        registrationId: parentChild ? undefined : `registration-${suffix}`,
        eventId,
    };
};

const readDoc = async (collection: string, id: string) => db.collection(collection).doc(id).get();

describe("adminApproveTeamInvitation", () => {
    before(() => {
        process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
    });

    after(() => {
        testFeatures.cleanup();
    });

    it("updates all registration state and removes active recruitments", async () => {
        const now = Timestamp.now();
        const fixture = await createFixture({
            profileRecords: [
                {
                    tournament_id: "placeholder",
                    events: ["Individual"],
                    registration_date: now,
                    status: "approved",
                    created_at: now,
                    updated_at: now,
                },
            ],
        });
        const profileRef = db.collection("users").doc(fixture.targetDocIds[0]);
        await profileRef.update({
            registration_records: [
                {
                    tournament_id: fixture.tournamentId,
                    events: ["Individual"],
                    registration_date: now,
                    status: "approved",
                    created_at: now,
                    updated_at: now,
                },
            ],
        });
        await Promise.all([
            db.collection("individual_recruitment").doc(`individual-${fixture.tournamentId}`).set({
                tournament_id: fixture.tournamentId,
                participant_id: fixture.targetGlobalId,
            }),
            db.collection("double_recruitment").doc(`double-${fixture.tournamentId}`).set({
                tournament_id: fixture.tournamentId,
                participant_id: fixture.targetGlobalId,
            }),
            db.collection("team_recruitment").doc(`leader-${fixture.tournamentId}`).set({
                tournament_id: fixture.tournamentId,
                leader_id: fixture.targetGlobalId,
            }),
            db.collection("team_recruitment").doc(`registration-${fixture.tournamentId}`).set({
                tournament_id: fixture.tournamentId,
                registration_id: fixture.registrationId,
            }),
        ]);

        await callApproveInvitation(fixture.requestId);

        const [team, request, registration, profile] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
            readDoc("registrations", fixture.registrationId as string),
            profileRef.get(),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, true);
        assert.equal(request.data()?.status, "verified");
        assert.deepEqual(registration.data()?.events_registered, ["Individual", fixture.eventId]);
        const records = profile.data()?.registration_records as Array<{tournament_id: string; events: string[]}>;
        assert.deepEqual(records.find((record) => record.tournament_id === fixture.tournamentId)?.events, [
            "Individual",
            fixture.eventId,
        ]);
        assert.equal(
            (await db.collection("individual_recruitment").where("tournament_id", "==", fixture.tournamentId).get()).empty,
            true,
        );
        assert.equal(
            (await db.collection("double_recruitment").where("tournament_id", "==", fixture.tournamentId).get()).empty,
            true,
        );
        assert.equal(
            (await db.collection("team_recruitment").where("tournament_id", "==", fixture.tournamentId).get()).empty,
            true,
        );
        const auditLogs = await db.collection("audit_logs").where("tournamentId", "==", fixture.tournamentId).get();
        assert.ok(auditLogs.docs.some((audit) => audit.data().actorGlobalId === "ADMIN"));
    });

    it("rebuilds a missing registration record", async () => {
        const fixture = await createFixture();
        await callApproveInvitation(fixture.requestId);

        const profile = await readDoc("users", fixture.targetDocIds[0]);
        const records = profile.data()?.registration_records as Array<{tournament_id: string; events: string[]; status: string}>;
        const record = records.find((candidate) => candidate.tournament_id === fixture.tournamentId);
        assert.deepEqual(record?.events, ["Individual", fixture.eventId]);
        assert.equal(record?.status, "approved");
    });

    it("approves an existing event selection idempotently without double-counting capacity", async () => {
        const fixture = await createFixture();
        await db
            .collection("registrations")
            .doc(fixture.registrationId as string)
            .update({
                events_registered: ["Individual", fixture.eventId],
            });
        await db.collection("events").doc(fixture.eventId).update({approved_participants: 1});

        await callApproveInvitation(fixture.requestId);

        const [team, request, registration, event] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
            readDoc("registrations", fixture.registrationId as string),
            readDoc("events", fixture.eventId),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, true);
        assert.equal(request.data()?.status, "verified");
        assert.deepEqual(registration.data()?.events_registered, ["Individual", fixture.eventId]);
        assert.equal(event.data()?.approved_participants, 1);
    });

    it("completes an invitation created by an admin registration", async () => {
        const suffix = randomUUID().replace(/-/g, "");
        const tournamentId = `admin-registration-test-${suffix}`;
        const eventId = `admin-event-${suffix}`;
        const leaderId = `leader-profile-${suffix}`;
        const memberGlobalId = `ADMIN-MEMBER-${suffix}`;
        const memberId = `member-profile-${suffix}`;
        const now = Timestamp.now();

        await Promise.all([
            db
                .collection("users")
                .doc("admin-profile")
                .set({
                    id: "admin-profile",
                    global_id: "ADMIN",
                    owner_uids: ["admin-uid"],
                    roles: {edit_tournament: true, modify_admin: false},
                }),
            db
                .collection("users")
                .doc(leaderId)
                .set({
                    id: leaderId,
                    global_id: `ADMIN-LEADER-${suffix}`,
                    name: "Admin Leader",
                    birthdate: Timestamp.fromDate(new Date("2010-01-01T00:00:00.000Z")),
                    gender: "Male",
                    country: ["MY"],
                }),
            db
                .collection("users")
                .doc(memberId)
                .set({
                    id: memberId,
                    global_id: memberGlobalId,
                    name: "Admin Member",
                    birthdate: Timestamp.fromDate(new Date("2010-01-01T00:00:00.000Z")),
                    gender: "Male",
                    country: ["MY"],
                }),
            db.collection("tournaments").doc(tournamentId).set({
                id: tournamentId,
                name: "Admin Registration Test",
                editor: "ADMIN",
                recorder: "",
                start_date: now,
                participants: 0,
                max_participants: 20,
            }),
            db.collection("events").doc(eventId).set({
                id: eventId,
                tournament_id: tournamentId,
                type: "Double",
                gender: "Mixed",
                codes: [],
                teamSize: 2,
                max_participants: 20,
                age_brackets: [],
            }),
        ]);

        const createResult = (await callAdminCreateRegistration({
            tournamentId,
            targetUserId: leaderId,
            eventIds: [eventId],
            teamAssignments: [{eventId, teamName: "Admin Team", memberGlobalIds: [memberGlobalId]}],
        })) as {registrationId: string};

        const [createdRegistration, createdTeamSnapshot, createdRequestSnapshot] = await Promise.all([
            readDoc("registrations", createResult.registrationId),
            db.collection("teams").where("registration_id", "==", createResult.registrationId).get(),
            db
                .collection("verification_requests")
                .where("tournament_id", "==", tournamentId)
                .where("member_id", "==", memberGlobalId)
                .get(),
        ]);
        assert.equal(createdRegistration.data()?.registration_status, "pending");
        assert.equal(createdTeamSnapshot.size, 1);
        assert.equal(createdRequestSnapshot.size, 1);

        const memberRegistrationId = `member-registration-${suffix}`;
        await db.collection("registrations").doc(memberRegistrationId).set({
            id: memberRegistrationId,
            tournament_id: tournamentId,
            user_id: memberId,
            user_global_id: memberGlobalId,
            events_registered: [],
            registration_status: "approved",
            created_at: now,
            updated_at: now,
        });

        await callApproveInvitation(createdRequestSnapshot.docs[0].id);

        const [team, request, memberRegistration, event] = await Promise.all([
            readDoc("teams", createdTeamSnapshot.docs[0].id),
            readDoc("verification_requests", createdRequestSnapshot.docs[0].id),
            readDoc("registrations", memberRegistrationId),
            readDoc("events", eventId),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, true);
        assert.equal(request.data()?.status, "verified");
        assert.deepEqual(memberRegistration.data()?.events_registered, [eventId]);
        assert.equal(event.data()?.approved_participants, 1);
    });

    it("still rejects a member already verified in another team for the event", async () => {
        const fixture = await createFixture();
        await db
            .collection("teams")
            .doc(`conflicting-${fixture.teamId}`)
            .set({
                id: `conflicting-${fixture.teamId}`,
                tournament_id: fixture.tournamentId,
                name: "Conflicting Team",
                leader_id: "OTHER-LEADER",
                members: [{global_id: fixture.targetGlobalId, verified: true}],
                event_id: fixture.eventId,
                event: ["Double"],
            });

        await assert.rejects(
            () => callApproveInvitation(fixture.requestId),
            (error: {code?: string}) => error.code === "already-exists",
        );

        const [team, request] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, false);
        assert.equal(request.data()?.status, "pending");
    });

    it("keeps the approval successful when recruitment cleanup fails", async () => {
        const fixture = await createFixture();
        const originalCollection = db.collection;
        db.collection = ((collectionPath: string) => {
            if (collectionPath === "individual_recruitment") {
                throw new Error("simulated recruitment cleanup failure");
            }
            return originalCollection.call(db, collectionPath);
        }) as typeof db.collection;

        try {
            await callApproveInvitation(fixture.requestId);
        } finally {
            db.collection = originalCollection;
        }

        const team = await readDoc("teams", fixture.teamId);
        assert.equal(team.data()?.members?.[0]?.verified, true);
    });

    it("treats a missing events array as empty while repairing the record", async () => {
        const now = Timestamp.now();
        const fixture = await createFixture({
            profileRecords: [
                {
                    tournament_id: "placeholder",
                    events: [],
                    registration_date: now,
                    status: "approved",
                    created_at: now,
                    updated_at: now,
                },
            ],
        });
        await db
            .collection("users")
            .doc(fixture.targetDocIds[0])
            .update({
                registration_records: [
                    {
                        tournament_id: fixture.tournamentId,
                        registration_date: now,
                        status: "approved",
                        created_at: now,
                        updated_at: now,
                    },
                ],
            });
        await callApproveInvitation(fixture.requestId);

        const profile = await readDoc("users", fixture.targetDocIds[0]);
        const records = profile.data()?.registration_records as Array<{tournament_id: string; events: string[]}>;
        assert.deepEqual(records.find((record) => record.tournament_id === fixture.tournamentId)?.events, [
            "Individual",
            fixture.eventId,
        ]);
    });

    it("rejects duplicate Global IDs without changing any records", async () => {
        const fixture = await createFixture({duplicateProfiles: true});
        await assert.rejects(
            () => callApproveInvitation(fixture.requestId),
            (error: {code?: string}) => error.code === "failed-precondition",
        );

        const [team, request, registration] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
            readDoc("registrations", fixture.registrationId as string),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, false);
        assert.equal(request.data()?.status, "pending");
        assert.deepEqual(registration.data()?.events_registered, ["Individual"]);
    });

    it("approves Parent & Child invitations without a separate registration", async () => {
        const fixture = await createFixture({parentChild: true});
        await callApproveInvitation(fixture.requestId);

        const [team, request] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, true);
        assert.equal(request.data()?.status, "verified");
    });

    it("only reserves the exact event ID when another event has the same type", async () => {
        const fixture = await createFixture();
        const otherEventId = `other-event-${fixture.tournamentId}`;
        await Promise.all([
            db.collection("events").doc(otherEventId).set({
                id: otherEventId,
                tournament_id: fixture.tournamentId,
                type: "Double",
                gender: "Female",
                codes: [],
                max_participants: 1,
            }),
            db
                .collection("registrations")
                .doc(`other-registration-${fixture.tournamentId}`)
                .set({
                    id: `other-registration-${fixture.tournamentId}`,
                    tournament_id: fixture.tournamentId,
                    user_global_id: `OTHER-${fixture.tournamentId}`,
                    events_registered: [otherEventId],
                    registration_status: "approved",
                }),
        ]);

        await callApproveInvitation(fixture.requestId);

        const [targetEvent, otherEvent] = await Promise.all([
            readDoc("events", fixture.eventId),
            readDoc("events", otherEventId),
        ]);
        assert.equal(targetEvent.data()?.approved_participants, 1);
        assert.equal(otherEvent.data()?.approved_participants, undefined);
    });

    it("keeps resolving legacy teams that only store event names or codes", async () => {
        const fixture = await createFixture();
        await Promise.all([
            db
                .collection("events")
                .doc(fixture.eventId)
                .update({codes: ["3-3-3"]}),
            db
                .collection("teams")
                .doc(fixture.teamId)
                .update({event_id: null, event: ["3-3-3"]}),
        ]);

        await callApproveInvitation(fixture.requestId);

        const [team, request, registration] = await Promise.all([
            readDoc("teams", fixture.teamId),
            readDoc("verification_requests", fixture.requestId),
            readDoc("registrations", fixture.registrationId as string),
        ]);
        assert.equal(team.data()?.members?.[0]?.verified, true);
        assert.equal(request.data()?.status, "verified");
        assert.deepEqual(registration.data()?.events_registered, ["Individual", "3-3-3"]);
    });
});
