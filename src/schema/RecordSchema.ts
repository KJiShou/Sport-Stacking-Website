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
    status: z.enum(["submitted", "verified"]),
    videoUrl: z.string().url().optional().nullable(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    age: z.number(),
    id: z.string().optional(),
    round: z.enum(["prelim", "final"]).optional(),
    classification: z.enum(["advance", "intermediate", "beginner"]).optional(),
    bestTime: z.number().optional(),
    try1: z.number().optional(),
    try2: z.number().optional(),
    try3: z.number().optional(),
    tournamentId: z.string().optional(),
    teamId: z.string().optional(),
    ageGroup: z.string().optional(),
});

export const GlobalTeamResultSchema = z.object({
    event: z.string(),
    country: z.string().optional(),
    time: z.number(),
    teamName: z.string().optional(),
    leaderId: z.string().optional(),
    members: z.array(z.string()).optional(),
    status: z.enum(["submitted", "verified"]),
    videoUrl: z.string().url().optional().nullable(),
    verified_by: z.string().nullable(),
    verified_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    age: z.number(),
    id: z.string().optional(),
    round: z.enum(["prelim", "final"]).optional(),
    classification: z.enum(["advance", "intermediate", "beginner"]).optional(),
    bestTime: z.number().optional(),
    try1: z.number().optional(),
    try2: z.number().optional(),
    try3: z.number().optional(),
    tournamentId: z.string().optional(),
    teamId: z.string().optional(),
    ageGroup: z.string().optional(),
});

export const RecordDisplaySchema = z.object({
    key: z.string(),
    rank: z.number(),
    event: z.string(),
    gender: z.string(),
    time: z.string(),
    athlete: z.string(),
    country: z.string(),
    flag: z.string(),
    date: z.string(),
    ageGroup: z.string(),
    status: z.enum(["submitted", "verified"]),
    videoUrl: z.string().optional(),
    rawTime: z.number(),
    recordId: z.string().optional(),
    participantId: z.string().optional(),
    teamName: z.string().optional(),
});

export type TournamentRecord = z.infer<typeof TournamentRecordSchema>;
export type TournamentTeamRecord = z.infer<typeof TournamentTeamRecordSchema>;
export type GlobalResult = z.infer<typeof GlobalResultSchema>;
export type GlobalTeamResult = z.infer<typeof GlobalTeamResultSchema>;
export type RecordDisplay = z.infer<typeof RecordDisplaySchema>;

export type GlobalRecord = (GlobalResult | GlobalTeamResult) & {
    bestTime?: number;
    try1?: number;
    try2?: number;
    try3?: number;
    tournamentId?: string;
    teamId?: string;
    round?: "prelim" | "final";
    participantName?: string;
    teamName?: string;
    memberIds?: string[];
    memberNames?: string[];
};

export interface RecordRow {
    key: string;
    event: string;
    ageGroup: string;
    time: string;
    athlete: string;
    country: string;
    year: string;
    isHeader: boolean;
}

export interface WorldRecordsOverviewProps {
    event?: string;
}

export interface RecordRankingTableProps {
    event: string;
    title: string;
}

export interface GetFastestRecordData {
    event: string;
    round: "prelim" | "final";
    type: "Individual" | "Team Relay";
}
