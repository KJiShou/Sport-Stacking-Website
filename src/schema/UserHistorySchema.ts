import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const CachedTournamentResultSchema = z.object({
    recordPath: z.string(),
    event: z.string().nullable(),
    eventKey: z.string().nullable(),
    eventCategory: z.string().nullable(),
    round: z.string().nullable(),
    bestTime: z.number().nullable(),
    try1: z.number().nullable(),
    try2: z.number().nullable(),
    try3: z.number().nullable(),
    status: z.string().nullable(),
    classification: z.string().nullable(),
    resultType: z.enum(["individual", "team"]),
    participantRole: z.enum(["participant", "leader", "member"]),
    teamContext: z
        .object({
            leaderId: z.string().nullable(),
            memberIds: z.array(z.string()),
        })
        .nullable(),
    submittedAt: z.instanceof(Timestamp).nullable(),
    verifiedAt: z.instanceof(Timestamp).nullable(),
    createdAt: z.instanceof(Timestamp).nullable(),
    updatedAt: z.instanceof(Timestamp).nullable(),
    videoUrl: z.string().nullable(),
});

export const CachedTournamentSummarySchema = z.object({
    tournamentId: z.string(),
    tournamentName: z.string().nullable(),
    startDate: z.instanceof(Timestamp).nullable(),
    endDate: z.instanceof(Timestamp).nullable(),
    country: z.string().nullable(),
    venue: z.string().nullable(),
    lastActivityAt: z.instanceof(Timestamp).nullable(),
    results: z.array(CachedTournamentResultSchema),
});

export const UserTournamentHistorySchema = z.object({
    globalId: z.string(),
    userId: z.string(),
    updatedAt: z.instanceof(Timestamp),
    tournamentCount: z.number(),
    recordCount: z.number(),
    tournaments: z.array(CachedTournamentSummarySchema),
});

export type CachedTournamentResult = z.infer<typeof CachedTournamentResultSchema>;
export type CachedTournamentSummary = z.infer<typeof CachedTournamentSummarySchema>;
export type UserTournamentHistory = z.infer<typeof UserTournamentHistorySchema>;
