import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const UserRegistrationRecordSchema = z.object({
    tournament_id: z.string(),
    events: z.array(z.string()),
    registration_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});
export type UserRegistrationRecord = z.infer<typeof UserRegistrationRecordSchema>;

export const FirestoreUserSchema = z.object({
    id: z.string(),
    memberId: z.string().optional().nullable(),
    global_id: z.string().optional().nullable(),
    name: z.string(),
    IC: z.string().regex(/^\d{12}$/, {
        message: "IC must be 12 digits like 123546121234",
    }),
    email: z.string().email(),
    phone_number: z.string().optional().nullable(),
    birthdate: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    gender: z.enum(["Male", "Female"]),
    country: z.array(z.string(), z.string()),
    image_url: z.string().url(),
    roles: z
        .object({
            edit_tournament: z.boolean(),
            record_tournament: z.boolean(),
            modify_admin: z.boolean(),
            verify_record: z.boolean(),
        })
        .optional()
        .nullable(),
    school: z.string().optional().nullable(),
    best_times: z.record(z.string(), z.number()).optional(),
    registration_records: z.array(UserRegistrationRecordSchema).optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type FirestoreUser = z.infer<typeof FirestoreUserSchema>;
