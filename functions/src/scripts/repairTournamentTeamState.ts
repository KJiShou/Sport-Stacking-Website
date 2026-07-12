import {getApps, initializeApp} from "firebase-admin/app";
import {FieldValue, Timestamp, type DocumentReference, type QueryDocumentSnapshot, getFirestore} from "firebase-admin/firestore";

type TeamMember = {global_id?: string; verified?: boolean};
type TeamData = {
    tournament_id?: string;
    registration_id?: string;
    leader_id?: string;
    members?: TeamMember[];
    event_id?: string | null;
    event?: string[];
    name?: string;
};

const args = process.argv.slice(2);
const getArg = (name: string): string => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? "").trim() : "";
};
const tournamentId = getArg("--tournament");
const apply = args.includes("--apply");
const syncRegistrationTeams = args.includes("--sync-registration-teams");
const allTournaments = args.includes("--all-tournaments");
const requestedDatabase = getArg("--database");

if (!tournamentId && !allTournaments) {
    throw new Error(
        "Usage: yarn workspace functions repair:teams --tournament <id> [--apply] [--sync-registration-teams] or --all-tournaments --sync-registration-teams [--database default] [--apply]",
    );
}

if (!getApps().length) initializeApp();
const firebaseApp = getApps()[0] ?? initializeApp();
const firestoreDatabaseId = requestedDatabase === "default" ? "" : process.env.FIRESTORE_DATABASE_ID?.trim() || requestedDatabase;
const db = firestoreDatabaseId ? getFirestore(firebaseApp, firestoreDatabaseId) : getFirestore(firebaseApp);
const normalize = (value: string | null | undefined): string => (value ?? "").trim().toLowerCase();
const requestIdFor = (teamId: string, memberId: string): string => `${tournamentId}_${teamId}_${memberId}`;

type RegistrationTeamSnapshot = {
    team_id: string;
    label: string;
    name: string;
    member: Array<{global_id?: string; verified?: boolean}>;
    leader: {global_id?: string | null; verified?: boolean};
    looking_for_team_members: boolean;
};

const buildRegistrationTeamSnapshot = (teamId: string, data: TeamData): RegistrationTeamSnapshot => ({
    team_id: teamId,
    label: data.name ?? "",
    name: data.name ?? "",
    member: (data.members ?? []).map((member) => ({global_id: member.global_id, verified: Boolean(member.verified)})),
    leader: {global_id: data.leader_id ?? null, verified: true},
    looking_for_team_members: false,
});

const syncRegistrationTeamSnapshots = async (): Promise<void> => {
    const teamsQuery = tournamentId
        ? db.collection("teams").where("tournament_id", "==", tournamentId)
        : db.collection("teams");
    const registrationsQuery = tournamentId
        ? db.collection("registrations").where("tournament_id", "==", tournamentId)
        : db.collection("registrations");
    const [teamSnapshot, registrationSnapshot] = await Promise.all([teamsQuery.get(), registrationsQuery.get()]);
    const registrationsByParticipant = new Map<string, QueryDocumentSnapshot>();
    for (const registration of registrationSnapshot.docs) {
        const participantId = (registration.data().user_global_id as string | undefined)?.trim();
        if (participantId) registrationsByParticipant.set(`${registration.data().tournament_id}|${participantId}`, registration);
    }

    const expectedByRegistration = new Map<string, RegistrationTeamSnapshot[]>();
    for (const teamDoc of teamSnapshot.docs) {
        const data = teamDoc.data() as TeamData;
        const confirmedIds = new Set<string>();
        if (data.leader_id) confirmedIds.add(data.leader_id.trim());
        for (const member of data.members ?? []) {
            if (member.global_id && member.verified) confirmedIds.add(member.global_id.trim());
        }
        const payload = buildRegistrationTeamSnapshot(teamDoc.id, data);
        for (const participantId of confirmedIds) {
            const registration = registrationsByParticipant.get(`${data.tournament_id}|${participantId}`);
            if (!registration) continue;
            const key = registration.id;
            expectedByRegistration.set(key, [...(expectedByRegistration.get(key) ?? []), payload]);
        }
    }

    const updates: Array<{ref: DocumentReference; teams: RegistrationTeamSnapshot[]}> = [];
    for (const registration of registrationSnapshot.docs) {
        const existing = Array.isArray(registration.data().teams) ? (registration.data().teams as RegistrationTeamSnapshot[]) : [];
        const expected = expectedByRegistration.get(registration.id) ?? [];
        const expectedByTeamId = new Map(expected.map((team) => [team.team_id, team]));
        const next = [...expectedByTeamId.values()];
        for (const team of existing) {
            if (!expectedByTeamId.has(team.team_id) && !teamSnapshot.docs.some((candidate) => candidate.id === team.team_id)) {
                next.push(team);
            }
        }
        if (JSON.stringify(next) !== JSON.stringify(existing)) updates.push({ref: registration.ref, teams: next});
    }

    console.info(
        JSON.stringify(
            {
                mode: apply ? "apply" : "dry-run",
                databaseId: firestoreDatabaseId || "(default)",
                tournamentId: tournamentId || "all",
                teamsScanned: teamSnapshot.size,
                registrationsScanned: registrationSnapshot.size,
                registrationsToUpdate: updates.length,
                examples: updates.slice(0, 20).map((update) => ({registrationId: update.ref.id, teamIds: update.teams.map((team) => team.team_id)})),
            },
            null,
            2,
        ),
    );
    if (!apply) return;
    for (let index = 0; index < updates.length; index += 400) {
        const batch = db.batch();
        for (const update of updates.slice(index, index + 400)) {
            batch.update(update.ref, {teams: update.teams, updated_at: Timestamp.now()});
        }
        await batch.commit();
    }
};

