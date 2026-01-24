import {z} from "zod";

export const EventCategorySchema = z.enum([
    "Individual",
    "Double",
    "Team Relay",
    "Parent & Child",
    "Special Need",
    "Stack Up Champion",
]);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const FinalistGroupPayloadSchema = z.object({
    id: z.string().optional().nullable(),
    tournament_id: z.string(),
    event_id: z.string().optional().nullable(),
    event_type: EventCategorySchema,
    event_code: z.array(z.string()),
    bracket_name: z.string(),
    classification: z.enum(["beginner", "intermediate", "advance", "prelim"]),
    participant_ids: z.array(z.string()),
    participant_type: z.enum(["Individual", "Team"]),
});

export type FinalistGroupPayload = z.infer<typeof FinalistGroupPayloadSchema>;
