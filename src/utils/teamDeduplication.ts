/**
 * Shared team deduplication utilities.
 *
 * Deduplicates teams that appear multiple times for the same event within a single
 * registration. Duplicates can occur when a user both opens a recruitment AND
 * forms/joins a team for the same event.
 */

import type {Team} from "@/schema/TeamSchema";
import type {TournamentEvent} from "@/schema";
import {getEventKey, getEventLabel, matchesEventKey} from "@/utils/tournament/eventUtils";

/** Extended Team type used internally for deduplication logic. */
export type LegacyTeam = Team & {
    event_ids?: string[];
    events?: string[];
    largest_age?: number;
};

/**
 * Resolves the event ID and event name for a team by matching against
 * tournament events. Checks both event_id and event_ids (legacy) fields.
 */
export function resolveTeamEvent(
    team: LegacyTeam,
    tournamentEvents: TournamentEvent[] | null | undefined,
): {eventId: string; eventName: string; eventDefinition: TournamentEvent | null} {
    const legacyIds = Array.isArray(team.event_ids) ? team.event_ids.filter(Boolean) : [];
    const legacyNames = Array.isArray(team.events) ? team.events.filter(Boolean) : [];

    let eventId = team.event_id ?? legacyIds[0] ?? "";
    let eventName = Array.isArray(team.event) && team.event[0] ? (team.event[0] ?? "") : (legacyNames[0] ?? "");
    let eventDefinition: TournamentEvent | null = null;

    const eventsList = tournamentEvents ?? [];

    if (eventsList.length > 0) {
        if (eventId) {
            eventDefinition =
                eventsList.find((evt) => getEventKey(evt) === eventId || matchesEventKey(eventId, evt)) ?? null;
        }

        if (!eventDefinition && eventName) {
            eventDefinition = eventsList.find((evt) => matchesEventKey(eventName, evt)) ?? null;
        }

        if (eventDefinition) {
            const resolvedId = getEventKey(eventDefinition);
            if (!eventId || !matchesEventKey(eventId, eventDefinition)) {
                eventId = resolvedId;
            }
            if (!eventName) {
                eventName = getEventLabel(eventDefinition);
            }
        }
    }

    return {
        eventId,
        eventName,
        eventDefinition,
    };
}

/** Scores how "complete" a team is. Higher score = more complete = better candidate to keep. */
export function getTeamCompletenessScore(team: LegacyTeam): number {
    let score = 0;
    if ((team.name ?? "").trim().length > 0) {
        score += 3;
    }
    if ((team.leader_id ?? "").trim().length > 0) {
        score += 2;
    }
    score += (team.members ?? []).length;
    if (team.looking_for_member) {
        score += 1;
    }
    return score;
}

/** Merges members from multiple teams into a single deduplicated member list. */
export function mergeTeamMembers(teamsToMerge: LegacyTeam[]): Team["members"] {
    const memberMap = new Map<string, Team["members"][number]>();

    for (const team of teamsToMerge) {
        for (const member of team.members ?? []) {
            const memberId = (member.global_id ?? "").trim();
            if (!memberId) {
                continue;
            }

            const existing = memberMap.get(memberId);
            memberMap.set(memberId, {
                global_id: memberId,
                verified: (existing?.verified ?? false) || Boolean(member.verified),
            });
        }
    }

    return Array.from(memberMap.values());
}

/**
 * Checks if a team matches a specific tournament event.
 */
export function teamMatchesEvent(
    team: LegacyTeam,
    event: TournamentEvent,
    tournamentEvents: TournamentEvent[] | null | undefined,
): boolean {
    const {eventId, eventName} = resolveTeamEvent(team, tournamentEvents);
    const hasEventIdMatch = Boolean(eventId) && matchesEventKey(eventId, event);
    const hasEventNameMatch = Boolean(eventName) && matchesEventKey(eventName, event);
    return hasEventIdMatch || hasEventNameMatch;
}

/**
 * Deduplicates teams by event.
 *
 * Groups teams that share the same event, then picks a "canonical" team to keep
 * based on: (1) registration ownership, (2) completeness score, (3) ID.
 *
 * Members from all duplicate teams are merged into the canonical team.
 *
 * @param sourceTeams - All teams to deduplicate
 * @param tournamentEvents - Tournament event definitions for resolving event identity
 * @param registrationId - If provided, teams belonging to this registration score higher
 * @returns Deduplicated teams and the IDs of teams to delete
 */
export function dedupeTeamsByEvent(
    sourceTeams: LegacyTeam[],
    tournamentEvents: TournamentEvent[],
    registrationId?: string,
): {teams: LegacyTeam[]; duplicateTeamIds: string[]} {
    const groupedByEvent = new Map<string, LegacyTeam[]>();

    for (const team of sourceTeams) {
        const {eventId, eventName} = resolveTeamEvent(team, tournamentEvents);
        const normalizedEventId = (eventId ?? "").trim().toLowerCase();
        const normalizedEventName = (eventName ?? "").trim().toLowerCase();
        const groupKey = normalizedEventId
            ? `event:${normalizedEventId}`
            : normalizedEventName
              ? `name:${normalizedEventName}`
              : `team:${team.id}`;
        const bucket = groupedByEvent.get(groupKey) ?? [];
        bucket.push(team);
        groupedByEvent.set(groupKey, bucket);
    }

    const dedupedTeams: LegacyTeam[] = [];
    const duplicateTeamIds: string[] = [];

    for (const teamsInGroup of groupedByEvent.values()) {
        if (teamsInGroup.length === 1) {
            dedupedTeams.push(teamsInGroup[0]);
            continue;
        }

        const rankedTeams = [...teamsInGroup].sort((a, b) => {
            const registrationScoreA = a.registration_id === registrationId ? 1 : 0;
            const registrationScoreB = b.registration_id === registrationId ? 1 : 0;
            if (registrationScoreA !== registrationScoreB) {
                return registrationScoreB - registrationScoreA;
            }
            const completenessDelta = getTeamCompletenessScore(b) - getTeamCompletenessScore(a);
            if (completenessDelta !== 0) {
                return completenessDelta;
            }
            return (a.id ?? "").localeCompare(b.id ?? "");
        });

        const canonicalTeam = rankedTeams[0];
        const canonicalEvent = resolveTeamEvent(canonicalTeam, tournamentEvents);
        const mergedMembers = mergeTeamMembers(rankedTeams);
        const mergedTeam: LegacyTeam = {
            ...canonicalTeam,
            members: mergedMembers,
            event_id: canonicalEvent.eventId || canonicalTeam.event_id,
            event: canonicalEvent.eventName
                ? [canonicalEvent.eventName]
                : Array.isArray(canonicalTeam.event)
                  ? canonicalTeam.event
                  : [],
        };

        dedupedTeams.push(mergedTeam);
        duplicateTeamIds.push(...rankedTeams.slice(1).map((team) => team.id));
    }

    return {teams: dedupedTeams, duplicateTeamIds: Array.from(new Set(duplicateTeamIds))};
}
