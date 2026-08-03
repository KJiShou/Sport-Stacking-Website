import type {Team} from "@/schema";
import {httpsCallable} from "firebase/functions";
import {type OperationMeta, captureClientError, createOperationId, getRelease} from "../observability";
import {functions} from "./config";

type AdminTeamMutationInput = {
    action?: "upsert" | "add-member" | "delete";
    tournamentId: string;
    teamId?: string;
    memberId?: string;
    team?: Partial<Team>;
    meta?: OperationMeta;
};

type AdminTeamMutationResult = {teamId: string; deleted: boolean};

const mutateAdminTeam = async (input: AdminTeamMutationInput): Promise<AdminTeamMutationResult> => {
    const callable = httpsCallable<AdminTeamMutationInput, AdminTeamMutationResult>(functions, "mutateAdminTeam");
    try {
        const result = await callable({...input, meta: input.meta ?? {operationId: createOperationId(), release: getRelease()}});
        return result.data;
    } catch (error) {
        void captureClientError(error, {entityType: "team", entityId: input.teamId, tournamentId: input.tournamentId});
        throw error;
    }
};

export const upsertAdminTeam = (tournamentId: string, team: Partial<Team>, teamId?: string): Promise<AdminTeamMutationResult> =>
    mutateAdminTeam({action: "upsert", tournamentId, teamId, team});

export const addAdminTeamMember = (tournamentId: string, teamId: string, memberId: string): Promise<AdminTeamMutationResult> =>
    mutateAdminTeam({action: "add-member", tournamentId, teamId, memberId});

export const deleteAdminTeam = (tournamentId: string, teamId: string): Promise<AdminTeamMutationResult> =>
    mutateAdminTeam({action: "delete", tournamentId, teamId});
