import {z} from "zod";
import type {IndividualRecruitment} from "./IndividualRecruitmentSchema";

export const TeamRecruitmentSchema = z.object({
    id: z.string(),
    team_id: z.string(),
    tournament_id: z.string(),
    team_name: z.string(),
    leader_id: z.string(),
    events: z.array(z.string()),
    created_at: z.date(),
    status: z.enum(["active", "closed"]).default("active"),
    requirements: z.string().optional(),
    max_members_needed: z.number().optional(),
});

export type TeamRecruitment = z.infer<typeof TeamRecruitmentSchema>;

export interface AssignmentModalData {
    individual: IndividualRecruitment;
    availableTeams: TeamRecruitment[];
}
