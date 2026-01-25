import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const ProfileSchema = z.object({
    id: z.string().optional().nullable(),
    owner_uid: z.string().optional().nullable(),
    owner_email: z.string().email().optional().nullable(),
    global_id: z.string(),
    name: z.string(),
    IC: z.string().regex(/^\d{12}$/, {
        message: "IC must be 12 digits like 123546121234",
    }),
    birthdate: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    gender: z.enum(["Male", "Female"]),
    country: z.array(z.string(), z.string()).optional().nullable(),
    phone_number: z.string().optional().nullable(),
    school: z.string().optional().nullable(),
    contact_email: z.string().email().optional().nullable(),
    status: z.enum(["claimed", "unclaimed"]).default("unclaimed"),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
    created_by_admin_id: z.string().optional().nullable(),
});

export type Profile = z.infer<typeof ProfileSchema>;
