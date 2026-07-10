import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const VerificationRequestSchema = z.object({
    id: z.string(),
    target_global_id: z.string(),
    tournament_id: z.string(),
    team_id: z.string(),
    member_id: z.string(),
    registration_id: z.string(),
    status: z.enum(["pending", "verified", "expired", "rejected"]),
    event_label: z.string().optional().nullable(),
    team_name: z.string().optional().nullable(),
    leader_label: z.string().optional().nullable(),
    created_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    updated_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    verified_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    rejected_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    rejected_by: z.string().optional().nullable(),
    email_status: z.enum(["pending", "sending", "accepted", "failed", "skipped"]).optional().nullable(),
    email_provider: z.enum(["resend", "aws-ses"]).optional().nullable(),
    email_message_id: z.string().optional().nullable(),
    email_error: z.string().optional().nullable(),
});

export type VerificationRequest = z.infer<typeof VerificationRequestSchema>;
