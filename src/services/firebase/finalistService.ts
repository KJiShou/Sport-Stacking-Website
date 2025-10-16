import {collection, deleteDoc, doc, getDocs, setDoc} from "firebase/firestore";
import type {EventCategory, FinalistGroupPayload} from "../../schema";
import {db as firestore} from "./config";

const normalizeBracketKey = (bracket: string, classification: string): string => {
    // Convert to lowercase first
    const lower = bracket.toLowerCase();

    // Process character by character to build normalized string
    let result = "";
    let lastWasDash = false;

    for (let i = 0; i < lower.length; i++) {
        const char = lower[i];
        // Keep alphanumeric characters
        if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9")) {
            result += char;
            lastWasDash = false;
        }
        // Replace other characters with dash, but avoid consecutive dashes
        else if (!lastWasDash) {
            result += "-";
            lastWasDash = true;
        }
    }

    // Trim leading/trailing dashes without regex
    let start = 0;
    let end = result.length;

    while (start < end && result[start] === "-") {
        start++;
    }
    while (end > start && result[end - 1] === "-") {
        end--;
    }

    result = result.slice(start, end);

    return `${result}-${classification}`;
};

const sortUniqueIds = (ids: string[]): string[] => {
    const unique = Array.from(new Set(ids.filter((id) => id && id.length > 0)));
    return unique.sort((a, b) => a.localeCompare(b));
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

export const saveTournamentFinalists = async (tournamentId: string, groups: FinalistGroupPayload[]): Promise<void> => {
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

    for (const groupEntries of Array.from(groupedByEvent.values())) {
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

        for (const docId of Array.from(existingDocs.keys())) {
            await deleteDoc(doc(finalistsCollection, docId));
        }
    }
};
