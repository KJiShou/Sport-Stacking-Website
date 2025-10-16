import {doc, getDoc, onSnapshot, type Unsubscribe} from "firebase/firestore";
import type {UserTournamentHistory} from "@/schema";
import {UserTournamentHistorySchema} from "@/schema";
import {db} from "./config";

export async function fetchUserTournamentHistory(globalId: string): Promise<UserTournamentHistory | null> {
    const trimmed = globalId.trim();
    if (!trimmed) {
        return null;
    }

    const historyRef = doc(db, "user_tournament_history", trimmed);
    const snap = await getDoc(historyRef);
    if (!snap.exists()) {
        return null;
    }

    const parsed = UserTournamentHistorySchema.safeParse(snap.data());
    if (!parsed.success) {
        console.error("Failed to parse tournament history cache", parsed.error.flatten());
        return null;
    }

    return parsed.data;
}

export function subscribeUserTournamentHistory(
    globalId: string,
    callback: (history: UserTournamentHistory | null) => void,
): Unsubscribe {
    const trimmed = globalId.trim();
    if (!trimmed) {
        callback(null);
        return () => {};
    }

    const historyRef = doc(db, "user_tournament_history", trimmed);
    return onSnapshot(
        historyRef,
        (snap) => {
            if (!snap.exists()) {
                callback(null);
                return;
            }
            const parsed = UserTournamentHistorySchema.safeParse(snap.data());
            callback(parsed.success ? parsed.data : null);
        },
        (error) => {
            console.error("Failed to subscribe to tournament history cache", error);
            callback(null);
        },
    );
}
