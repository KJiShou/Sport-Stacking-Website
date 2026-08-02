import type {FirestoreUser, VerificationRequest} from "@/schema";
import {httpsCallable} from "firebase/functions";
import {type OperationMeta, captureClientError, createOperationId, getRelease} from "../observability";
import {functions} from "./config";

export type AdminRegistrationInput = {
    tournamentId: string;
    targetUserId: string;
    eventIds: string[];
    paymentProofUrl?: string | null;
    teamAssignments?: AdminTeamAssignment[];
    meta?: OperationMeta;
};

export type AdminTeamAssignment = {
    eventId: string;
    teamName: string;
    memberGlobalIds: string[];
};

export type AdminRegistrationResult = {registrationId: string};
export type AdminInvitationApprovalResult = {success: boolean; requestId: string};
export type AdminPendingTeamInvitation = Pick<
    VerificationRequest,
    | "id"
    | "target_global_id"
    | "tournament_id"
    | "team_id"
    | "member_id"
    | "registration_id"
    | "status"
    | "event_label"
    | "team_name"
    | "leader_label"
> & {status: "pending"};
export type AdminPendingTeamInvitationsResult = {invitations: AdminPendingTeamInvitation[]};

export const createAdminTournamentRegistration = async (input: AdminRegistrationInput): Promise<AdminRegistrationResult> => {
    const callable = httpsCallable<AdminRegistrationInput, AdminRegistrationResult>(
        functions,
        "adminCreateTournamentRegistration",
    );
    try {
        const result = await callable({...input, meta: input.meta ?? {operationId: createOperationId(), release: getRelease()}});
        return result.data;
    } catch (error) {
        void captureClientError(error, {entityType: "registration", tournamentId: input.tournamentId});
        throw error;
    }
};

export const approveAdminTeamInvitation = async (requestId: string): Promise<AdminInvitationApprovalResult> => {
    const callable = httpsCallable<{requestId: string; meta?: OperationMeta}, AdminInvitationApprovalResult>(
        functions,
        "adminApproveTeamInvitation",
    );
    try {
        const result = await callable({requestId, meta: {operationId: createOperationId(), release: getRelease()}});
        return result.data;
    } catch (error) {
        void captureClientError(error, {entityType: "verification-request", entityId: requestId});
        throw error;
    }
};

export const fetchAdminPendingTeamInvitations = async (tournamentId: string): Promise<AdminPendingTeamInvitation[]> => {
    const callable = httpsCallable<{tournamentId: string}, AdminPendingTeamInvitationsResult>(
        functions,
        "adminListPendingTeamInvitations",
    );
    try {
        const result = await callable({tournamentId});
        return result.data.invitations;
    } catch (error) {
        void captureClientError(error, {entityType: "verification-request", tournamentId});
        throw error;
    }
};

export const isEligibleAdminMember = (profile: FirestoreUser): boolean =>
    typeof profile.global_id === "string" && profile.global_id.trim().length > 0;
