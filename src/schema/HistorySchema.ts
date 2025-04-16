import {z} from "zod";

export const HistorySchema = z.object({
    id: z.string().optional().nullable(),
    competition_id: z.string(),
    event: z.string(),
    time: z.number(),
    placement: z.string(),
});

export type History = z.infer<typeof HistorySchema>;
