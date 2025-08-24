import {z} from "zod";

export const TournamentRecordSchema = z.object({
    participantId: z.string().optional(),
    participantAge: z.number().optional(),
    country: z.string().optional(),
    classification: z.enum(["advance", "intermediate", "beginner"]).optional(),
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
    created_at: z.string(),
    updated_at: z.string(),
});

export const TournamentTeamRecordSchema = z.object({
    participantId: z.string().optional(),
    participantAge: z.number().optional(),
    country: z.string().optional(),
    memberIds: z.array(z.string()).optional(),
    memberNames: z.array(z.string()).optional(),
    leaderId: z.string().optional(),
    leaderName: z.string().optional(),
    classification: z.enum(["advance", "intermediate", "beginner"]).optional(),
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
    created_at: z.string(),
    updated_at: z.string(),
});

export const GlobalResultSchema = z.object({
    event: z.string(),
    gender: z.string(),
    participantId: z.string().optional(),
    participantName: z.string().optional(),
    country: z.string().optional(),
    time: z.number(),
    created_at: z.string(),
    updated_at: z.string(),
    age: z.number(),
});

export const GlobalTeamResultSchema = z.object({
    event: z.string(),
    country: z.string().optional(),
    time: z.number(),
    teamName: z.string().optional(),
    leaderId: z.string().optional(),
    members: z.array(z.string()).optional(),
    created_at: z.string(),
    updated_at: z.string(),
    age: z.number(),
});

export type TournamentRecord = z.infer<typeof TournamentRecordSchema>;
export type TournamentTeamRecord = z.infer<typeof TournamentTeamRecordSchema>;
export type GlobalResult = z.infer<typeof GlobalResultSchema>;
export type GlobalTeamResult = z.infer<typeof GlobalTeamResultSchema>;
