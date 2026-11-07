import {strict as assert} from "node:assert";
import {randomUUID} from "node:crypto";
import {after, it} from "node:test";
import {getFirestore} from "firebase-admin/firestore";
import firebaseFunctionsTest from "firebase-functions-test";
import {mutateAdminTeam} from "../index.js";

const features = firebaseFunctionsTest({projectId: "sport-stacking-website-test"});
const mutate = features.wrap(mutateAdminTeam);
const db = getFirestore();
after(() => features.cleanup());

async function fixture(eventType = "Parent & Child") {
    assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Requires Firestore emulator");
    const id = randomUUID();
    const tournamentId = `parent-child-${id}`;
    const eventId = `event-${id}`;
    const uid = `admin-${id}`;
    const childA = `child-a-${id}`;
    const childB = `child-b-${id}`;
    const parent = `parent-${id}`;
    const otherParent = `other-parent-${id}`;
    await db
        .collection("users")
        .doc(uid)
        .set({
            id: uid,
            global_id: uid,
            owner_uids: [uid],
            roles: {edit_tournament: true},
        });
    await db.collection("tournaments").doc(tournamentId).set({id: tournamentId, editor: uid});
    await db.collection("events").doc(eventId).set({
        id: eventId,
        tournament_id: tournamentId,
        type: eventType,
        teamSize: 2,
    });
    for (const globalId of [childA, childB, parent, otherParent]) {
        await db
            .collection("users")
            .doc(globalId)
            .set({
                id: globalId,
                global_id: globalId,
                name: globalId,
                registration_records: [{tournament_id: tournamentId, events: [eventId]}],
            });
        await db
            .collection("registrations")
            .doc(globalId)
            .set({
                id: globalId,
                tournament_id: tournamentId,
                user_id: globalId,
                user_global_id: globalId,
                user_name: globalId,
                events_registered: [eventId],
            });
    }
    const team = (leader: string, member: string, teamId: string) => ({
        id: teamId,
        tournament_id: tournamentId,
        leader_id: leader,
        members: [{global_id: member, verified: true}],
        event_id: eventId,
        event: [eventType],
        name: "Updated team name",
        team_age: 10,
        registration_id: leader,
        looking_for_member: false,
    });
    const first = team(childA, parent, `first-${id}`);
    await db.collection("teams").doc(first.id).set(first);
    const save = (leader: string, member: string, teamId = `second-${id}`) =>
        mutate({
            data: {action: "upsert", tournamentId, teamId, team: team(leader, member, teamId)},
            auth: {uid, token: {} as never, rawToken: ""},
            rawRequest: {} as never,
            acceptsStreaming: false,
        });
    const seed = async (leader: string, member: string) => {
        const second = team(leader, member, `second-${id}`);
        await db
            .collection("teams")
            .doc(second.id)
            .set({...second, name: "Old name"});
        return second.id;
    };
    return {childA, childB, parent, otherParent, first, save, seed};
}

it("synchronizes both Parent & Child teams sharing a parent without removing either", async () => {
    const f = await fixture();
    const secondId = await f.seed(f.childB, f.parent);
    await f.save(f.childB, f.parent);
    await f.save(f.childA, f.parent, f.first.id);
    for (const id of [f.first.id, secondId]) {
        const snapshot = await db.collection("teams").doc(id).get();
        assert.equal(snapshot.exists, true);
        assert.equal(snapshot.data()?.name, "Updated team name");
    }
});

it("rejects the same child paired with different parents", async () => {
    const f = await fixture();
    await f.seed(f.childA, f.otherParent);
    await assert.rejects(f.save(f.childA, f.otherParent), /already assigned to a different team/);
});

it("rejects duplicate Parent & Child pairs", async () => {
    const f = await fixture();
    await f.seed(f.childA, f.parent);
    await assert.rejects(f.save(f.childA, f.parent), /already registered as a team/);
});

it("still rejects a shared participant in Double", async () => {
    const f = await fixture("Double");
    await f.seed(f.childB, f.parent);
    await assert.rejects(f.save(f.childB, f.parent), /already assigned to a different team/);
});

it("does not exempt a participant who is a child in the other team", async () => {
    const f = await fixture();
    await f.seed(f.childB, f.childA);
    await assert.rejects(f.save(f.childB, f.childA), /already assigned to a different team/);
});
