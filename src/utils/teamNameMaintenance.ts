import type {Team, TournamentEvent} from "@/schema";
import {stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {getEventLabel, getTeamEvents, matchesEventKey} from "@/utils/tournament/eventUtils";

type TeamEventData = Pick<Team, "event_id" | "event">;

const normalizeReference = (value: string | null | undefined): string => value?.trim().toLowerCase() ?? "";

const isRelayEventType = (value: string | null | undefined): boolean => {
    const normalized = normalizeReference(value);
    return normalized === "team relay" || normalized === "time relay";
};

export const getResolvedTeamEvent = (team: TeamEventData, events: TournamentEvent[]): TournamentEvent | null => {
    const matched = getTeamEvents(team, events);
    return matched[0] ?? null;
};

export const isTeamRelayTeam = (team: TeamEventData, events: TournamentEvent[]): boolean => {
    if (getTeamEvents(team, events).some((event) => isRelayEventType(event.type))) {
        return true;
    }

    const references = [
        ...(Array.isArray(team.event) ? team.event : [team.event]).filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
        ),
        ...(typeof team.event_id === "string" && team.event_id.trim().length > 0 ? [team.event_id] : []),
    ];

    return references.some((reference) =>
        events.some(
            (event) => isRelayEventType(reference) || (matchesEventKey(reference, event) && isRelayEventType(event.type)),
        ),
    );
};

export const getTeamEventType = (team: TeamEventData, events: TournamentEvent[]): string => {
    const resolvedEvent = getResolvedTeamEvent(team, events);
    if (resolvedEvent?.type?.trim()) {
        return resolvedEvent.type.trim().toLowerCase();
    }

    return [
        ...(Array.isArray(team.event) ? team.event : [team.event]).filter(
            (value): value is string => typeof value === "string" && value.trim().length > 0,
        ),
        ...(typeof team.event_id === "string" && team.event_id.trim().length > 0 ? [team.event_id] : []),
    ]
        .join(" ")
        .trim()
        .toLowerCase();
};

export const calculateTeamAgeForEvent = (ages: number[], eventType: string): number => {
    const validAges = ages.filter((age) => Number.isFinite(age) && age > 0);
    if (validAges.length === 0) return 0;

    if (eventType.includes("team relay") || eventType.includes("time relay") || eventType.includes("double")) {
        return Math.round(validAges.reduce((sum, age) => sum + age, 0) / validAges.length);
    }

    if (eventType.includes("parent") && eventType.includes("child")) {
        return Math.min(...validAges);
    }

    return Math.max(...validAges);
};

/**
 * Normalizes only invisible/formatting differences for maintenance comparisons.
 * Letter casing remains significant so a capitalization correction is still an update.
 */
export const normalizeTeamNameForComparison = (value: string | null | undefined): string =>
    (value ?? "")
        .normalize("NFC")
        .replace(/(?:\u200B|\u200C|\u200D|\uFEFF)/gu, "")
        .replace(/\s+/gu, " ")
        .trim();

export const teamNamesEqual = (left: string | null | undefined, right: string | null | undefined): boolean =>
    normalizeTeamNameForComparison(left) === normalizeTeamNameForComparison(right);

export const getTeamEventDisplayLabel = (team: TeamEventData, events: TournamentEvent[]): string => {
    const resolvedEvent = getResolvedTeamEvent(team, events);
    return resolvedEvent ? getEventLabel(resolvedEvent) || resolvedEvent.type : getTeamEventType(team, events) || "Unknown event";
};

export const getTeamMemberIds = (team: Pick<Team, "leader_id" | "members">): string[] =>
    [
        stripTeamLeaderPrefix(team.leader_id ?? "").trim(),
        ...(team.members ?? []).map((member) => member.global_id?.trim() ?? ""),
    ].filter(Boolean);

const stableValue = (value: unknown): unknown => {
    if (value && typeof value === "object" && typeof (value as {toDate?: unknown}).toDate === "function") {
        return (value as {toDate: () => Date}).toDate().toISOString();
    }
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, stableValue(entry)]),
        );
    }
    return value;
};

export const stableSerialize = (value: unknown): string => JSON.stringify(stableValue(value));

export const createMaintenanceFingerprint = (value: unknown): string => {
    const serialized = stableSerialize(value);
    let hash = 2_166_136_261;
    for (let index = 0; index < serialized.length; index += 1) {
        hash ^= serialized.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return `fnv1a-${(hash >>> 0).toString(16)}`;
};
