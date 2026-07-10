import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const UserNotificationSchema = z.object({
    id: z.string(),
    target_global_id: z.string(),
    type: z.enum(["team_invitation_rejected"]),
    status: z.enum(["unread", "read"]),
    title: z.string(),
    message: z.string(),
    tournament_id: z.string().optional().nullable(),
    team_id: z.string().optional().nullable(),
    actor_global_id: z.string().optional().nullable(),
    action_url: z.string().url().optional().nullable(),
    email_status: z.enum(["pending", "sending", "accepted", "failed", "skipped"]).optional().nullable(),
    email_provider: z.enum(["resend", "aws-ses"]).optional().nullable(),
    email_message_id: z.string().optional().nullable(),
    email_error: z.string().optional().nullable(),
    created_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    updated_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    read_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
});

export type UserNotification = z.infer<typeof UserNotificationSchema>;
