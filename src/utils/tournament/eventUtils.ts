import type {Team, TournamentEvent} from "@/schema";

type TeamEventRefs = Partial<Pick<Team, "event_ids" | "events">>;

const TEAM_EVENT_TYPES = new Set(["Double", "Team Relay", "Parent & Child"]);

export const sanitizeEventCodes = (codes?: string[]): string[] => (codes ?? []).filter((code) => code !== "Overall");

export const getEventKey = (event: TournamentEvent | null | undefined): string => {
    if (!event) return "";
    if (event.id && event.id.length > 0) {
        return event.id;
    }
    return event.type;
};

export const getEventLabel = (event: TournamentEvent | null | undefined): string => {
    if (!event) return "";
    const codes = sanitizeEventCodes(event.codes);
    const codesLabel = codes.length > 0 ? ` (${codes.join(", ")})` : "";
    return `${event.type}${codesLabel}`;
};

export const isTeamEvent = (event: TournamentEvent | null | undefined): boolean => {
    if (!event) return false;
    return TEAM_EVENT_TYPES.has(event.type);
};

export const matchesEventKey = (value: string, event: TournamentEvent | null | undefined): boolean => {
    if (!event || !value) return false;
    const trimmed = value.trim();
    if (trimmed.length === 0) return false;

    if (trimmed === event.id) {
        return true;
    }

    const normalizedValue = trimmed.toLowerCase();
    const normalizedType = event.type.toLowerCase();
    if (normalizedValue === normalizedType) {
        return true;
    }

    const codes = sanitizeEventCodes(event.codes);
    for (const code of codes) {
        const normalizedCode = code.toLowerCase();
        if (normalizedValue === normalizedCode) {
            return true;
        }

        const combined = `${code}-${event.type}`.toLowerCase();
        if (normalizedValue === combined) {
            return true;
        }
    }

    return false;
};

export const matchesAnyEventKey = (values: string[] | null | undefined, event: TournamentEvent | null | undefined): boolean => {
    if (!values || values.length === 0) return false;
    return values.some((value) => matchesEventKey(value, event));
};

export const getTeamEventIds = (team: Pick<Team, "event_ids" | "events"> | null | undefined): string[] => {
    if (!team) {
        return [];
    }
    if (team.event_ids && team.event_ids.length > 0) {
        return team.event_ids;
    }
    return team.events ?? [];
};

export const getTeamEvents = (
    team: TeamEventRefs | null | undefined,
    tournamentEvents: TournamentEvent[] | null | undefined,
): TournamentEvent[] => {
    if (!team || !tournamentEvents || tournamentEvents.length === 0) {
        return [];
    }

    const byId = new Map<string, TournamentEvent>();

    for (const eventId of team.event_ids ?? []) {
        const match = tournamentEvents.find((event) => event.id === eventId);
        if (match) {
            byId.set(match.id ?? getEventKey(match), match);
        }
    }

    if (byId.size === 0) {
        for (const legacy of team.events ?? []) {
            const match = tournamentEvents.find((event) => matchesEventKey(legacy, event));
            if (match) {
                byId.set(match.id ?? getEventKey(match), match);
            }
        }
    }

    return Array.from(byId.values());
};

export const teamMatchesEventKey = (
    team: TeamEventRefs | null | undefined,
    eventKey: string,
    tournamentEvents: TournamentEvent[] | null | undefined,
): boolean => {
    if (!team || !eventKey) {
        return false;
    }

    const trimmedKey = eventKey.trim();
    if (trimmedKey.length === 0) {
        return false;
    }

    if (team.event_ids?.includes(trimmedKey)) {
        return true;
    }

    if (tournamentEvents && tournamentEvents.length > 0) {
        const teamEvents = getTeamEvents(team, tournamentEvents);
        if (teamEvents.some((event) => matchesEventKey(trimmedKey, event))) {
            return true;
        }
    }

    if (team.events?.includes(trimmedKey)) {
        return true;
    }

    if (tournamentEvents && tournamentEvents.length > 0) {
        return (team.events ?? []).some((value) => {
            const event = tournamentEvents.find((evt) => matchesEventKey(value, evt));
            return event ? matchesEventKey(trimmedKey, event) : false;
        });
    }

    return false;
};

export const getTeamEventLabels = (
    team: TeamEventRefs | null | undefined,
    tournamentEvents: TournamentEvent[] | null | undefined,
): string[] => {
    if (!team) {
        return [];
    }

    const resolvedEvents = getTeamEvents(team, tournamentEvents);
    if (resolvedEvents.length > 0) {
        return resolvedEvents.map(getEventLabel);
    }

    if (team.event_ids && team.event_ids.length > 0) {
        return team.event_ids;
    }

    return team.events ?? [];
};
