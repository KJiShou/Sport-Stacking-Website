import {z} from "zod";

export const RoleSchema = z.object({
    role: z.string(),
    permissions: z.array(z.enum(["approve_registrations", "enter_results", "create_competitions", "verify_records"])),
});

export type Role = z.infer<typeof RoleSchema>;
