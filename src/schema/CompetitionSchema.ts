import {z} from "zod";

// age_brackets subcollection
export const AgeBracketSchema = z.object({
    name: z.string(),
    min_age: z.number(),
    max_age: z.number(),
    code: z.enum(["3-3-3", "3-6-3", "cycle", "all-around"]),
    type: z.enum(["individual", "team"]),
});

// events subcollection
export const EventSchema = z.object({
    code: z.enum(["3-3-3", "3-6-3", "cycle"]),
    type: z.enum(["individual", "team"]),
    teamSize: z.number().optional(),
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
    start_date: z.union([z.date(), z.string()]),
    end_date: z.union([z.date(), z.string()]),
    location: z.string(),
    status: z.enum(["upcoming", "ongoing", "completed"]),

    age_brackets: z.array(AgeBracketSchema),
    events: z.array(EventSchema),
    final_criteria: z.array(FinalCriteriaSchema),
    final_categories: z.array(FinalCategorySchema),

    max_groups: z.number().optional(),
});

export type Competition = z.infer<typeof CompetitionSchema>;
