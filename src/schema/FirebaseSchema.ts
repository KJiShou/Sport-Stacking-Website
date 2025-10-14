import {z} from "zod";

export const FirebaseConfigSchema = z.object({
    apiKey: z.string(),
    authDomain: z.string(),
    projectId: z.string(),
    storageBucket: z.string(),
    messagingSenderId: z.string(),
    appId: z.string(),
    measurementId: z.string(),
});

export type FirebaseConfig = z.infer<typeof FirebaseConfigSchema>;
