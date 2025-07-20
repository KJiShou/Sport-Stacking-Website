import {z} from "zod";

export const RecordSchema = z.object({
    tournament_id: z.string(),
    event_code: z.string(),
    type: z.enum(["Individual", "Double", "Team Relay", "Parent & Child"]),
    user_id: z.string().nullable(),
    team_id: z.string().nullable(),
    time: z.number(),
    status: z.enum(["submitted", "verified"]),
    submitted_at: z.string(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    stage: z.string(),
});

export type Record = z.infer<typeof RecordSchema>;
