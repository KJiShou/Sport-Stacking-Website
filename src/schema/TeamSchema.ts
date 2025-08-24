import {z} from "zod";

export const TeamMemberSchema = z.object({
    global_id: z.string(),
    verified: z.boolean().default(false),
});

export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const TeamSchema = z.object({
    id: z.string(), // teamId
    name: z.string(),
    tournament_id: z.string(),
    registration_id: z.string(),
    leader_id: z.string(), // global_id of the leader
    members: z.array(TeamMemberSchema),
    events: z.array(z.string()), // e.g., ["3-6-3", "Cycle"]
    largest_age: z.number().default(0),
    looking_for_member: z.boolean().default(false), // Indicates if the team is looking for members
});

export type Team = z.infer<typeof TeamSchema>;
