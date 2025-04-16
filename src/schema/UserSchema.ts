import {z} from "zod";

export const UserSchema = z.object({
    name: z.string(),
    IC: z.string(),
    email: z.string().email(),
    birthdate: z.date(),
    gender: z.enum(["male", "female", "other"]),
    country: z.string(),
    state: z.string(),
    image_url: z.string().url(),
    roles: z.array(z.string()), // role ID
    best_times: z.record(z.string(), z.number()).optional(),
});

export type User = z.infer<typeof UserSchema>;
