import {z} from "zod";

export const TeamSchema = z.object({
    name: z.string(),
    members: z.array(z.string()), // user IDs
    tournament_id: z.string(),
});

export type Team = z.infer<typeof TeamSchema>;
