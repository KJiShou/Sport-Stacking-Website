import {Timestamp} from "firebase/firestore";
import {z} from "zod";

// final_criteria subcollection
export const FinalCriterionSchema = z.object({
    classification: z.enum(["advance", "intermediate", "beginner", "prelim"]),
    number: z.number(),
});

export type FinalCriterion = z.infer<typeof FinalCriterionSchema>;

// age_brackets subcollection
export const AgeBracketSchema = z.object({
    name: z.string(),
    min_age: z.number(),
    max_age: z.number(),
    number_of_participants: z.number().optional().nullable().default(0),
    final_criteria: z.array(FinalCriterionSchema).optional(),
});

const EventGenderSchema = z.preprocess(
    (value) => (value === "Both" ? "Mixed" : value),
    z.enum(["Male", "Female", "Mixed"]).default("Mixed"),
);

export const EventSchema = z.object({
    id: z.string().optional().nullable(),
    tournament_id: z.string().optional().nullable(),
    codes: z.array(z.enum(["3-3-3", "3-6-3", "Cycle"])),
    type: z.enum([
        "Individual",
        "Double",
        "Team Relay",
        "Parent & Child",
        "Special Need",
        "Stack Up Champion",
        "StackOut Champion",
        "Blindfolded Cycle",
    ]),
    gender: EventGenderSchema,
    teamSize: z.number().optional(),
    max_participants: z.number().optional().nullable(),
    age_brackets: z.array(AgeBracketSchema),
});

export type AgeBracket = z.infer<typeof AgeBracketSchema>;
export type TournamentEvent = z.infer<typeof EventSchema>;

// payment method schema
export const PaymentMethodSchema = z.object({
    id: z.string(),
    qr_code_image: z.string().optional().nullable(), // URL to QR code image
    account_name: z.string(),
    account_number: z.string(),
    description: z.string().optional().nullable(),
});

export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

// main tournament schema
export const TournamentSchema = z.object({
    id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    country: z.array(z.string(), z.string()).optional().nullable(),
    address: z.string().optional().nullable(),
    venue: z.string().optional().nullable(),
    agenda: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    logo: z.string().optional().nullable(),
    isDraft: z.boolean().optional().nullable(),
    status: z.enum(["Up Coming", "On Going", "Close Registration", "End"]).optional().nullable(),
    start_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    end_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    participants: z.number().optional().nullable(),
    max_participants: z.number().optional().nullable(),
    editor: z.string().optional().nullable(),
    recorder: z.string().optional().nullable(),
    registration_start_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    registration_end_date: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    registration_fee: z.number().optional().nullable(),
    member_registration_fee: z.number().optional().nullable(),
    payment_methods: z.array(PaymentMethodSchema).optional().nullable(),
    create_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
    events: z.array(EventSchema).optional(),
});

export type Tournament = z.infer<typeof TournamentSchema>;
