import { Timestamp } from "firebase/firestore";
import { z } from "zod";

// age_brackets subcollection
export const AgeBracketSchema = z.object({
    name: z.string(),
    min_age: z.number(),
    max_age: z.number(),
});

export type AgeBracket = z.infer<typeof AgeBracketSchema>;

export const EventSchema = z.object({
    code: z.enum(["3-3-3", "3-6-3", "cycle"]),
    type: z.enum(["individual", "team"]),
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

// main competition schema
export const CompetitionSchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string(),
    start_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    end_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    country: z.array(z.string(), z.string()),
    address: z.string(),

    events: z.array(EventSchema),
    final_criteria: z.array(FinalCriteriaSchema),
    final_categories: z.array(FinalCategorySchema),

    registration_start_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    registration_end_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    status: z.enum(["Up Coming", "On Going", "Close Registration", "End"]).optional().nullable(),
    participants: z.number().optional().nullable(),
    max_participants: z.number().optional().nullable(),

    create_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type Competition = z.infer<typeof CompetitionSchema>;
