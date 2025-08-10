import {Timestamp} from "firebase/firestore";
import {z} from "zod";

// final_criteria subcollection
export const FinalCriterionSchema = z.object({
    classification: z.enum(["advance", "intermediate", "beginner"]),
    number: z.number(),
});

export type FinalCriterion = z.infer<typeof FinalCriterionSchema>;

// age_brackets subcollection
export const AgeBracketSchema = z.object({
    name: z.string(),
    min_age: z.number(),
    max_age: z.number(),
    number_of_participants: z.number().optional().nullable().default(0),
    final_criteria: z.array(FinalCriterionSchema).optional(),
});

export const EventSchema = z.object({
    code: z.enum(["3-3-3", "3-6-3", "Cycle", "Overall"]),
    type: z.enum(["Individual", "Double", "Team Relay", "Parent & Child"]),
    teamSize: z.number().optional(),
    age_brackets: z.array(AgeBracketSchema), // 直接放进每个 event
});

export type AgeBracket = z.infer<typeof AgeBracketSchema>;
export type TournamentEvent = z.infer<typeof EventSchema>;

// main tournament schema
export const TournamentSchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    start_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    end_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    country: z.array(z.string(), z.string()).optional().nullable(),
    venue: z.string().optional().nullable(),
    address: z.string().optional().nullable(),

    events: z.array(EventSchema).optional().nullable(),
    description: z.string().optional().nullable(),
    agenda: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),

    registration_start_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    registration_end_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    status: z.enum(["Up Coming", "On Going", "Close Registration", "End"]).optional().nullable(),
    participants: z.number().optional().nullable(),
    max_participants: z.number().optional().nullable(),
    editor: z.string().optional().nullable(),
    recorder: z.string().optional().nullable(),
    registration_fee: z.number().optional().nullable(),
    member_registration_fee: z.number().optional().nullable(),

    create_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type Tournament = z.infer<typeof TournamentSchema>;
