import type {Team, TournamentEvent} from "@/schema";

type LegacyTeamFields = {
    event_ids?: string[];
    events?: string[];
    largest_age?: number;
};

type TeamEventRefs = Partial<Pick<Team, "event_id" | "event">> & LegacyTeamFields;

const addStringToSet = (set: Set<string>, value: unknown): void => {
    if (typeof value !== "string") {
        return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return;
    }

    set.add(trimmed);
};

const addArrayToSet = (set: Set<string>, values: unknown): void => {
    if (!Array.isArray(values)) {
        return;
    }

    for (const value of values) {
        addStringToSet(set, value);
    }
};

const getTeamEventIdReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const ids = new Set<string>();
    addStringToSet(ids, team.event_id);
    addArrayToSet(ids, team.event_ids);

    return Array.from(ids);
};

const getTeamEventNameReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const names = new Set<string>();
    if (Array.isArray(team.event)) {
        addArrayToSet(names, team.event);
    } else {
        addStringToSet(names, team.event);
    }
    addArrayToSet(names, team.events);

    return Array.from(names);
};

const getAllTeamEventReferences = (team: TeamEventRefs | null | undefined): string[] => {
    const references = new Set<string>();
    for (const reference of getTeamEventIdReferences(team)) {
        references.add(reference);
    }
    for (const reference of getTeamEventNameReferences(team)) {
        references.add(reference);
    }

    return Array.from(references);
};

const TEAM_EVENT_TYPES = new Set(["Double", "Team Relay", "Parent & Child"]);
export const EVENT_TYPE_ORDER = [
    "Individual",
    "StackOut Champion",
    "Blindfolded Cycle",
    "Double",
    "Parent & Child",
    "Team Relay",
    "Special Need",
    "Stack Up Champion",
] as const;

export const getEventTypeOrderIndex = (eventType?: string): number => {
    if (!eventType) return EVENT_TYPE_ORDER.length;
    const index = EVENT_TYPE_ORDER.indexOf(eventType as (typeof EVENT_TYPE_ORDER)[number]);
    return index === -1 ? EVENT_TYPE_ORDER.length : index;
};

export const sanitizeEventCodes = (codes?: string[]): string[] =>
    (codes ?? []).filter((code) => code != null && code !== "" && code !== "Overall");

export const getEventKey = (event: TournamentEvent | null | undefined): string => {
    if (!event) return "";
    if (event.id && event.id.length > 0) {
        return event.id;
    }
    return event.type;
};

export const getEventLabel = (event: TournamentEvent | null | undefined): string => {
    if (!event) return "";
    const typeLabel = event.type === "Stack Up Champion" ? "StackOut Champion" : event.type;
    const codes = sanitizeEventCodes(event.codes);
    const codesLabel = codes.length > 0 ? ` (${codes.join(", ")})` : "";
    const gender = event.gender === "Male" || event.gender === "Female" ? event.gender : "Mixed";
    const genderLabel = gender === "Mixed" ? "Mixed Gender" : gender;
    return `${typeLabel} - ${genderLabel}${codesLabel}`;
};

export const isTeamEvent = (event: TournamentEvent | null | undefined): boolean => {
    if (!event) return false;
    return TEAM_EVENT_TYPES.has(event.type);
};

export const isScoreTrackedEvent = (event: TournamentEvent | null | undefined): boolean => {
    if (!event) return false;
    return event.type !== "StackOut Champion" && event.type !== "Blindfolded Cycle" && event.type !== "Stack Up Champion";
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

export const getTeamEventIds = (team: TeamEventRefs | null | undefined): string[] => {
    const ids = getTeamEventIdReferences(team);
    if (ids.length > 0) {
        return ids;
    }

    return getTeamEventNameReferences(team);
};

export const getTeamEvents = (
    team: TeamEventRefs | null | undefined,
    tournamentEvents: TournamentEvent[] | null | undefined,
): TournamentEvent[] => {
    if (!team || !tournamentEvents || tournamentEvents.length === 0) {
        return [];
    }

    const matchedEvents = new Map<string, TournamentEvent>();
    const references = getAllTeamEventReferences(team);

    for (const reference of references) {
        const matchById = tournamentEvents.find((event) => event.id === reference);
        if (matchById) {
            matchedEvents.set(getEventKey(matchById), matchById);
            continue;
        }

        const matchByKey = tournamentEvents.find((event) => matchesEventKey(reference, event));
        if (matchByKey) {
            matchedEvents.set(getEventKey(matchByKey), matchByKey);
        }
    }

    return Array.from(matchedEvents.values());
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

    const normalizedKey = trimmedKey.toLowerCase();

    const eventId = typeof team.event_id === "string" ? team.event_id.trim().toLowerCase() : "";
    if (eventId && eventId === normalizedKey) {
        return true;
    }

    const eventNameReferences = getTeamEventNameReferences(team);
    if (eventNameReferences.includes(trimmedKey)) {
        return true;
    }

    if (eventNameReferences.some((value) => value.toLowerCase() === normalizedKey)) {
        return true;
    }

    if (tournamentEvents && tournamentEvents.length > 0) {
        const teamEvents = getTeamEvents(team, tournamentEvents);
        if (teamEvents.some((event) => matchesEventKey(trimmedKey, event))) {
            return true;
        }
    }

    if (tournamentEvents && tournamentEvents.length > 0) {
        return eventNameReferences.some((value) => {
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

    const ids = getTeamEventIdReferences(team);
    if (ids.length > 0) {
        return ids;
    }

    return getTeamEventNameReferences(team);
};

export const getTeamMaxAge = (
    team: (Partial<Pick<Team, "team_age">> & LegacyTeamFields) | null | undefined,
): number | undefined => {
    if (!team) {
        return undefined;
    }

    if (typeof team.largest_age === "number") {
        return team.largest_age;
    }

    if (typeof team.team_age === "number") {
        return team.team_age;
    }

    return undefined;
};
