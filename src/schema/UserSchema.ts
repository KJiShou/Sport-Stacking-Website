import {z} from "zod";

export const UserSchema = z.object({
    id: z.string(),
    name: z.string(),
    IC: z.string().regex(/^\d{12}$/, {
        message: "IC must be 12 digits like 123546121234",
    }),
    email: z.string().email(),
    birthdate: z.date(),
    gender: z.enum(["male", "female", "other"]),
    country: z.string(),
    state: z.string(),
    image_url: z.string().url(),
    roles: z.array(z.string()), // role ID
    best_times: z.record(z.string(), z.number()).optional(),
    password: z.string(),
});

export type User = z.infer<typeof UserSchema>;
export const FirestoreUserSchema = UserSchema.omit({password: true});
export type FirestoreUser = z.infer<typeof FirestoreUserSchema>;
