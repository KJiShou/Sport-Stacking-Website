import {Timestamp} from "firebase/firestore";
import {z} from "zod";

// age_brackets subcollection
export const AgeBracketSchema = z.object({
    name: z.string(),
    min_age: z.number(),
    max_age: z.number(),
    number_of_participants: z.number().optional().nullable().default(0),
});

export type AgeBracket = z.infer<typeof AgeBracketSchema>;

export const EventSchema = z.object({
    code: z.enum(["3-3-3", "3-6-3", "cycle"]),
    type: z.enum(["individual", "double", "team relay", "parent & child"]),
    teamSize: z.number().optional(),
    age_brackets: z.array(AgeBracketSchema), // 直接放进每个 event
});

// final_criteria subcollection
export const FinalCriteriaSchema = z.object({
    type: z.enum(["individual", "team"]),
    number: z.number(),
});

// final_categories subcollection
export const FinalCategorySchema = z.object({
    name: z.string(),
    start: z.number(),
    end: z.number(),
});

// main tournament schema
export const TournamentSchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string(),
    start_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    end_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    country: z.array(z.string(), z.string()),
    venue: z.string().optional().nullable(),
    address: z.string(),

    events: z.array(EventSchema),
    final_criteria: z.array(FinalCriteriaSchema),
    final_categories: z.array(FinalCategorySchema),
    description: z.string().optional().nullable(),
    agenda: z.string().optional().nullable(),

    registration_start_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    registration_end_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    status: z.enum(["Up Coming", "On Going", "Close Registration", "End"]).optional().nullable(),
    participants: z.number().optional().nullable(),
    max_participants: z.number().optional().nullable(),

    create_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type Tournament = z.infer<typeof TournamentSchema>;
