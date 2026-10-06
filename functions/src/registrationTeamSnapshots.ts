import {type DocumentData, type Firestore, Timestamp} from "firebase-admin/firestore";
import {type ImportJournalEntry, stableChecksum} from "./importIdempotency.js";

type TeamSnapshot = {
    team_id: string;
    label?: string | null;
    name: string;
    member: Array<{global_id?: string | null; verified?: boolean}>;
    leader: {global_id?: string | null; verified?: boolean};
    looking_for_team_members?: boolean;
};

const normalizeName = (value: unknown): string =>
    String(value ?? "")
        .normalize("NFC")
        .replace(/(?:\u200B|\u200C|\u200D|\uFEFF)/gu, "")
        .replace(/\s+/gu, " ")
        .trim();

const sortedTeams = (teams: TeamSnapshot[]): TeamSnapshot[] =>
    [...teams].sort((left, right) => left.team_id.localeCompare(right.team_id));

const teamsOf = (registration: DocumentData): TeamSnapshot[] => (Array.isArray(registration.teams) ? registration.teams : []);

export const projectRegistrationTeams = (registration: DocumentData, teams: DocumentData[]): TeamSnapshot[] => {
    const existing = new Map(teamsOf(registration).map((team) => [team.team_id, team]));
    const participantId = registration.user_global_id;
    return sortedTeams(
        teams
            .filter(
                (team) =>
                    team.tournament_id === registration.tournament_id &&
                    (team.leader_id === participantId ||
                        (team.members ?? []).some(
                            (member: {global_id?: string; verified?: boolean}) =>
                                member.global_id === participantId && member.verified,
                        )),
            )
            .map((team) => {
                const previous = existing.get(team.id);
                const name = team.name ?? "";
                return {
                    team_id: team.id,
                    label: normalizeName(previous?.label) === normalizeName(name) ? (previous?.label ?? name) : name,
                    name: normalizeName(previous?.name) === normalizeName(name) ? (previous?.name ?? name) : name,
                    member: (team.members ?? []).map((member: {global_id: string; verified?: boolean}) => ({
                        global_id: member.global_id,
                        verified: Boolean(member.verified),
                    })),
                    leader: {global_id: team.leader_id ?? null, verified: true},
                    looking_for_team_members: Boolean(team.looking_for_member),
                };
            }),
    );
};

/** Read the source teams in the same transaction as the registration. Trigger
 * payloads may be delayed or delivered out of order; they are never the source. */
export const syncTournamentRegistrationTeams = async (
    database: Firestore,
    tournamentId: string,
    participantIds?: Set<string>,
): Promise<void> => {
    const registrations = await database.collection("registrations").where("tournament_id", "==", tournamentId).get();
    const selected = registrations.docs.filter(
        (registration) => !participantIds || participantIds.has(String(registration.data().user_global_id)),
    );
    // Read the tournament's source teams once per group instead of once for
    // every registration. The transaction still protects all source reads.
    for (let offset = 0; offset < selected.length; offset += 100) {
        const group = selected.slice(offset, offset + 100);
        await database.runTransaction(async (transaction) => {
            const current = await transaction.getAll(...group.map((registration) => registration.ref));
            const teams = await transaction.get(database.collection("teams").where("tournament_id", "==", tournamentId));
            const sourceTeams = teams.docs.map((team) => ({...team.data(), id: team.id}));
            for (const registration of current) {
                if (!registration.exists || registration.data()?.tournament_id !== tournamentId) continue;
                const data = registration.data() as DocumentData;
                const projected = projectRegistrationTeams(data, sourceTeams);
                if (stableChecksum(data.teams ?? []) === stableChecksum(projected)) continue;
                transaction.update(registration.ref, {teams: projected, updated_at: Timestamp.now()});
            }
        });
    }
};

const registrationWithoutSyncFields = (registration: DocumentData): DocumentData =>
    Object.fromEntries(Object.entries(registration).filter(([field]) => field !== "updated_at" && field !== "teams"));

/** Version-one journals can contain an intermediate registration cache. Only
 * accept the cache produced by the journal's team state, never arbitrary teams. */
export const importJournalEntryMatches = (
    entry: ImportJournalEntry,
    current: DocumentData | null,
    entries: ImportJournalEntry[],
    currentTeams: DocumentData[],
): boolean => {
    const exactMatch = stableChecksum(current) === entry.afterChecksum;
    if (!entry.path.startsWith("registrations/") || !current || !entry.after) return exactMatch;
    if (stableChecksum(registrationWithoutSyncFields(current)) !== stableChecksum(registrationWithoutSyncFields(entry.after))) {
        return false;
    }

    const teamEntries = entries.filter((change) => change.path.startsWith("teams/"));
    const journalTeamIds = new Set(teamEntries.map((change) => change.path.split("/")[1]));
    const baselineTeams = teamEntries
        .filter((change) => change.after !== null)
        .map((change) => ({...change.after, id: change.path.split("/")[1]}));
    const unchangedSnapshots = teamsOf(entry.after).filter((team) => !journalTeamIds.has(team.team_id));
    const expectedTeams = sortedTeams([...unchangedSnapshots, ...projectRegistrationTeams(entry.after, baselineTeams)]);

    // Check source documents as well as the cache. New teams and edited members
    // must block even when an asynchronous cache update has not arrived yet.
    const currentById = new Map(currentTeams.map((team) => [team.id, team]));
    for (const change of teamEntries) {
        const team = currentById.get(change.path.split("/")[1]);
        if (stableChecksum(team ?? null) !== change.afterChecksum) return false;
    }
    return (
        (stableChecksum(sortedTeams(teamsOf(current))) === stableChecksum(sortedTeams(teamsOf(entry.after))) ||
            stableChecksum(sortedTeams(teamsOf(current))) === stableChecksum(expectedTeams)) &&
        stableChecksum(projectRegistrationTeams(entry.after, currentTeams)) === stableChecksum(expectedTeams)
    );
};
