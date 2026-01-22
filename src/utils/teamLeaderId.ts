const TEAM_PREFIX_MAP: Array<{match: (value: string) => boolean; prefix: string}> = [
    {match: (value) => value.includes("double"), prefix: "D"},
    {match: (value) => value.includes("parent") && value.includes("child"), prefix: "P"},
    {match: (value) => value.includes("team relay"), prefix: "T"},
];

export const getTeamLeaderPrefix = (eventType?: string | null): string => {
    if (!eventType) return "";
    const normalized = eventType.toLowerCase();
    for (const entry of TEAM_PREFIX_MAP) {
        if (entry.match(normalized)) {
            return entry.prefix;
        }
    }
    return "";
};

export const stripTeamLeaderPrefix = (leaderId?: string | null): string => {
    if (!leaderId) return "";
    const match = /^([DPT])(\d+)$/.exec(leaderId);
    return match ? match[2] : leaderId;
};

export const formatTeamLeaderId = (leaderId?: string | null, eventType?: string | null): string => {
    if (!leaderId) return "N/A";
    const prefix = getTeamLeaderPrefix(eventType);
    if (!prefix) return leaderId;
    if (leaderId.startsWith(prefix)) return leaderId;
    const baseId = stripTeamLeaderPrefix(leaderId);
    return `${prefix}${baseId}`;
};
