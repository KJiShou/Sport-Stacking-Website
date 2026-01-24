import {z} from "zod";

export const DoubleRecruitmentSchema = z.object({
    id: z.string(),
    participant_id: z.string(),
    tournament_id: z.string(),
    participant_name: z.string(),
    age: z.number(),
    gender: z.enum(["Male", "Female"]),
    country: z.string(),
    event_id: z.string(),
    event_name: z.string(),
    phone_number: z.string().optional(),
    additional_info: z.string().optional(),
    registration_id: z.string().optional(),
    status: z.enum(["active", "matched", "closed"]).default("active"),
    matched_partner_id: z.string().optional().nullable(),
    matched_team_id: z.string().optional().nullable(),
    created_at: z.date(),
    updated_at: z.date().optional(),
});

export type DoubleRecruitment = z.infer<typeof DoubleRecruitmentSchema>;
