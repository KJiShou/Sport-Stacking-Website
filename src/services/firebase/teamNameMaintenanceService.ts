import type {Registration, Team, TournamentEvent} from "@/schema";
import {fetchUsersByGlobalIds} from "@/services/firebase/authService";
import {type LegacyTeam, dedupeTeamsByEvent} from "@/utils/teamDeduplication";
import {stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {
    calculateTeamAgeForEvent,
    createMaintenanceFingerprint,
    getResolvedTeamEvent,
    getTeamEventDisplayLabel,
    getTeamEventType,
    isTeamRelayTeam,
    stableSerialize,
    teamNamesEqual,
} from "@/utils/teamNameMaintenance";
import {collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where} from "firebase/firestore";
import {upsertAdminTeam} from "./adminTeamService";
import {db} from "./config";
import {getActiveTeamRecruitments} from "./teamRecruitmentService";
import {deleteTeam, fetchTournamentEvents} from "./tournamentsService";
import {deleteVerificationRequestsByTeamId} from "./verificationRequestService";

type RegistrationTeamEntry = NonNullable<Registration["teams"]>[number];
type RegistrationRecord = Registration & {id: string};
type TeamRecord = Team & {id: string};

export type TeamNameUpdateTeamChange = {
    teamId: string;
    teamName: string;
    event: string;
    action: "update" | "merge" | "delete";
    isTeamRelay: boolean;
    currentName: string;
    nextName: string;
    currentAge: number | null;
    nextAge: number | null;
    changedFields: string[];
    keptTeamId?: string;
    keptTeamName?: string;
};

export type TeamNameUpdateRegistrationChange = {
    registrationId: string;
    userGlobalId: string;
    userName: string;
    teamId: string;
    action: "update" | "create" | "delete";
    currentName: string | null;
    nextName: string | null;
    currentLabel: string | null;
    nextLabel: string | null;
    changedFields: string[];
};

export type TeamNameUpdateRegistrationGroup = {
    teamId: string;
    teamName: string;
    event: string;
    action: "update" | "create" | "delete" | "mixed";
    registrationCount: number;
    currentName: string | null;
    nextName: string | null;
    currentLabel: string | null;
    nextLabel: string | null;
    changedFields: string[];
    changes: TeamNameUpdateRegistrationChange[];
};

export type TeamNameUpdateCleanupChange = {
    collection: "verification_requests" | "team_recruitment";
    documentId: string;
    teamId: string;
    teamName: string;
    keptTeamName?: string;
    action: "delete";
};

export type TeamNameUpdateSummary = {
    teamNameUpdates: number;
    teamAgeUpdates: number;
    teamDocuments: number;
    registrationDocuments: number;
    registrationEntries: number;
    duplicateTeams: number;
    cleanupDocuments: number;
    skippedTeamRelayNames: number;
};

export type TeamNameUpdatePreview = {
    tournamentId: string;
    fingerprint: string;
    generatedAt: number;
    summary: TeamNameUpdateSummary;
    teamChanges: TeamNameUpdateTeamChange[];
    registrationChanges: TeamNameUpdateRegistrationChange[];
    registrationGroups: TeamNameUpdateRegistrationGroup[];
    cleanupChanges: TeamNameUpdateCleanupChange[];
};

export type TeamNameUpdateResult = TeamNameUpdateSummary & {
    operationId?: string;
};

type TeamSnapshot = {id: string; data: TeamRecord};
type RegistrationSnapshot = {id: string; data: RegistrationRecord};

type DedupeProjection = {
    projectedTeams: Map<string, TeamRecord>;
    duplicateTeamIds: Set<string>;
    duplicateToCanonical: Map<string, string>;
    projectedRegistrationTeams: Map<string, RegistrationTeamEntry[]>;
};

type TeamMutation = {
    current: TeamRecord;
    next: TeamRecord;
    change: TeamNameUpdateTeamChange;
};

type RegistrationMutation = {
    current: RegistrationSnapshot;
    nextTeams: RegistrationTeamEntry[];
};

type InternalPlan = {
    preview: TeamNameUpdatePreview;
    teamMutations: TeamMutation[];
    registrationMutations: RegistrationMutation[];
    duplicateTeamIds: string[];
    teamRecruitmentIds: Map<string, string>;
};

type TeamDisplayInfo = {
    teamName: string;
    event: string;
};

const normalizeId = (value: string | null | undefined): string => value?.trim() ?? "";

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const compareMapEntriesByKey = <T>([left]: [string, T], [right]: [string, T]): number => left.localeCompare(right);

const buildTeamParticipantIds = (team: TeamRecord): string[] =>
    [
        stripTeamLeaderPrefix(team.leader_id ?? "").trim(),
        ...(team.members ?? []).map((member) => normalizeId(member.global_id)),
    ].filter(Boolean);

const buildRegistrationParticipantLookup = (registrations: Registration[]): Map<string, string[]> => {
    const result = new Map<string, string[]>();
    for (const registration of registrations) {
        const registrationId = normalizeId(registration.id);
        if (!registrationId) continue;
        for (const participantId of [normalizeId(registration.user_global_id), normalizeId(registration.user_id)].filter(
            Boolean,
        )) {
            const ids = result.get(participantId) ?? [];
            if (!ids.includes(registrationId)) ids.push(registrationId);
            result.set(participantId, ids);
        }
    }
    return result;
};

const resolveTeamRegistrationId = (team: TeamRecord, lookup: Map<string, string[]>): string | null => {
    const direct = normalizeId(team.registration_id);
    if (direct) return direct;
    const candidates = new Set<string>();
    for (const participantId of buildTeamParticipantIds(team)) {
        for (const registrationId of lookup.get(participantId) ?? []) candidates.add(registrationId);
    }
    return candidates.size === 1 ? Array.from(candidates)[0] : null;
};

const buildRegistrationLookup = (registrations: Registration[]): Map<string, Registration> => {
    const result = new Map<string, Registration>();
    for (const registration of registrations) {
        if (registration.user_global_id) result.set(registration.user_global_id.trim(), registration);
        if (registration.user_id && !result.has(registration.user_id.trim()))
            result.set(registration.user_id.trim(), registration);
    }
    return result;
};

const registrationTeamArray = (registration: RegistrationRecord): RegistrationTeamEntry[] =>
    Array.isArray(registration.teams) ? registration.teams : [];

const teamEventGroupKey = (team: TeamRecord, events: TournamentEvent[]): string => {
    const resolved = getResolvedTeamEvent(team, events);
    if (resolved) return `event:${(resolved.id || resolved.type).toLowerCase()}`;
    const eventId = normalizeId(team.event_id).toLowerCase();
    if (eventId) return `event:${eventId}`;
    const eventName = Array.isArray(team.event) ? normalizeId(team.event[0]).toLowerCase() : "";
    return eventName ? `name:${eventName}` : `team:${team.id}`;
};

const teamStructuralFields = ["members", "event", "event_id", "leader_id", "registration_id", "looking_for_member"] as const;

const teamStructuralChanged = (current: TeamRecord, next: TeamRecord): string[] =>
    teamStructuralFields.filter((field) => stableSerialize(current[field]) !== stableSerialize(next[field]));

const getTeamName = (team: TeamRecord): string => normalizeId(team.name);

const getTeamAge = (team: TeamRecord): number | null => (typeof team.team_age === "number" ? team.team_age : null);

const getParticipantNameMap = async (registrations: RegistrationRecord[], teams: TeamRecord[]): Promise<Map<string, string>> => {
    const nameMap = new Map<string, string>();
    for (const registration of registrations) {
        if (registration.user_global_id && registration.user_name) {
            nameMap.set(registration.user_global_id, registration.user_name);
        }
    }

    const missingIds = Array.from(
        new Set(
            teams.flatMap((team) => [
                stripTeamLeaderPrefix(team.leader_id ?? "").trim(),
                ...(team.members ?? []).map((member) => normalizeId(member.global_id)),
            ]),
        ),
    ).filter((globalId) => globalId.length > 0 && !nameMap.has(globalId));

    if (missingIds.length > 0) {
        const users = await fetchUsersByGlobalIds(missingIds);
        for (const [globalId, user] of Object.entries(users)) {
            const name = normalizeId(user.name);
            if (name) nameMap.set(globalId, name);
        }
    }

    return nameMap;
};

const calculateTeamName = (team: TeamRecord, registrations: Map<string, Registration>, nameMap: Map<string, string>): string => {
    const leaderId = stripTeamLeaderPrefix(team.leader_id ?? "").trim();
    const leaderName = leaderId ? nameMap.get(leaderId) : undefined;
    const memberNames = (team.members ?? [])
        .map((member) => nameMap.get(normalizeId(member.global_id)))
        .filter((name): name is string => Boolean(name));
    const names = [leaderName, ...memberNames].filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(" & ") : getTeamName(team);
};

const calculateTeamAge = (team: TeamRecord, events: TournamentEvent[], registrations: Map<string, Registration>): number => {
    const ages = [
        stripTeamLeaderPrefix(team.leader_id ?? "").trim(),
        ...(team.members ?? []).map((member) => normalizeId(member.global_id)),
    ]
        .map((participantId) => registrations.get(participantId)?.age)
        .filter((age): age is number => typeof age === "number" && Number.isFinite(age));
    return calculateTeamAgeForEvent(ages, getTeamEventType(team, events));
};

const groupTeamsByRegistration = (teams: TeamSnapshot[], participantLookup: Map<string, string[]>): Map<string, TeamRecord[]> => {
    const teamsByRegistration = new Map<string, TeamRecord[]>();
    for (const {id, data} of teams) {
        const resolvedRegistrationId = resolveTeamRegistrationId(data, participantLookup);
        if (!resolvedRegistrationId) continue;
        const bucket = teamsByRegistration.get(resolvedRegistrationId) ?? [];
        bucket.push({...data, id, registration_id: resolvedRegistrationId});
        teamsByRegistration.set(resolvedRegistrationId, bucket);
    }
    return teamsByRegistration;
};

type DedupeCandidates = {
    canonicalTeamsById: Map<string, TeamRecord>;
    duplicateTeamIds: Set<string>;
    duplicateToCanonical: Map<string, string>;
};

const collectDedupeCandidates = (
    teamsByRegistration: Map<string, TeamRecord[]>,
    events: TournamentEvent[],
    projectedTeams: Map<string, TeamRecord>,
): DedupeCandidates => {
    const canonicalTeamsById = new Map<string, TeamRecord>();
    const duplicateTeamIds = new Set<string>();
    const duplicateToCanonical = new Map<string, string>();

    for (const registrationTeams of teamsByRegistration.values()) {
        const deduped = dedupeTeamsByEvent(registrationTeams as LegacyTeam[], events, registrationTeams[0]?.registration_id);
        for (const canonical of deduped.teams) {
            const current = projectedTeams.get(canonical.id);
            if (!current) continue;
            canonicalTeamsById.set(canonical.id, {...current, ...canonical, id: canonical.id});
        }
        for (const duplicateId of deduped.duplicateTeamIds) {
            duplicateTeamIds.add(duplicateId);
            const duplicate = registrationTeams.find((team) => team.id === duplicateId);
            const duplicateKey = duplicate ? teamEventGroupKey(duplicate, events) : "";
            const canonical = deduped.teams.find((team) => teamEventGroupKey(team, events) === duplicateKey);
            if (canonical) duplicateToCanonical.set(duplicateId, canonical.id);
        }
    }

    return {canonicalTeamsById, duplicateTeamIds, duplicateToCanonical};
};

const buildProjectedRegistrationTeams = (
    registrations: RegistrationSnapshot[],
    teamsByRegistration: Map<string, TeamRecord[]>,
    canonicalTeamsById: Map<string, TeamRecord>,
    duplicateTeamIds: Set<string>,
): Map<string, RegistrationTeamEntry[]> => {
    const projectedRegistrationTeams = new Map<string, RegistrationTeamEntry[]>();
    for (const registration of registrations) {
        const registrationId = normalizeId(registration.data.id);
        const existing = registrationTeamArray(registration.data);
        const canonicalTeams = (teamsByRegistration.get(registrationId) ?? [])
            .map((team) => canonicalTeamsById.get(team.id))
            .filter((team): team is TeamRecord => Boolean(team))
            .filter((team, index, source) => source.findIndex((candidate) => candidate.id === team.id) === index);
        if (canonicalTeams.length === 0) {
            projectedRegistrationTeams.set(registration.id, existing);
            continue;
        }
        const canonicalIds = new Set(canonicalTeams.map((team) => team.id));
        const filtered = existing.filter((entry) => !duplicateTeamIds.has(entry.team_id) && !canonicalIds.has(entry.team_id));
        projectedRegistrationTeams.set(registration.id, [
            ...filtered,
            ...canonicalTeams.map((team) => buildRegistrationTeamPayload(team)),
        ]);
    }
    return projectedRegistrationTeams;
};

const buildDedupeProjection = (
    teams: TeamSnapshot[],
    registrations: RegistrationSnapshot[],
    events: TournamentEvent[],
): DedupeProjection => {
    const participantLookup = buildRegistrationParticipantLookup(registrations.map((snapshot) => snapshot.data));
    const teamsByRegistration = groupTeamsByRegistration(teams, participantLookup);
    const projectedTeams = new Map<string, TeamRecord>(teams.map(({id, data}) => [id, {...data, id}]));
    const {canonicalTeamsById, duplicateTeamIds, duplicateToCanonical} = collectDedupeCandidates(
        teamsByRegistration,
        events,
        projectedTeams,
    );
    if (duplicateTeamIds.size > 0) {
        for (const [id, canonical] of canonicalTeamsById) projectedTeams.set(id, canonical);
    }
    const projectedRegistrationTeams =
        duplicateTeamIds.size === 0
            ? new Map(registrations.map((registration) => [registration.id, registrationTeamArray(registration.data)]))
            : buildProjectedRegistrationTeams(registrations, teamsByRegistration, canonicalTeamsById, duplicateTeamIds);
    return {projectedTeams, duplicateTeamIds, duplicateToCanonical, projectedRegistrationTeams};
};

const buildRegistrationTeamPayload = (team: TeamRecord): RegistrationTeamEntry => ({
    team_id: team.id,
    label: team.name,
    name: team.name,
    member: (team.members ?? []).map((member) => ({
        global_id: normalizeId(member.global_id) || null,
        verified: Boolean(member.verified),
    })),
    leader: {
        global_id: normalizeId(stripTeamLeaderPrefix(team.leader_id ?? "")) || null,
        verified: true,
    },
    looking_for_team_members: Boolean(team.looking_for_member),
});

const entryChangedFields = (current: RegistrationTeamEntry | undefined, next: RegistrationTeamEntry | undefined): string[] => {
    if (!current && next) return ["create"];
    if (current && !next) return ["delete"];
    if (!current || !next) return [];
    const changedFields: string[] = [];
    if (!teamNamesEqual(current.name, next.name)) changedFields.push("name");
    if (!teamNamesEqual(current.label, next.label)) changedFields.push("label");
    const structuralFields: Array<keyof RegistrationTeamEntry> = ["member", "leader", "looking_for_team_members"];
    changedFields.push(...structuralFields.filter((field) => stableSerialize(current[field]) !== stableSerialize(next[field])));
    return changedFields;
};

const preserveSemanticallyEqualRegistrationNames = (
    currentTeams: RegistrationTeamEntry[],
    nextTeams: RegistrationTeamEntry[],
): RegistrationTeamEntry[] => {
    const currentByTeamId = new Map(currentTeams.map((entry) => [entry.team_id, entry]));
    return nextTeams.map((entry) => {
        const current = currentByTeamId.get(entry.team_id);
        if (!current) return entry;
        return {
            ...entry,
            ...(teamNamesEqual(current.name, entry.name) ? {name: current.name} : {}),
            ...(teamNamesEqual(current.label, entry.label) ? {label: current.label} : {}),
        };
    });
};

const mergeChangedRegistrationEntry = (
    latestEntry: RegistrationTeamEntry,
    before: RegistrationTeamEntry,
    after: RegistrationTeamEntry,
): RegistrationTeamEntry => {
    const changedFields = entryChangedFields(before, after);
    if (changedFields.length === 0) return latestEntry;

    const nextEntry = {...latestEntry};
    if (changedFields.includes("name") && !teamNamesEqual(latestEntry.name, after.name)) nextEntry.name = after.name;
    if (changedFields.includes("label") && !teamNamesEqual(latestEntry.label, after.label)) nextEntry.label = after.label;
    if (changedFields.includes("member")) nextEntry.member = after.member;
    if (changedFields.includes("leader")) nextEntry.leader = after.leader;
    if (changedFields.includes("looking_for_team_members")) {
        nextEntry.looking_for_team_members = after.looking_for_team_members;
    }
    return nextEntry;
};

const mergeLatestRegistrationEntry = (
    latestEntry: RegistrationTeamEntry,
    before: RegistrationTeamEntry | undefined,
    after: RegistrationTeamEntry | undefined,
): RegistrationTeamEntry | null => {
    if (!before && !after) return latestEntry;
    if (before && !after) return entryChangedFields(before, after).includes("delete") ? null : latestEntry;
    if (!before || !after) return latestEntry;
    return mergeChangedRegistrationEntry(latestEntry, before, after);
};

const appendNewPlannedEntries = (
    merged: RegistrationTeamEntry[],
    plannedById: Map<string, RegistrationTeamEntry>,
    latestById: Map<string, RegistrationTeamEntry>,
    originalById: Map<string, RegistrationTeamEntry>,
): void => {
    for (const [teamId, after] of plannedById) {
        if (latestById.has(teamId)) continue;
        const before = originalById.get(teamId);
        if (!before || entryChangedFields(before, after).length > 0) merged.push(after);
    }
};

const getRegistrationChangeAction = (changedFields: string[]): "update" | "create" | "delete" => {
    if (changedFields[0] === "create") return "create";
    if (changedFields[0] === "delete") return "delete";
    return "update";
};

const mergeRegistrationMutationIntoLatest = (
    mutation: RegistrationMutation,
    latestTeams: RegistrationTeamEntry[],
): RegistrationTeamEntry[] => {
    const originalById = new Map(registrationTeamArray(mutation.current.data).map((entry) => [entry.team_id, entry]));
    const plannedById = new Map(mutation.nextTeams.map((entry) => [entry.team_id, entry]));
    const latestById = new Map(latestTeams.map((entry) => [entry.team_id, entry]));
    const merged: RegistrationTeamEntry[] = [];

    for (const latestEntry of latestTeams) {
        const mergedEntry = mergeLatestRegistrationEntry(
            latestEntry,
            originalById.get(latestEntry.team_id),
            plannedById.get(latestEntry.team_id),
        );
        if (mergedEntry) merged.push(mergedEntry);
    }
    appendNewPlannedEntries(merged, plannedById, latestById, originalById);
    return merged;
};

const buildRegistrationChanges = (
    registrations: RegistrationSnapshot[],
    nextTeamsByRegistration: Map<string, RegistrationTeamEntry[]>,
): {changes: TeamNameUpdateRegistrationChange[]; mutations: RegistrationMutation[]} => {
    const changes: TeamNameUpdateRegistrationChange[] = [];
    const mutations: RegistrationMutation[] = [];
    for (const current of registrations) {
        const currentTeams = registrationTeamArray(current.data);
        const nextTeams = nextTeamsByRegistration.get(current.id) ?? currentTeams;
        if (stableSerialize(currentTeams) === stableSerialize(nextTeams)) continue;
        mutations.push({current, nextTeams});
        const currentById = new Map(currentTeams.map((entry) => [entry.team_id, entry]));
        const nextById = new Map(nextTeams.map((entry) => [entry.team_id, entry]));
        const teamIds = Array.from(new Set([...currentById.keys(), ...nextById.keys()]));
        for (const teamId of teamIds) {
            const before = currentById.get(teamId);
            const after = nextById.get(teamId);
            const changedFields = entryChangedFields(before, after);
            if (changedFields.length === 0) continue;
            changes.push({
                registrationId: current.id,
                userGlobalId: current.data.user_global_id,
                userName: current.data.user_name,
                teamId,
                action: getRegistrationChangeAction(changedFields),
                currentName: before?.name ?? null,
                nextName: after?.name ?? null,
                currentLabel: before?.label ?? null,
                nextLabel: after?.label ?? null,
                changedFields,
            });
        }
    }
    return {changes, mutations};
};

const summarizeRegistrationValues = (values: Array<string | null>): string | null => {
    const uniqueValues = Array.from(new Set(values.map((value) => value ?? null)));
    if (uniqueValues.length === 0 || (uniqueValues.length === 1 && uniqueValues[0] === null)) return null;
    return uniqueValues.length === 1 ? uniqueValues[0] : "Multiple current values";
};

const buildRegistrationGroups = (
    changes: TeamNameUpdateRegistrationChange[],
    teamDisplayById: Map<string, TeamDisplayInfo>,
): TeamNameUpdateRegistrationGroup[] => {
    const states = new Map<
        string,
        {
            group: TeamNameUpdateRegistrationGroup;
            registrationIds: Set<string>;
            currentNames: Array<string | null>;
            nextNames: Array<string | null>;
            currentLabels: Array<string | null>;
            nextLabels: Array<string | null>;
        }
    >();

    for (const change of changes) {
        const existing = states.get(change.teamId);
        const display = teamDisplayById.get(change.teamId);
        const state = existing ?? {
            group: {
                teamId: change.teamId,
                teamName: display?.teamName ?? change.nextName ?? change.currentName ?? "Unknown team",
                event: display?.event ?? "Unknown event",
                action: change.action,
                registrationCount: 0,
                currentName: null,
                nextName: null,
                currentLabel: null,
                nextLabel: null,
                changedFields: [],
                changes: [],
            },
            registrationIds: new Set<string>(),
            currentNames: [],
            nextNames: [],
            currentLabels: [],
            nextLabels: [],
        };

        state.group.changes.push(change);
        state.registrationIds.add(change.registrationId);
        state.group.action = state.group.action === change.action ? state.group.action : "mixed";
        for (const field of change.changedFields) {
            if (!state.group.changedFields.includes(field)) state.group.changedFields.push(field);
        }
        if (change.changedFields.includes("name")) {
            state.currentNames.push(change.currentName);
            state.nextNames.push(change.nextName);
        }
        if (change.changedFields.includes("label")) {
            state.currentLabels.push(change.currentLabel);
            state.nextLabels.push(change.nextLabel);
        }
        states.set(change.teamId, state);
    }

    return Array.from(states.values()).map(({group, registrationIds, currentNames, nextNames, currentLabels, nextLabels}) => ({
        ...group,
        registrationCount: registrationIds.size,
        currentName: summarizeRegistrationValues(currentNames),
        nextName: summarizeRegistrationValues(nextNames),
        currentLabel: summarizeRegistrationValues(currentLabels),
        nextLabel: summarizeRegistrationValues(nextLabels),
    }));
};

const getKeptTeamName = (teamId: string, teamChanges: TeamNameUpdateTeamChange[]): string | undefined =>
    teamChanges.find((change) => change.teamId === teamId)?.keptTeamName;

const getTeamChangeAction = (isDuplicate: boolean, structuralFields: string[]): TeamNameUpdateTeamChange["action"] => {
    if (isDuplicate) return "delete";
    if (structuralFields.some((field) => field !== "name_skipped_team_relay")) return "merge";
    return "update";
};

const buildTeamChange = (
    current: TeamRecord,
    next: TeamRecord,
    events: TournamentEvent[],
    duplicateToCanonical: Map<string, string>,
    isDuplicate: boolean,
    rawName: string,
): TeamNameUpdateTeamChange | null => {
    const relay = isTeamRelayTeam(current, events);
    const structuralFields = teamStructuralChanged(current, next);
    const nameChanged = !relay && !teamNamesEqual(current.name, next.name);
    const ageChanged = getTeamAge(current) !== getTeamAge(next);
    if (!isDuplicate && !nameChanged && !ageChanged && structuralFields.length === 0) return null;
    if (relay && !teamNamesEqual(rawName, current.name)) structuralFields.push("name_skipped_team_relay");
    const action = getTeamChangeAction(isDuplicate, structuralFields);
    return {
        teamId: current.id,
        teamName: isDuplicate ? getTeamName(current) : getTeamName(next),
        event: getTeamEventDisplayLabel(current, events),
        action,
        isTeamRelay: relay,
        currentName: getTeamName(current),
        nextName: getTeamName(next),
        currentAge: getTeamAge(current),
        nextAge: isDuplicate ? null : getTeamAge(next),
        changedFields: [...structuralFields, ...(nameChanged ? ["name"] : []), ...(ageChanged ? ["team_age"] : [])],
        ...(duplicateToCanonical.has(current.id) ? {keptTeamId: duplicateToCanonical.get(current.id)} : {}),
    };
};

const fetchSource = async (tournamentId: string) => {
    const [events, teamsSnapshot, registrationsSnapshot, recruitments, verificationSnapshot] = await Promise.all([
        fetchTournamentEvents(tournamentId),
        getDocs(query(collection(db, "teams"), where("tournament_id", "==", tournamentId))),
        getDocs(query(collection(db, "registrations"), where("tournament_id", "==", tournamentId))),
        getActiveTeamRecruitments(tournamentId),
        getDocs(query(collection(db, "verification_requests"), where("tournament_id", "==", tournamentId))),
    ]);
    const teams: TeamSnapshot[] = teamsSnapshot.docs.map((snapshot) => ({
        id: snapshot.id,
        data: {...(snapshot.data() as Team), id: snapshot.id},
    }));
    const registrations: RegistrationSnapshot[] = registrationsSnapshot.docs.map((snapshot) => ({
        id: snapshot.id,
        data: {...(snapshot.data() as Registration), id: snapshot.id},
    }));
    const verificationByTeam = new Map<string, string[]>();
    for (const snapshot of verificationSnapshot.docs) {
        const teamId = normalizeId((snapshot.data() as {team_id?: string}).team_id);
        if (!teamId) continue;
        const ids = verificationByTeam.get(teamId) ?? [];
        ids.push(snapshot.id);
        verificationByTeam.set(teamId, ids);
    }
    for (const [teamId, ids] of verificationByTeam) {
        verificationByTeam.set(teamId, Array.from(new Set(ids)).sort(compareStrings));
    }
    return {events, teams, registrations, recruitments, verificationByTeam};
};

const fetchVerificationRequestsByTeamIds = async (teamIds: string[]): Promise<Map<string, string[]>> => {
    const uniqueTeamIds = Array.from(new Set(teamIds.map(normalizeId).filter(Boolean)));
    const result = new Map<string, string[]>();
    if (uniqueTeamIds.length === 0) return result;

    const chunks: string[][] = [];
    for (let index = 0; index < uniqueTeamIds.length; index += 30) {
        chunks.push(uniqueTeamIds.slice(index, index + 30));
    }

    const snapshots = await Promise.all(
        chunks.map((chunk) => getDocs(query(collection(db, "verification_requests"), where("team_id", "in", chunk)))),
    );
    for (const snapshot of snapshots) {
        for (const request of snapshot.docs) {
            const teamId = normalizeId((request.data() as {team_id?: string}).team_id);
            if (!teamId) continue;
            const ids = result.get(teamId) ?? [];
            ids.push(request.id);
            result.set(teamId, ids);
        }
    }
    for (const [teamId, ids] of result) {
        result.set(teamId, Array.from(new Set(ids)).sort(compareStrings));
    }
    return result;
};

const mergeDuplicateVerificationRequests = (
    verificationByTeam: Map<string, string[]>,
    duplicateIds: Set<string>,
    discoveredByTeam: Map<string, string[]>,
): void => {
    for (const duplicateId of duplicateIds) {
        const existing = verificationByTeam.get(duplicateId) ?? [];
        const discovered = discoveredByTeam.get(duplicateId) ?? [];
        verificationByTeam.set(duplicateId, Array.from(new Set([...existing, ...discovered])).sort(compareStrings));
    }
};

const initializeProjectedRegistrations = (
    registrations: RegistrationSnapshot[],
    projectedRegistrationTeams: Map<string, RegistrationTeamEntry[]>,
): Map<string, RegistrationTeamEntry[]> => {
    const nextRegistrations = new Map<string, RegistrationTeamEntry[]>();
    for (const registration of registrations) {
        const currentTeams = registrationTeamArray(registration.data);
        const base = projectedRegistrationTeams.get(registration.id) ?? currentTeams;
        const copiedBase = base.map((entry) => ({...entry}));
        nextRegistrations.set(registration.id, preserveSemanticallyEqualRegistrationNames(currentTeams, copiedBase));
    }
    return nextRegistrations;
};

const getCanonicalProjectedTeam = (current: TeamRecord, dedupe: DedupeProjection): TeamRecord => {
    const projected = dedupe.projectedTeams.get(current.id) ?? current;
    const canonicalId = dedupe.duplicateToCanonical.get(current.id);
    return canonicalId ? (dedupe.projectedTeams.get(canonicalId) ?? projected) : projected;
};

const getNextTeamName = (currentName: string, calculatedName: string, relay: boolean): string => {
    if (relay) return calculatedName;
    return teamNamesEqual(currentName, calculatedName) ? currentName : calculatedName;
};

const updateRegistrationTeamName = (
    entry: RegistrationTeamEntry,
    nextName: string,
): {entry: RegistrationTeamEntry; changed: boolean} => {
    const nextEntry = {...entry};
    let changed = false;
    if (!teamNamesEqual(entry.name, nextName)) {
        nextEntry.name = nextName;
        changed = true;
    }
    if (!teamNamesEqual(entry.label, nextName)) {
        nextEntry.label = nextName;
        changed = true;
    }
    return {entry: changed ? nextEntry : entry, changed};
};

const updateProjectedRegistrationTeamNames = (
    nextRegistrations: Map<string, RegistrationTeamEntry[]>,
    registrations: RegistrationSnapshot[],
    teamId: string,
    nextName: string,
): void => {
    for (const registration of registrations) {
        const entries = nextRegistrations.get(registration.id) ?? [];
        let changed = false;
        const updated = entries.map((entry) => {
            if (entry.team_id !== teamId) return entry;
            const result = updateRegistrationTeamName(entry, nextName);
            changed ||= result.changed;
            return result.entry;
        });
        if (changed) nextRegistrations.set(registration.id, updated);
    }
};

type TeamPlanningState = {
    teamMutations: TeamMutation[];
    teamChanges: TeamNameUpdateTeamChange[];
    teamDisplayById: Map<string, TeamDisplayInfo>;
    plannedTeamNameById: Map<string, string>;
    teamNameUpdates: number;
    teamAgeUpdates: number;
    skippedTeamRelayNames: number;
};

const planTeamChanges = (
    source: Awaited<ReturnType<typeof fetchSource>>,
    dedupe: DedupeProjection,
    duplicateIds: Set<string>,
    registrationMap: Map<string, Registration>,
    nameMap: Map<string, string>,
    nextRegistrations: Map<string, RegistrationTeamEntry[]>,
): TeamPlanningState => {
    const state: TeamPlanningState = {
        teamMutations: [],
        teamChanges: [],
        teamDisplayById: new Map(),
        plannedTeamNameById: new Map(),
        teamNameUpdates: 0,
        teamAgeUpdates: 0,
        skippedTeamRelayNames: 0,
    };

    for (const sourceTeam of source.teams) {
        const current = sourceTeam.data;
        const projected = getCanonicalProjectedTeam(current, dedupe);
        const relay = isTeamRelayTeam(current, source.events);
        const rawName = calculateTeamName(projected, registrationMap, nameMap);
        const calculatedName = relay ? projected.name : rawName;
        const nextName = getNextTeamName(current.name, calculatedName, relay);
        if (relay && !teamNamesEqual(rawName, projected.name)) state.skippedTeamRelayNames += 1;
        const nextAge = calculateTeamAge(projected, source.events, registrationMap);
        const next = {...projected, name: nextName, team_age: nextAge};
        const isDuplicate = duplicateIds.has(current.id);
        const teamNameForDisplay = isDuplicate ? getTeamName(current) : getTeamName(next);
        state.teamDisplayById.set(current.id, {
            teamName: teamNameForDisplay,
            event: getTeamEventDisplayLabel(current, source.events),
        });
        state.plannedTeamNameById.set(current.id, teamNameForDisplay);

        const change = buildTeamChange(current, next, source.events, dedupe.duplicateToCanonical, isDuplicate, rawName);
        if (change) {
            state.teamChanges.push(change);
            if (!isDuplicate && !relay && !teamNamesEqual(current.name, nextName)) state.teamNameUpdates += 1;
            if (!isDuplicate && getTeamAge(current) !== nextAge) state.teamAgeUpdates += 1;
            if (!isDuplicate) state.teamMutations.push({current, next, change});
        }
        if (!isDuplicate && !relay) {
            updateProjectedRegistrationTeamNames(nextRegistrations, source.registrations, current.id, nextName);
        }
    }

    return state;
};

const applyKeptTeamNames = (teamChanges: TeamNameUpdateTeamChange[], plannedTeamNameById: Map<string, string>): void => {
    for (const change of teamChanges) {
        if (change.keptTeamId) change.keptTeamName = plannedTeamNameById.get(change.keptTeamId) ?? "Unknown team";
    }
};

type CleanupPlan = {
    cleanupChanges: TeamNameUpdateCleanupChange[];
    teamRecruitmentIds: Map<string, string>;
};

const buildCleanupPlan = (
    duplicateIds: Set<string>,
    verificationByTeam: Map<string, string[]>,
    recruitments: Awaited<ReturnType<typeof fetchSource>>["recruitments"],
    teamDisplayById: Map<string, TeamDisplayInfo>,
    teamChanges: TeamNameUpdateTeamChange[],
): CleanupPlan => {
    const cleanupChanges: TeamNameUpdateCleanupChange[] = [];
    const teamRecruitmentIds = new Map<string, string>();
    for (const duplicateId of duplicateIds) {
        const teamName = teamDisplayById.get(duplicateId)?.teamName ?? "Unknown team";
        const keptTeamName = getKeptTeamName(duplicateId, teamChanges);
        for (const requestId of verificationByTeam.get(duplicateId) ?? []) {
            cleanupChanges.push({
                collection: "verification_requests",
                documentId: requestId,
                teamId: duplicateId,
                teamName,
                keptTeamName,
                action: "delete",
            });
        }
        const recruitment = recruitments.find((item) => item.team_id === duplicateId);
        if (!recruitment) continue;
        teamRecruitmentIds.set(duplicateId, recruitment.id);
        cleanupChanges.push({
            collection: "team_recruitment",
            documentId: recruitment.id,
            teamId: duplicateId,
            teamName,
            keptTeamName,
            action: "delete",
        });
    }
    return {cleanupChanges, teamRecruitmentIds};
};

const buildPlan = async (tournamentId: string): Promise<InternalPlan> => {
    const source = await fetchSource(tournamentId);
    const registrationMap = buildRegistrationLookup(source.registrations.map(({data}) => data));
    const nameMap = await getParticipantNameMap(
        source.registrations.map(({data}) => data),
        source.teams.map(({data}) => data),
    );
    const dedupe = buildDedupeProjection(source.teams, source.registrations, source.events);
    const duplicateIds = dedupe.duplicateTeamIds;
    const duplicateVerificationByTeam = await fetchVerificationRequestsByTeamIds(Array.from(duplicateIds));
    mergeDuplicateVerificationRequests(source.verificationByTeam, duplicateIds, duplicateVerificationByTeam);
    const nextRegistrations = initializeProjectedRegistrations(source.registrations, dedupe.projectedRegistrationTeams);
    const teamPlan = planTeamChanges(source, dedupe, duplicateIds, registrationMap, nameMap, nextRegistrations);
    applyKeptTeamNames(teamPlan.teamChanges, teamPlan.plannedTeamNameById);
    const registrationPlan = buildRegistrationChanges(source.registrations, nextRegistrations);
    const registrationGroups = buildRegistrationGroups(registrationPlan.changes, teamPlan.teamDisplayById);
    const cleanupPlan = buildCleanupPlan(
        duplicateIds,
        source.verificationByTeam,
        source.recruitments,
        teamPlan.teamDisplayById,
        teamPlan.teamChanges,
    );

    const fingerprint = createMaintenanceFingerprint({
        teams: source.teams,
        registrations: source.registrations,
        events: source.events,
        recruitments: source.recruitments,
        verificationByTeam: Array.from(source.verificationByTeam.entries()).sort(compareMapEntriesByKey),
        participantNames: Array.from(nameMap.entries()).sort(compareMapEntriesByKey),
    });
    const summary: TeamNameUpdateSummary = {
        teamNameUpdates: teamPlan.teamNameUpdates,
        teamAgeUpdates: teamPlan.teamAgeUpdates,
        teamDocuments: teamPlan.teamMutations.length + duplicateIds.size,
        registrationDocuments: registrationPlan.mutations.length,
        registrationEntries: registrationPlan.changes.length,
        duplicateTeams: duplicateIds.size,
        cleanupDocuments: cleanupPlan.cleanupChanges.length,
        skippedTeamRelayNames: teamPlan.skippedTeamRelayNames,
    };
    return {
        preview: {
            tournamentId,
            fingerprint,
            generatedAt: Date.now(),
            summary,
            teamChanges: teamPlan.teamChanges,
            registrationChanges: registrationPlan.changes,
            registrationGroups,
            cleanupChanges: cleanupPlan.cleanupChanges,
        },
        teamMutations: teamPlan.teamMutations,
        registrationMutations: registrationPlan.mutations,
        duplicateTeamIds: Array.from(duplicateIds),
        teamRecruitmentIds: cleanupPlan.teamRecruitmentIds,
    };
};

export async function previewTeamNameUpdatesForTournament(tournamentId: string): Promise<TeamNameUpdatePreview> {
    return (await buildPlan(tournamentId)).preview;
}

const applyTeamMutations = async (tournamentId: string, mutations: TeamMutation[]): Promise<void> => {
    for (const mutation of mutations) {
        await upsertAdminTeam(tournamentId, mutation.next, mutation.current.id);
    }
};

const applyRegistrationMutations = async (mutations: RegistrationMutation[]): Promise<void> => {
    for (const mutation of mutations) {
        const registrationRef = doc(db, "registrations", mutation.current.id);
        const latestSnapshot = await getDoc(registrationRef);
        if (!latestSnapshot.exists()) continue;
        const latestData = {...(latestSnapshot.data() as Registration), id: latestSnapshot.id};
        const latestTeams = registrationTeamArray(latestData);
        const nextTeams = mergeRegistrationMutationIntoLatest(mutation, latestTeams);
        if (stableSerialize(latestTeams) !== stableSerialize(nextTeams)) {
            await updateDoc(registrationRef, {teams: nextTeams});
        }
    }
};

const deleteDuplicateTeamAndCleanup = async (
    tournamentId: string,
    teamId: string,
    recruitmentId: string | undefined,
): Promise<void> => {
    try {
        await deleteTeam(tournamentId, teamId);
    } catch (error) {
        if (!(error instanceof Error && error.message.includes("Team not found"))) throw error;
    }
    await deleteVerificationRequestsByTeamId(teamId);
    if (recruitmentId) await deleteDoc(doc(db, "team_recruitment", recruitmentId));
};

const applyDuplicateTeamCleanup = async (plan: InternalPlan, tournamentId: string): Promise<void> => {
    for (const teamId of plan.duplicateTeamIds) {
        await deleteDuplicateTeamAndCleanup(tournamentId, teamId, plan.teamRecruitmentIds.get(teamId));
    }
};

export async function applyTeamNameUpdatesForTournament(
    tournamentId: string,
    fingerprint: string,
): Promise<TeamNameUpdateResult> {
    const plan = await buildPlan(tournamentId);
    if (plan.preview.fingerprint !== fingerprint) {
        throw new Error("TEAM_NAME_PREVIEW_STALE");
    }

    await applyTeamMutations(tournamentId, plan.teamMutations);
    await applyRegistrationMutations(plan.registrationMutations);
    await applyDuplicateTeamCleanup(plan, tournamentId);

    return {...plan.preview.summary};
}
