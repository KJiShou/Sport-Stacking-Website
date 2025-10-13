import {collection, deleteDoc, doc, getDocs, setDoc} from "firebase/firestore";
import {db as firestore} from "./config";

export type EventCategory = "individual" | "double" | "team_relay" | "parent_&_child" | "special_need";

export interface FinalistGroupPayload {
    eventCategory: EventCategory;
    eventName: string;
    bracketName: string;
    classification: "beginner" | "intermediate" | "advance";
    participantIds: string[];
    participantType: "individual" | "team";
}

const normalizeBracketKey = (bracket: string, classification: string): string => {
    const normalizedBracket = bracket
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `${normalizedBracket}-${classification}`;
};

const sortUniqueIds = (ids: string[]): string[] => {
    const unique = Array.from(new Set(ids.filter((id) => id && id.length > 0)));
    return unique.sort();
};

const arraysEqual = (a: string[] | undefined, b: string[] | undefined): boolean => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
};

export const getEventCategoryFromType = (type: string): EventCategory => {
    const normalized = type.trim().toLowerCase();
    switch (normalized) {
        case "double":
            return "double";
        case "team relay":
            return "team_relay";
        case "parent & child":
            return "parent_&_child";
        case "special need":
            return "special_need";
        default:
            return "individual";
    }
};

export const saveTournamentFinalists = async (
    tournamentId: string,
    groups: FinalistGroupPayload[],
): Promise<void> => {
    if (!tournamentId || groups.length === 0) {
        return;
    }

    const groupedByEvent = new Map<string, FinalistGroupPayload[]>();

    for (const group of groups) {
        const key = `${group.eventCategory}::${group.eventName}`;
        const existing = groupedByEvent.get(key) ?? [];
        existing.push(group);
        groupedByEvent.set(key, existing);
    }

    for (const [, groupEntries] of groupedByEvent) {
        const {eventCategory, eventName} = groupEntries[0];
        const finalistsCollection = collection(
            firestore,
            `tournaments/${tournamentId}/events/finalist/${eventCategory}/${eventName}/groups`,
        );

        const snapshot = await getDocs(finalistsCollection);
        const existingDocs = new Map(
            snapshot.docs.map((docSnap) => {
                const data = docSnap.data() as {participantIds?: string[]};
                const ids = data.participantIds ? sortUniqueIds(data.participantIds) : [];
                return [docSnap.id, ids] as const;
            }),
        );

        for (const entry of groupEntries) {
            const docId = normalizeBracketKey(entry.bracketName, entry.classification);
            const participantIds = sortUniqueIds(entry.participantIds);
            const previousIds = existingDocs.get(docId);
            const docRef = doc(finalistsCollection, docId);

            if (!arraysEqual(previousIds, participantIds)) {
                await setDoc(docRef, {
                    bracketName: entry.bracketName,
                    classification: entry.classification,
                    participantIds,
                    participantType: entry.participantType,
                    eventCategory: entry.eventCategory,
                    eventName: entry.eventName,
                    updatedAt: new Date().toISOString(),
                });
            }

            existingDocs.delete(docId);
        }

        for (const docId of existingDocs.keys()) {
            await deleteDoc(doc(finalistsCollection, docId));
        }
    }
};
