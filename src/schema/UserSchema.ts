import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const FirestoreUserSchema = z.object({
    id: z.string(),
    global_id: z.string().optional().nullable(),
    name: z.string(),
    IC: z.string().regex(/^\d{12}$/, {
        message: "IC must be 12 digits like 123546121234",
    }),
    email: z.string().email(),
    birthdate: z.date(),
    gender: z.enum(["Male", "Female"]),
    country: z.array(z.string(), z.string()),
    image_url: z.string().url(),
    roles: z
        .object({
            edit_competition: z.boolean(),
            record_competition: z.boolean(),
            modify_admin: z.boolean(),
            verify_record: z.boolean(),
        })
        .optional()
        .nullable(),
    organizer: z.string().optional().nullable(),
    best_times: z.record(z.string(), z.number()).optional(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type FirestoreUser = z.infer<typeof FirestoreUserSchema>;
