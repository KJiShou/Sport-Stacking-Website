import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const HomeCarouselImageSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional().nullable(),
    imageUrl: z.string().url(),
    link: z.string().optional().nullable(),
    order: z.number(),
    active: z.boolean().default(true),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type HomeCarouselImage = z.infer<typeof HomeCarouselImageSchema>;
