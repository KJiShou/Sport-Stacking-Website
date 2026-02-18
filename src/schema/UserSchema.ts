import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const UserRegistrationRecordSchema = z.object({
    tournament_id: z.string(),
    events: z.array(z.string()),
    registration_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
    classification: z.enum(["advance", "intermediate", "beginner", "prelim"]).optional().nullable(),
    // Rankings in this tournament
    prelim_rank: z.number().optional().nullable(),
    final_rank: z.number().optional().nullable(),
    // Overall results (individual only)
    prelim_overall_result: z.number().optional().nullable(), // Overall time for prelim
    final_overall_result: z.number().optional().nullable(), // Overall time for final
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});
export type UserRegistrationRecord = z.infer<typeof UserRegistrationRecordSchema>;

export const UserRoleSchema = z
    .object({
        edit_tournament: z.boolean(),
        record_tournament: z.boolean(),
        modify_admin: z.boolean(),
        verify_record: z.boolean(),
    })
    .partial();

export type UserRole = z.infer<typeof UserRoleSchema>;

export const BestTimeRecordSchema = z.object({
    time: z.number(),
    updated_at: z
        .union([z.instanceof(Timestamp), z.instanceof(Date)])
        .optional()
        .nullable(),
    // Season label like "2024-2025"
    season: z
        .string()
        .regex(/^\d{4}-\d{4}$/)
        .optional()
        .nullable(),
});

export const BestTimesSchema = z.object({
    "3-3-3": BestTimeRecordSchema.optional().nullable(),
    "3-6-3": BestTimeRecordSchema.optional().nullable(),
    Cycle: BestTimeRecordSchema.optional().nullable(),
    Overall: BestTimeRecordSchema.optional().nullable(),
});

export type BestTimeRecord = z.infer<typeof BestTimeRecordSchema>;
export type BestTimes = z.infer<typeof BestTimesSchema>;

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
    country: z.array(z.string()),
    image_url: z.string().url(),
    roles: UserRoleSchema.optional().nullable(),
    school: z.string().optional().nullable(),
    best_times: BestTimesSchema.optional().nullable(),
    registration_records: z.array(UserRegistrationRecordSchema).optional().nullable(),
    last_selected_profile_id: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type FirestoreUser = z.infer<typeof FirestoreUserSchema>;
