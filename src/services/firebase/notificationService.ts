import type {UserNotification} from "@/schema";
import {Timestamp, collection, doc, onSnapshot, query, updateDoc, where} from "firebase/firestore";
import {db} from "./config";

const NOTIFICATION_COLLECTION = "notifications";

const mapNotification = (id: string, data: Record<string, unknown>): UserNotification => ({
    id,
    target_global_id: (data.target_global_id as string) ?? "",
    type: (data.type as UserNotification["type"]) ?? "team_invitation_rejected",
    status: (data.status as UserNotification["status"]) ?? "unread",
    title: (data.title as string) ?? "Notification",
    message: (data.message as string) ?? "",
    tournament_id: (data.tournament_id as string) ?? null,
    team_id: (data.team_id as string) ?? null,
    actor_global_id: (data.actor_global_id as string) ?? null,
    action_url: (data.action_url as string) ?? null,
    email_status: (data.email_status as UserNotification["email_status"]) ?? null,
    email_provider: (data.email_provider as UserNotification["email_provider"]) ?? null,
    email_message_id: (data.email_message_id as string) ?? null,
    email_error: (data.email_error as string) ?? null,
    created_at: (data.created_at as UserNotification["created_at"]) ?? null,
    updated_at: (data.updated_at as UserNotification["updated_at"]) ?? null,
    read_at: (data.read_at as UserNotification["read_at"]) ?? null,
});

export function subscribeNotificationsForGlobalIds(
    globalIds: string[],
    onChange: (notifications: UserNotification[]) => void,
): () => void {
    const normalizedIds = Array.from(new Set(globalIds.map((globalId) => globalId.trim()).filter(Boolean)));
    if (normalizedIds.length === 0) {
        onChange([]);
        return () => void 0;
    }

    const notificationsByProfile = new Map<string, UserNotification[]>();
    const emit = () => {
        const merged = Array.from(notificationsByProfile.values())
            .flat()
            .sort((left, right) => {
                const leftTime =
                    left.created_at instanceof Date ? left.created_at.getTime() : (left.created_at?.toMillis?.() ?? 0);
                const rightTime =
                    right.created_at instanceof Date ? right.created_at.getTime() : (right.created_at?.toMillis?.() ?? 0);
                return rightTime - leftTime;
            });
        onChange(merged);
    };

    const unsubscribes = normalizedIds.map((globalId) =>
        onSnapshot(
            query(collection(db, NOTIFICATION_COLLECTION), where("target_global_id", "==", globalId)),
            (snapshot) => {
                notificationsByProfile.set(
                    globalId,
                    snapshot.docs.map((docSnapshot) =>
                        mapNotification(docSnapshot.id, docSnapshot.data() as Record<string, unknown>),
                    ),
                );
                emit();
            },
            (error) => {
                console.error("Failed to subscribe notifications:", error);
                notificationsByProfile.set(globalId, []);
                emit();
            },
        ),
    );

    return () => {
        for (const unsubscribe of unsubscribes) unsubscribe();
    };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
    await updateDoc(doc(db, NOTIFICATION_COLLECTION, notificationId), {
        status: "read",
        read_at: Timestamp.now(),
        updated_at: Timestamp.now(),
    });
}
