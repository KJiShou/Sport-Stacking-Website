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

const buildDedupeProjection = (
    teams: TeamSnapshot[],
    registrations: RegistrationSnapshot[],
    events: TournamentEvent[],
): DedupeProjection => {
    const registrationData = registrations.map((snapshot) => snapshot.data);
    const participantLookup = buildRegistrationParticipantLookup(registrationData);
    const teamsByRegistration = new Map<string, TeamRecord[]>();
    const projectedTeams = new Map(teams.map(({id, data}) => [id, {...data, id}]));
    const duplicateTeamIds = new Set<string>();
    const duplicateToCanonical = new Map<string, string>();
    const canonicalTeamsById = new Map<string, TeamRecord>();

    for (const {id, data} of teams) {
        const resolvedRegistrationId = resolveTeamRegistrationId(data, participantLookup);
        if (!resolvedRegistrationId) continue;
        const normalized = {...data, id, registration_id: resolvedRegistrationId};
        const bucket = teamsByRegistration.get(resolvedRegistrationId) ?? [];
        bucket.push(normalized);
        teamsByRegistration.set(resolvedRegistrationId, bucket);
    }

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

    if (duplicateTeamIds.size === 0) {
        return {
            projectedTeams: new Map(teams.map(({id, data}) => [id, {...data, id}])),
            duplicateTeamIds,
            duplicateToCanonical,
            projectedRegistrationTeams: new Map(
                registrations.map((registration) => [registration.id, registrationTeamArray(registration.data)]),
            ),
        };
    }

    for (const [id, canonical] of canonicalTeamsById) {
        projectedTeams.set(id, canonical);
    }

    const projectedRegistrationTeams = new Map<string, RegistrationTeamEntry[]>();
    for (const registration of registrations) {
        const registrationId = normalizeId(registration.data.id);
        const existing = registrationTeamArray(registration.data);
        const canonicalTeams = (teamsByRegistration.get(registrationId) ?? [])
            .map((team) => canonicalTeamsById.get(team.id))
            .filter((team): team is TeamRecord => Boolean(team))
            .filter((team, index, source) => source.findIndex((candidate) => candidate.id === team.id) === index);
        const canonicalIds = new Set(canonicalTeams.map((team) => team.id));
        const filtered = existing.filter(
            (entry) => !duplicateTeamIds.has(entry.team_id) && (!canonicalIds.has(entry.team_id) || canonicalTeams.length === 0),
        );
        projectedRegistrationTeams.set(
            registration.id,
            canonicalTeams.length > 0
                ? [...filtered, ...canonicalTeams.map((team) => buildRegistrationTeamPayload(team))]
                : existing,
        );
    }

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

const mergeRegistrationMutationIntoLatest = (
    mutation: RegistrationMutation,
    latestTeams: RegistrationTeamEntry[],
): RegistrationTeamEntry[] => {
    const originalTeams = registrationTeamArray(mutation.current.data);
    const originalById = new Map(originalTeams.map((entry) => [entry.team_id, entry]));
    const plannedById = new Map(mutation.nextTeams.map((entry) => [entry.team_id, entry]));
    const latestById = new Map(latestTeams.map((entry) => [entry.team_id, entry]));
    const merged: RegistrationTeamEntry[] = [];

    for (const latestEntry of latestTeams) {
        const before = originalById.get(latestEntry.team_id);
        const after = plannedById.get(latestEntry.team_id);
        if (!before && !after) {
            merged.push(latestEntry);
            continue;
        }
        if (before && !after) {
            if (!entryChangedFields(before, after).includes("delete")) merged.push(latestEntry);
            continue;
        }
        if (!before || !after) {
            merged.push(latestEntry);
            continue;
        }

        const changedFields = entryChangedFields(before, after);
        if (changedFields.length === 0) {
            merged.push(latestEntry);
            continue;
        }

        const nextEntry = {...latestEntry};
        if (changedFields.includes("name") && !teamNamesEqual(latestEntry.name, after.name)) {
            nextEntry.name = after.name;
        }
        if (changedFields.includes("label") && !teamNamesEqual(latestEntry.label, after.label)) {
            nextEntry.label = after.label;
        }
        if (changedFields.includes("member")) nextEntry.member = after.member;
        if (changedFields.includes("leader")) nextEntry.leader = after.leader;
        if (changedFields.includes("looking_for_team_members")) {
            nextEntry.looking_for_team_members = after.looking_for_team_members;
        }
        merged.push(nextEntry);
    }

    for (const [teamId, after] of plannedById) {
        if (latestById.has(teamId)) continue;
        const before = originalById.get(teamId);
        if (!before || entryChangedFields(before, after).length > 0) merged.push(after);
    }

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
                action: changedFields[0] === "create" ? "create" : changedFields[0] === "delete" ? "delete" : "update",
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
    const action = isDuplicate
        ? "delete"
        : structuralFields.some((field) => field !== "name_skipped_team_relay")
          ? "merge"
          : "update";
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
        verificationByTeam.set(teamId, Array.from(new Set(ids)).sort());
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
        result.set(teamId, Array.from(new Set(ids)).sort());
    }
    return result;
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
    for (const duplicateId of duplicateIds) {
        const existing = source.verificationByTeam.get(duplicateId) ?? [];
        const discovered = duplicateVerificationByTeam.get(duplicateId) ?? [];
        source.verificationByTeam.set(duplicateId, Array.from(new Set([...existing, ...discovered])).sort());
    }
    const nextRegistrations = new Map<string, RegistrationTeamEntry[]>();
    for (const registration of source.registrations) {
        const currentTeams = registrationTeamArray(registration.data);
        const base = dedupe.projectedRegistrationTeams.get(registration.id) ?? currentTeams;
        nextRegistrations.set(
            registration.id,
            preserveSemanticallyEqualRegistrationNames(
                currentTeams,
                base.map((entry) => ({...entry})),
            ),
        );
    }

    const teamMutations: TeamMutation[] = [];
    const teamChanges: TeamNameUpdateTeamChange[] = [];
    const teamDisplayById = new Map<string, TeamDisplayInfo>();
    const plannedTeamNameById = new Map<string, string>();
    let teamNameUpdates = 0;
    let teamAgeUpdates = 0;
    let skippedTeamRelayNames = 0;
    for (const sourceTeam of source.teams) {
        const current = sourceTeam.data;
        const projected = dedupe.projectedTeams.get(current.id) ?? current;
        const relay = isTeamRelayTeam(current, source.events);
        const canonicalProjected = dedupe.duplicateToCanonical.has(current.id)
            ? (dedupe.projectedTeams.get(dedupe.duplicateToCanonical.get(current.id) ?? "") ?? projected)
            : projected;
        const rawName = calculateTeamName(canonicalProjected, registrationMap, nameMap);
        const calculatedName = relay ? canonicalProjected.name : rawName;
        const nextName = !relay && teamNamesEqual(current.name, calculatedName) ? current.name : calculatedName;
        if (relay && !teamNamesEqual(rawName, canonicalProjected.name)) skippedTeamRelayNames += 1;
        const nextAge = calculateTeamAge(canonicalProjected, source.events, registrationMap);
        const next = {...canonicalProjected, name: nextName, team_age: nextAge};
        const isDuplicate = duplicateIds.has(current.id);
        const teamNameForDisplay = isDuplicate ? getTeamName(current) : getTeamName(next);
        teamDisplayById.set(current.id, {
            teamName: teamNameForDisplay,
            event: getTeamEventDisplayLabel(current, source.events),
        });
        plannedTeamNameById.set(current.id, teamNameForDisplay);
        const change = buildTeamChange(current, next, source.events, dedupe.duplicateToCanonical, isDuplicate, rawName);
        if (change) {
            teamChanges.push(change);
            if (!isDuplicate && !relay && !teamNamesEqual(current.name, nextName)) teamNameUpdates += 1;
            if (!isDuplicate && getTeamAge(current) !== nextAge) teamAgeUpdates += 1;
            if (!isDuplicate) teamMutations.push({current, next, change});
        }
        if (!isDuplicate && !relay) {
            for (const registration of source.registrations) {
                const entries = nextRegistrations.get(registration.id) ?? [];
                let changed = false;
                const updated = entries.map((entry) => {
                    if (entry.team_id !== current.id) return entry;
                    const nextEntry = {
                        ...entry,
                        ...(!teamNamesEqual(entry.name, nextName) ? {name: nextName} : {}),
                        ...(!teamNamesEqual(entry.label, nextName) ? {label: nextName} : {}),
                    };
                    if (stableSerialize(entry) === stableSerialize(nextEntry)) return entry;
                    changed = true;
                    return nextEntry;
                });
                if (changed) nextRegistrations.set(registration.id, updated);
            }
        }
    }

    for (const change of teamChanges) {
        if (change.keptTeamId) {
            change.keptTeamName = plannedTeamNameById.get(change.keptTeamId) ?? "Unknown team";
        }
    }

    const registrationPlan = buildRegistrationChanges(source.registrations, nextRegistrations);
    const registrationGroups = buildRegistrationGroups(registrationPlan.changes, teamDisplayById);
    const cleanupChanges: TeamNameUpdateCleanupChange[] = [];
    const teamRecruitmentIds = new Map<string, string>();
    for (const duplicateId of duplicateIds) {
        for (const requestId of source.verificationByTeam.get(duplicateId) ?? []) {
            cleanupChanges.push({
                collection: "verification_requests",
                documentId: requestId,
                teamId: duplicateId,
                teamName: teamDisplayById.get(duplicateId)?.teamName ?? "Unknown team",
                keptTeamName: getKeptTeamName(duplicateId, teamChanges),
                action: "delete",
            });
        }
        const recruitment = source.recruitments.find((item) => item.team_id === duplicateId);
        if (recruitment) {
            teamRecruitmentIds.set(duplicateId, recruitment.id);
            cleanupChanges.push({
                collection: "team_recruitment",
                documentId: recruitment.id,
                teamId: duplicateId,
                teamName: teamDisplayById.get(duplicateId)?.teamName ?? "Unknown team",
                keptTeamName: getKeptTeamName(duplicateId, teamChanges),
                action: "delete",
            });
        }
    }

    const fingerprint = createMaintenanceFingerprint({
        teams: source.teams,
        registrations: source.registrations,
        events: source.events,
        recruitments: source.recruitments,
        verificationByTeam: Array.from(source.verificationByTeam.entries()).sort(),
        participantNames: Array.from(nameMap.entries()).sort(([left], [right]) => left.localeCompare(right)),
    });
    const summary: TeamNameUpdateSummary = {
        teamNameUpdates,
        teamAgeUpdates,
        teamDocuments: teamMutations.length + duplicateIds.size,
        registrationDocuments: registrationPlan.mutations.length,
        registrationEntries: registrationPlan.changes.length,
        duplicateTeams: duplicateIds.size,
        cleanupDocuments: cleanupChanges.length,
        skippedTeamRelayNames,
    };
    return {
        preview: {
            tournamentId,
            fingerprint,
            generatedAt: Date.now(),
            summary,
            teamChanges,
            registrationChanges: registrationPlan.changes,
            registrationGroups,
            cleanupChanges,
        },
        teamMutations,
        registrationMutations: registrationPlan.mutations,
        duplicateTeamIds: Array.from(duplicateIds),
        teamRecruitmentIds,
    };
};

export async function previewTeamNameUpdatesForTournament(tournamentId: string): Promise<TeamNameUpdatePreview> {
    return (await buildPlan(tournamentId)).preview;
}

export async function applyTeamNameUpdatesForTournament(
    tournamentId: string,
    fingerprint: string,
): Promise<TeamNameUpdateResult> {
    const plan = await buildPlan(tournamentId);
    if (plan.preview.fingerprint !== fingerprint) {
        throw new Error("TEAM_NAME_PREVIEW_STALE");
    }

    for (const mutation of plan.teamMutations) {
        await upsertAdminTeam(tournamentId, mutation.next, mutation.current.id);
    }
    for (const mutation of plan.registrationMutations) {
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
    for (const teamId of plan.duplicateTeamIds) {
        try {
            await deleteTeam(tournamentId, teamId);
        } catch (error) {
            if (!(error instanceof Error && error.message.includes("Team not found"))) {
                throw error;
            }
        }
        await deleteVerificationRequestsByTeamId(teamId);
        const recruitmentId = plan.teamRecruitmentIds.get(teamId);
        if (recruitmentId) await deleteDoc(doc(db, "team_recruitment", recruitmentId));
    }

    return {...plan.preview.summary};
}
