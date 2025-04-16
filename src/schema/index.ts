import * as z from "zod";

// competitions
export const CompetitionSchema = z.object({
  id: z.string().optional(), // <-- make optional
  name: z.string(),
  startDate: z.union([z.string(), z.date()]).optional().nullable(),
  endDate: z.union([z.string(), z.date()]).optional().nullable(),
  location: z.string().optional().nullable(),
  status: z.enum(["upcoming", "ongoing", "completed"]).optional().nullable(),
  maxNumber: z.preprocess((val) => Number(val), z.number()).optional().nullable(),

  age_brackets: z
    .array(
      z.object({
        name: z.string(),
        minAge: z.number(),
        maxAge: z.number(),
        code: z.enum(["individual", "relay"]),
        type: z.enum(["individual", "team"]),
        maxNumber: z.preprocess((val) => Number(val), z.number())
          .optional()
          .nullable(),
      })
    )
    .optional()
    .nullable(),

  events: z
    .array(
      z.object({
        code: z.enum(["individual", "relay"]),
        type: z.enum(["individual", "team"]),
        teamSize: z.preprocess((val) => Number(val), z.number()).optional().nullable(),
      })
    )
    .optional()
    .nullable(),

  final_criteria: z
    .array(
      z.object({
        type: z.enum(["individual", "relay"]),
      })
    )
    .optional()
    .nullable(),

  finalCategory: z
    .array(
      z.object({
        name: z.string(),
        start: z.preprocess((val) => Number(val), z.number()),
        end: z.preprocess((val) => Number(val), z.number()),
      })
    )
    .optional()
    .nullable(),
});


export type Competition = z.infer<typeof CompetitionSchema>;
