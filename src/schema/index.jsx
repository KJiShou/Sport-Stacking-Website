import * as z from "zod";

// competitions
export const CompetitionSchema = z.object({
    id: z.string(),
    name: z.string().optional().nullable(),
    startDate: z.date().optional().nullable(),
    endDate: z.date().optional().nullable(),
    location: z.string().optional().nullable(),
    status: z.enum(["upcoming", "ongoing", "completed"]).optional().nullable(),
    age_brackets: z
        .array(
            z.object({
                name: z.string(),
                minAge: z.number(),
                maxAge: z.number(),
                code: z.enum(["individual", "relay"]),
                type: z.enum(["individual", "team"]),
                maxNumber: z.number().optional().nullable(),
            }),
        )
        .optional()
        .nullable(),
    maxNumber: z.number().optional().nullable(),
    events: z
        .array(
            z.object({
                code: z.enum(["individual", "relay"]),
                type: z.enum(["individual", "team"]),
                teamSize: z.number().optional().nullable(),
            }),
        )
        .optional()
        .nullable(),
    final_criteria: z
        .array(
            z.object({
                type: z.enum(["individual", "relay"]),
            }),
        )
        .optional()
        .nullable(),
    finalCategory: z
        .array(
            z.object({
                name: z.string(),
                start: z.number(),
                end: z.number(),
            }),
        )
        .optional()
        .nullable(),
});
