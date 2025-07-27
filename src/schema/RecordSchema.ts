import {z} from "zod";

export const RecordSchema = z.object({
    tournament_id: z.string(),
    event_code: z.string(),
    type: z.enum(["Individual", "Double", "Team Relay", "Parent & Child"]),
    user_id: z.string().nullable(),
    team_id: z.string().nullable(),
    time: z.number(),
    status: z.enum(["submitted", "verified"]),
    submitted_at: z.string(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    stage: z.string(),
});

export type Record = z.infer<typeof RecordSchema>;

export const TournamentRecordSchema = z.object({
    participantId: z.string(),
    participantAge: z.number(),
    round: z.enum(["prelim", "final"]),
    event: z.string(),
    try1: z.number(),
    try2: z.number(),
    try3: z.number(),
    bestTime: z.number(),
    status: z.enum(["submitted", "verified"]),
    videoUrl: z.string().url().optional().nullable(),
    submitted_at: z.string(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
});

export type TournamentRecord = z.infer<typeof TournamentRecordSchema>;

export const GlobalResultSchema = z.object({
    tournamentId: z.string(),
    event: z.string(),
    participantId: z.string(),
    participantName: z.string(),
    round: z.enum(["prelim", "final"]),
    bestTime: z.number(),
});

export type GlobalResult = z.infer<typeof GlobalResultSchema>;
