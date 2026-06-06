import {Timestamp} from "firebase/firestore";
import {z} from "zod";

export const UserRegistrationRecordSchema = z.object({
    tournament_id: z.string(),
    events: z.array(z.string()),
    registration_date: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    status: z.enum(["pending", "approved", "rejected"]),
    rejection_reason: z.string().optional().nullable(),
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

const BestTimeRecordSchema = z.object({
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

export const UserIdentityTypeSchema = z.enum(["MYKAD", "PASSPORT", "NONE"]);
export const UserAccountStatusSchema = z.enum(["claimed", "unclaimed", "claim_review"]);
export const UserAccountSourceSchema = z.enum(["legacy", "self_registered", "admin_import"]);
export const ProfileClaimRequestStatusSchema = z.enum(["pending", "approved", "rejected"]);

export const FirestoreUserSchema = z.object({
    id: z.string(),
    memberId: z.string().optional().nullable(),
    global_id: z.string().optional().nullable(),
    name_search: z.string().optional().nullable(),
    name: z.string(),
    IC: z.string().min(1).optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone_number: z.string().optional().nullable(),
    birthdate: z.union([z.instanceof(Timestamp), z.instanceof(Date)]),
    gender: z.enum(["Male", "Female"]),
    country: z.array(z.string(), z.string()),
    image_url: z.string().url().optional().nullable().or(z.literal("")),
    owner_uids: z.array(z.string()).optional().nullable(),
    primary_owner_email: z.string().email().optional().nullable(),
    account_status: UserAccountStatusSchema.optional().nullable(),
    source: UserAccountSourceSchema.optional().nullable(),
    identity_type: UserIdentityTypeSchema.optional().nullable(),
    identity_key: z.string().optional().nullable(),
    passport_country: z.string().optional().nullable(),
    import_batch_id: z.string().optional().nullable(),
    claim_method: z.enum(["identity_match", "admin_review"]).optional().nullable(),
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
    best_times: z
        .object({
            "3-3-3": BestTimeRecordSchema.optional().nullable(),
            "3-6-3": BestTimeRecordSchema.optional().nullable(),
            Cycle: BestTimeRecordSchema.optional().nullable(),
            Overall: BestTimeRecordSchema.optional().nullable(),
        })
        .optional()
        .nullable(),
    registration_records: z.array(UserRegistrationRecordSchema).optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
});

export type FirestoreUser = z.infer<typeof FirestoreUserSchema>;

export const ProfileClaimRequestSchema = z.object({
    id: z.string().optional().nullable(),
    requester_uid: z.string(),
    requester_email: z.string().email(),
    profile_global_id: z.string().optional().nullable(),
    profile_name: z.string(),
    identity_hint: z.string().optional().nullable(),
    birthdate_hint: z.union([z.instanceof(Timestamp), z.instanceof(Date)]).optional().nullable(),
    tournament_hint: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
    status: ProfileClaimRequestStatusSchema,
    matched_profile_id: z.string().optional().nullable(),
    reviewed_by_uid: z.string().optional().nullable(),
    reviewed_by_email: z.string().email().optional().nullable(),
    rejection_reason: z.string().optional().nullable(),
    created_at: z.instanceof(Timestamp).optional().nullable(),
    updated_at: z.instanceof(Timestamp).optional().nullable(),
    reviewed_at: z.instanceof(Timestamp).optional().nullable(),
});

export type ProfileClaimRequest = z.infer<typeof ProfileClaimRequestSchema>;
