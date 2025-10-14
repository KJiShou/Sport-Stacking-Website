import {z} from "zod";

export const EventCategorySchema = z.enum(["individual", "double", "team_relay", "parent_&_child", "special_need"]);
export type EventCategory = z.infer<typeof EventCategorySchema>;

export const FinalistGroupPayloadSchema = z.object({
    eventCategory: EventCategorySchema,
    eventName: z.string(),
    bracketName: z.string(),
    classification: z.enum(["beginner", "intermediate", "advance"]),
    participantIds: z.array(z.string()),
    participantType: z.enum(["individual", "team"]),
});

export type FinalistGroupPayload = z.infer<typeof FinalistGroupPayloadSchema>;
