import {z} from "zod";

export const IndividualRecruitmentSchema = z.object({
    id: z.string(),
    participant_id: z.string(), // global_id of the participant
    tournament_id: z.string(),
    participant_name: z.string(),
    age: z.number(),
    gender: z.enum(["Male", "Female"]),
    country: z.string(),
    events_interested: z.array(z.string()), // e.g., ["3-6-3-Double", "Cycle-Team Relay"]
    phone_number: z.string().optional(),
    additional_info: z.string().optional(), // Any additional requirements or info
    status: z.enum(["active", "matched", "closed"]).default("active"),
    matched_team_id: z.string().optional().nullable(), // ID of team they were assigned to
    created_at: z.date(),
    updated_at: z.date().optional(),
});

export type IndividualRecruitment = z.infer<typeof IndividualRecruitmentSchema>;