const main = async () => {
    const [
        teamsSnapshot,
        eventsSnapshot,
        recruitmentsSnapshot,
        doubleRecruitmentsSnapshot,
        requestsSnapshot,
        registrationsSnapshot,
    ] = await Promise.all([
        db.collection("teams").where("tournament_id", "==", tournamentId).get(),
        db.collection("events").where("tournament_id", "==", tournamentId).get(),
        db.collection("team_recruitment").where("tournament_id", "==", tournamentId).get(),
        db.collection("double_recruitment").where("tournament_id", "==", tournamentId).get(),
        db.collection("verification_requests").where("tournament_id", "==", tournamentId).get(),
        db.collection("registrations").where("tournament_id", "==", tournamentId).get(),
    ]);

    const eventById = new Map(
        eventsSnapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data() as {type?: string};
            return [docSnapshot.id, data.type ?? docSnapshot.id] as const;
        }),
    );
    const teams = teamsSnapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ref: docSnapshot.ref,
        data: docSnapshot.data() as TeamData,
    }));
    const teamRecruitmentIds = new Set(
        recruitmentsSnapshot.docs.map((docSnapshot) => (docSnapshot.data() as {team_id?: string}).team_id).filter(Boolean),
    );
    const activeDoubleRecruitments = doubleRecruitmentsSnapshot.docs
        .map((docSnapshot) => docSnapshot.data() as {participant_id?: string; event_id?: string; status?: string})
        .filter((item) => item.status === "active");
    const requestsById = new Map(requestsSnapshot.docs.map((docSnapshot) => [docSnapshot.id, docSnapshot]));
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const registrations = registrationsSnapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        ref: docSnapshot.ref,
        data: docSnapshot.data() as {user_id?: string; user_global_id?: string; events_registered?: string[]},
    }));

    const orphanTeams = teams.filter((team) => {
        const eventType = normalize(eventById.get(team.data.event_id ?? "") ?? team.data.event_id);
        const isDouble = eventType.includes("double");
        return (team.data.members ?? []).length === 0 && (isDouble || !teamRecruitmentIds.has(team.id));
    });
    const orphanIds = new Set(orphanTeams.map((team) => team.id));
    const participantEventTeams = new Map<string, Array<{teamId: string; role: "leader" | "verified" | "pending"}>>();
    for (const team of teams.filter((item) => !orphanIds.has(item.id))) {
        const eventId = team.data.event_id ?? "";
        const leaderId = team.data.leader_id ?? "";
        if (leaderId && eventId) {
            const key = `${leaderId}|${eventId}`;
            participantEventTeams.set(key, [...(participantEventTeams.get(key) ?? []), {teamId: team.id, role: "leader"}]);
        }
        for (const member of team.data.members ?? []) {
            if (!member.global_id || !eventId) continue;
            const key = `${member.global_id}|${eventId}`;
            participantEventTeams.set(key, [
                ...(participantEventTeams.get(key) ?? []),
                {teamId: team.id, role: member.verified ? "verified" : "pending"},
            ]);
        }
    }

    const missingRequests: Array<{teamId: string; memberId: string; conflict: boolean}> = [];
    for (const team of teams.filter((item) => !orphanIds.has(item.id))) {
        const eventId = team.data.event_id ?? "";
        for (const member of team.data.members ?? []) {
            if (!member.global_id || member.verified) continue;
            const requestId = requestIdFor(team.id, member.global_id);
            const existingStatus = requestsById.get(requestId)?.data()?.status;
            if (existingStatus === "pending") continue;
            const assignments = participantEventTeams.get(`${member.global_id}|${eventId}`) ?? [];
            missingRequests.push({teamId: team.id, memberId: member.global_id, conflict: assignments.length > 1});
        }
    }

    const staleRequests = requestsSnapshot.docs.filter((requestSnapshot) => {
        const data = requestSnapshot.data() as {status?: string; team_id?: string; member_id?: string};
        if (data.status !== "pending" || !data.team_id || !data.member_id) return false;
        const team = teamById.get(data.team_id);
        return !team || !(team.data.members ?? []).some((member) => member.global_id === data.member_id && !member.verified);
    });

    const report = {
        tournamentId,
        databaseId: firestoreDatabaseId || "(default)",
        mode: apply ? "apply" : "dry-run",
        orphanTeams: orphanTeams.map((team) => ({
            teamId: team.id,
            leaderId: team.data.leader_id ?? "",
            eventId: team.data.event_id ?? "",
            event: eventById.get(team.data.event_id ?? "") ?? team.data.event_id ?? "",
        })),
        missingRequests,
        staleRequests: staleRequests.map((requestSnapshot) => requestSnapshot.id),
        conflicts: missingRequests.filter((item) => item.conflict),
    };
    console.info(JSON.stringify(report, null, 2));

    if (!apply) return;

    for (const orphan of orphanTeams) {
        const leaderId = orphan.data.leader_id ?? "";
        const eventId = orphan.data.event_id ?? "";
        await orphan.ref.delete();
        if (!leaderId || !eventId) continue;

        const validAssignments = participantEventTeams.get(`${leaderId}|${eventId}`) ?? [];
        const hasActiveRecruitment =
            activeDoubleRecruitments.some(
                (recruitment) => recruitment.participant_id === leaderId && recruitment.event_id === eventId,
            ) ||
            recruitmentsSnapshot.docs.some((docSnapshot) => {
                const data = docSnapshot.data() as {leader_id?: string; event_id?: string; status?: string};
                return data.leader_id === leaderId && data.event_id === eventId && data.status === "active";
            });
        const hasConfirmedAssignment = validAssignments.some((assignment) => assignment.role !== "pending");
        if (hasActiveRecruitment || hasConfirmedAssignment) continue;

        const registration = registrations.find((item) => item.data.user_global_id === leaderId);
        if (!registration) continue;
        const nextEvents = (registration.data.events_registered ?? []).filter(
            (candidate) => normalize(candidate) !== normalize(eventId),
        );
        await registration.ref.update({events_registered: nextEvents, updated_at: Timestamp.now()});
        if (registration.data.user_id) {
            const userRef = db.collection("users").doc(registration.data.user_id);
            const userSnapshot = await userRef.get();
            if (userSnapshot.exists) {
                const userData = userSnapshot.data() as {
                    registration_records?: Array<{tournament_id?: string; events?: string[]}>;
                };
                const records = (userData.registration_records ?? []).map((record) =>
                    record.tournament_id === tournamentId
                        ? {
                              ...record,
                              events: (record.events ?? []).filter((candidate) => normalize(candidate) !== normalize(eventId)),
                          }
                        : record,
                );
                await userRef.update({registration_records: records, updated_at: Timestamp.now()});
            }
        }
    }

    for (const staleRequest of staleRequests) {
        await staleRequest.ref.set({status: "expired", expired_at: Timestamp.now(), updated_at: Timestamp.now()}, {merge: true});
    }

    for (const missing of missingRequests.filter((item) => !item.conflict)) {
        const team = teamById.get(missing.teamId);
        if (!team) continue;
        const leaderNameSnapshot = await db
            .collection("users")
            .where("global_id", "==", team.data.leader_id ?? "")
            .limit(1)
            .get();
        const leaderName = leaderNameSnapshot.empty ? "" : ((leaderNameSnapshot.docs[0].data().name as string | undefined) ?? "");
        const eventId = team.data.event_id ?? "";
        const now = Timestamp.now();
        await db
            .collection("verification_requests")
            .doc(requestIdFor(team.id, missing.memberId))
            .set(
                {
                    target_global_id: missing.memberId,
                    member_id: missing.memberId,
                    tournament_id: tournamentId,
                    team_id: team.id,
                    registration_id: team.data.registration_id ?? "",
                    status: "pending",
                    event_label: eventById.get(eventId) ?? eventId,
                    team_name: team.data.name ?? null,
                    leader_label: leaderName ? `${leaderName} (${team.data.leader_id})` : (team.data.leader_id ?? ""),
                    email_status: "pending",
                    created_at: now,
                    updated_at: now,
                    rejected_at: FieldValue.delete(),
                    rejected_by: FieldValue.delete(),
                    expired_at: FieldValue.delete(),
                },
                {merge: true},
            );
    }

    console.info("Repair applied. Re-run without --apply to confirm the remaining report.");
};

const run = syncRegistrationTeams ? syncRegistrationTeamSnapshots : main;

run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
