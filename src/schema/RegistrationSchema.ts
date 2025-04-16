import {z} from "zod";

export const RegistrationSchema = z.object({
    user_id: z.string(),
    age: z.number(),
    events_registered: z.array(z.string()),
    payment_proof_url: z.string().url().optional(),
    registration_status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional(),
    members: z.array(z.string()).optional(),
    final_status: z.string().optional(),
});

export type Registration = z.infer<typeof RegistrationSchema>;
