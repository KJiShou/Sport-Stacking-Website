import type {Team} from "@/schema";

export const isTeamFullyVerified = (team: Team): boolean => {
    const members = team.members ?? [];
    if (members.length === 0) {
        return false;
    }
    return members.every((member) => member.verified);
};
