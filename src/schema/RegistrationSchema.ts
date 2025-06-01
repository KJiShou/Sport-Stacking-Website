import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const RegistrationSchema = z.object({
    id: z.string().optional().nullable(),
    competition_id: z.string(),
    user_id: z.string(),
    user_name: z.string(),
    age: z.number(),
    events_registered: z.array(z.string()),
    payment_proof_url: z.string().url().optional().nullable(),
    registration_status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
    members: z.array(z.string()).optional(),
    final_status: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type Registration = z.infer<typeof RegistrationSchema>;
