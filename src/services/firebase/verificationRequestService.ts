import type {VerificationRequest} from "@/schema";
import {collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, writeBatch, where} from "firebase/firestore";
import {db} from "./config";

const VERIFICATION_REQUEST_COLLECTION = "verification_requests";
const MAX_BATCH_DELETE = 400;

const toVerificationRequest = (id: string, data: Record<string, unknown>): VerificationRequest => {
    return {
        id,
        target_global_id: (data.target_global_id as string) ?? "",
        tournament_id: (data.tournament_id as string) ?? "",
        team_id: (data.team_id as string) ?? "",
        member_id: (data.member_id as string) ?? "",
        registration_id: (data.registration_id as string) ?? "",
        status: ((data.status as VerificationRequest["status"]) ?? "pending") as VerificationRequest["status"],
        event_label: (data.event_label as string) ?? null,
        team_name: (data.team_name as string) ?? null,
        leader_label: (data.leader_label as string) ?? null,
        created_at: (data.created_at as VerificationRequest["created_at"]) ?? null,
        updated_at: (data.updated_at as VerificationRequest["updated_at"]) ?? null,
        verified_at: (data.verified_at as VerificationRequest["verified_at"]) ?? null,
    };
};

export async function fetchPendingVerificationRequests(globalId: string): Promise<VerificationRequest[]> {
    const targetGlobalId = globalId.trim();
    if (!targetGlobalId) {
        return [];
    }

    const q = query(collection(db, VERIFICATION_REQUEST_COLLECTION), where("target_global_id", "==", targetGlobalId));
    const snapshot = await getDocs(q);
    const requests = snapshot.docs
        .map((docSnap) => toVerificationRequest(docSnap.id, docSnap.data() as Record<string, unknown>))
        .filter((request) => request.status === "pending");

    return requests.sort((a, b) => {
        const timeA = a.created_at instanceof Date ? a.created_at.getTime() : (a.created_at?.toMillis?.() ?? 0);
        const timeB = b.created_at instanceof Date ? b.created_at.getTime() : (b.created_at?.toMillis?.() ?? 0);
        return timeB - timeA;
    });
}

export function subscribePendingVerificationCount(globalId: string, onCountChange: (count: number) => void): () => void {
    const targetGlobalId = globalId.trim();
    if (!targetGlobalId) {
        onCountChange(0);
        return () => void 0;
    }

    const q = query(collection(db, VERIFICATION_REQUEST_COLLECTION), where("target_global_id", "==", targetGlobalId));
    const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
            const count = snapshot.docs.reduce((acc, docSnap) => {
                const status = (docSnap.data() as {status?: string}).status;
                return status === "pending" ? acc + 1 : acc;
            }, 0);
            onCountChange(count);
        },
        (error) => {
            console.error("Failed to subscribe verification requests:", error);
            onCountChange(0);
        },
    );

    return unsubscribe;
}

const deleteVerificationRequestDocIds = async (docIds: string[]): Promise<number> => {
    const uniqueDocIds = Array.from(new Set(docIds.filter((id) => id && id.trim().length > 0)));
    if (uniqueDocIds.length === 0) {
        return 0;
    }

    let deletedCount = 0;
    for (let i = 0; i < uniqueDocIds.length; i += MAX_BATCH_DELETE) {
        const chunk = uniqueDocIds.slice(i, i + MAX_BATCH_DELETE);
        const batch = writeBatch(db);
        for (const id of chunk) {
            batch.delete(doc(db, VERIFICATION_REQUEST_COLLECTION, id));
            deletedCount += 1;
        }
        await batch.commit();
    }

    return deletedCount;
};

export const buildVerificationRequestId = (tournamentId: string, teamId: string, memberId: string): string =>
    `${tournamentId}_${teamId}_${memberId}`;

export async function deleteVerificationRequestByTournamentTeamMember(
    tournamentId: string,
    teamId: string,
    memberId: string,
): Promise<void> {
    const requestId = buildVerificationRequestId(tournamentId, teamId, memberId);
    await deleteDoc(doc(db, VERIFICATION_REQUEST_COLLECTION, requestId));
}

export async function deleteVerificationRequestsByTeamId(teamId: string): Promise<number> {
    const normalizedTeamId = teamId.trim();
    if (!normalizedTeamId) {
        return 0;
    }

    const snapshot = await getDocs(
        query(collection(db, VERIFICATION_REQUEST_COLLECTION), where("team_id", "==", normalizedTeamId)),
    );
    return deleteVerificationRequestDocIds(snapshot.docs.map((docSnap) => docSnap.id));
}

export async function deleteVerificationRequestsByRegistrationId(registrationId: string): Promise<number> {
    const normalizedRegistrationId = registrationId.trim();
    if (!normalizedRegistrationId) {
        return 0;
    }

    const snapshot = await getDocs(
        query(collection(db, VERIFICATION_REQUEST_COLLECTION), where("registration_id", "==", normalizedRegistrationId)),
    );
    return deleteVerificationRequestDocIds(snapshot.docs.map((docSnap) => docSnap.id));
}

export async function deleteVerificationRequestsByTournamentAndMember(
    tournamentId: string,
    memberId: string,
): Promise<number> {
    const normalizedTournamentId = tournamentId.trim();
    const normalizedMemberId = memberId.trim();
    if (!normalizedTournamentId || !normalizedMemberId) {
        return 0;
    }

    const snapshot = await getDocs(
        query(
            collection(db, VERIFICATION_REQUEST_COLLECTION),
            where("tournament_id", "==", normalizedTournamentId),
            where("member_id", "==", normalizedMemberId),
        ),
    );
    return deleteVerificationRequestDocIds(snapshot.docs.map((docSnap) => docSnap.id));
}

export async function deleteVerificationRequestForUser(requestId: string, globalId: string): Promise<void> {
    const normalizedRequestId = requestId.trim();
    const normalizedGlobalId = globalId.trim();
    if (!normalizedRequestId || !normalizedGlobalId) {
        throw new Error("Invalid verification request.");
    }

    const requestRef = doc(db, VERIFICATION_REQUEST_COLLECTION, normalizedRequestId);
    const snapshot = await getDoc(requestRef);
    if (!snapshot.exists()) {
        return;
    }

    const targetGlobalId = (snapshot.data() as {target_global_id?: string}).target_global_id ?? "";
    if (targetGlobalId !== normalizedGlobalId) {
        throw new Error("You cannot delete another user's verification request.");
    }

    await deleteDoc(requestRef);
}
