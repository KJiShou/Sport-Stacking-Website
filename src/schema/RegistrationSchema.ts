import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const RegistrationSchema = z.object({
    id: z.string().optional().nullable(),
    tournament_id: z.string(),
    user_id: z.string(),
    user_name: z.string(),
    age: z.number(),
    gender: z.enum(["Male", "Female"]).optional(),
    country: z.string(),
    phone_number: z.string(),
    organizer: z.string(),
    events_registered: z.array(z.string()),
    registrationFee: z.number().optional().nullable(),
    memberRegistrationFee: z.number().optional().nullable(),
    payment_proof_url: z.string().url().optional().nullable(),
    registration_status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
    teams: z
        .array(
            z.object({
                team_id: z.string(),
                label: z.string().optional().nullable(),
                name: z.string(),
                member: z.array(
                    z.object({
                        global_id: z.string().optional().nullable(),
                        verified: z.boolean().optional(),
                    }),
                ),
                leader: z.object({
                    global_id: z.string().optional().nullable(),
                    verified: z.boolean().optional(),
                }),
                looking_for_team_members: z.boolean().optional().default(false),
            }),
        )
        .optional()
        .nullable(),
    final_status: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type Registration = z.infer<typeof RegistrationSchema>;

export const RegistrationFormSchema = z.object({
    id: z.string().optional().nullable(),
    tournament_id: z.string(),
    user_id: z.string(),
    user_name: z.string(),
    age: z.number(),
    gender: z.enum(["Male", "Female"]).optional(),
    country: z.string(),
    phone_number: z.string(),
    organizer: z.string(),
    events_registered: z.array(z.string()),
    registrationFee: z.number().optional().nullable(),
    memberRegistrationFee: z.number().optional().nullable(),
    payment_proof_url: z.string().url().optional().nullable(),
    registration_status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
    teams: z
        .array(
            z.object({
                team_id: z.string(),
                label: z.string().optional().nullable(),
                name: z.string(),
                member: z.array(z.string().optional().nullable()),
                leader: z.string().optional().nullable(),
                looking_for_team_members: z.boolean().optional().default(false),
            }),
        )
        .optional()
        .nullable(),
    final_status: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type RegistrationForm = z.infer<typeof RegistrationFormSchema>;
