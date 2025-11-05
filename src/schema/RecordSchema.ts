import {z} from "zod";

const classificationEnum = z.enum(["advance", "intermediate", "beginner", "prelim"]);
const recordStatusEnum = z.enum(["submitted", "verified"]);

const TournamentRecordBaseSchema = z.object({
    id: z.string(),
    tournament_id: z.string(),
    tournament_name: z.string().optional().nullable(),
    event_id: z.string(),
    event: z.string(),
    code: z.string(),
    age: z.number().optional().nullable(),
    country: z.string().optional().nullable(),
    best_time: z.number(),
    status: recordStatusEnum,
    try1: z.number(),
    try2: z.number(),
    try3: z.number(),
    video_url: z.string().url().optional().nullable(),
    classification: classificationEnum.optional().nullable(),
    submitted_at: z.string(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    verified_at: z.string().optional().nullable(),
    verified_by: z.string().optional().nullable(),
});

export const TournamentOverallRecordSchema = z.object({
    id: z.string(),
    tournament_id: z.string(),
    tournament_name: z.string().optional().nullable(),
    event_id: z.string(),
    event: z.string(),
    code: z.string(),
    age: z.number().optional().nullable(),
    country: z.string().optional().nullable(),
    three_three_three: z.number(),
    three_six_three: z.number(),
    cycle: z.number(),
    overall_time: z.number(),
    status: recordStatusEnum,
    video_url: z.string().url().optional().nullable(),
    classification: classificationEnum.optional().nullable(),
    submitted_at: z.string(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    verified_at: z.string().optional().nullable(),
    verified_by: z.string().optional().nullable(),
    participant_id: z.string(),
    participant_global_id: z.string(),
    participant_name: z.string(),
    gender: z.string(),
});

export const TournamentRecordSchema = TournamentRecordBaseSchema.extend({
    participant_id: z.string(),
    participant_global_id: z.string(),
    participant_name: z.string(),
    gender: z.string(),
});

export const TournamentTeamRecordSchema = TournamentRecordBaseSchema.extend({
    team_id: z.string(),
    team_name: z.string(),
    member_global_ids: z.array(z.string()),
    leader_id: z.string().optional().nullable(),
});

export const GlobalResultSchema = z.object({
    event: z.string(),
    gender: z.string(),
    participantId: z.string().optional(),
    participantGlobalId: z.string().optional(),
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
    classification: z.enum(["advance", "intermediate", "beginner", "prelim"]).optional(),
    bestTime: z.number().optional(),
    try1: z.number().optional(),
    try2: z.number().optional(),
    try3: z.number().optional(),
    tournamentId: z.string().optional(),
    teamId: z.string().optional(),
    ageGroup: z.string().optional(),
    tournament_name: z.string().optional().nullable(),
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
    classification: z.enum(["advance", "intermediate", "beginner", "prelim"]).optional(),
    bestTime: z.number().optional(),
    try1: z.number().optional(),
    try2: z.number().optional(),
    try3: z.number().optional(),
    tournamentId: z.string().optional(),
    teamId: z.string().optional(),
    ageGroup: z.string().optional(),
    tournament_name: z.string().optional().nullable(),
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
    age: z.number().nullable(),
    status: z.enum(["submitted", "verified"]),
    videoUrl: z.string().optional(),
    rawTime: z.number(),
    recordId: z.string().optional(),
    participantId: z.string().optional(),
    teamName: z.string().optional(),
    tournament_name: z.string().optional().nullable(),
    // Team-specific display fields
    members: z.array(z.string()).optional(),
    leaderId: z.string().optional(),
});

export type TournamentRecord = z.infer<typeof TournamentRecordSchema>;

export type TournamentTeamRecord = z.infer<typeof TournamentTeamRecordSchema>;
export type TournamentOverallRecord = z.infer<typeof TournamentOverallRecordSchema>;
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
