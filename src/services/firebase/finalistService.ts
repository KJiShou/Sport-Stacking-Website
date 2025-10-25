import {collection, doc, getDocs, query, setDoc, where} from "firebase/firestore";
import {FinalistGroupPayloadSchema} from "../../schema";
import type {FinalistGroupPayload} from "../../schema";
import {db as firestore} from "./config";

const finalistsCollection = collection(firestore, "finalists");

const allowedClassifications = new Set(["beginner", "intermediate", "advance", "prelim"]);

const ensureClassification = (value: unknown): "beginner" | "intermediate" | "advance" | "prelim" => {
    if (typeof value === "string") {
        const lowered = value.toLowerCase();
        if (allowedClassifications.has(lowered)) {
            return lowered as "beginner" | "intermediate" | "advance" | "prelim";
        }
    }
    return "beginner";
};

const ensureEventType = (value: unknown): FinalistGroupPayload["event_type"] => {
    const allowed: FinalistGroupPayload["event_type"][] = [
        "Individual",
        "Double",
        "Team Relay",
        "Parent & Child",
        "Special Need",
    ];

    if (typeof value === "string") {
        const match = allowed.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
        if (match) {
            return match;
        }
    }

    return "Individual";
};

const ensureParticipantType = (value: unknown): FinalistGroupPayload["participant_type"] => {
    if (typeof value === "string" && value.toLowerCase() === "team") {
        return "Team";
    }
    return "Individual";
};

const ensureStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
    }
    return [];
};

const mapDocumentToPayload = (
    raw: Record<string, unknown>,
    docId: string,
    fallbackTournamentId: string,
): FinalistGroupPayload | null => {
    const candidate = {
        id: (raw.id as string | undefined) ?? docId,
        tournament_id:
            (raw.tournament_id as string | undefined) ?? (raw.tournamentId as string | undefined) ?? fallbackTournamentId,
        event_id: (raw.event_id as string | undefined) ?? (raw.eventId as string | undefined) ?? undefined,
        event_type: ensureEventType(raw.event_type ?? raw.eventType ?? raw.event_category ?? raw.eventCategory),
        event_code: ensureStringArray(raw.event_code ?? raw.eventCode ?? raw.event_codes ?? raw.eventCodes),
        bracket_name: ((raw.bracket_name as string | undefined) ?? (raw.bracketName as string | undefined) ?? "").trim(),
        classification: ensureClassification(raw.classification),
        participant_ids: ensureStringArray(raw.participant_ids ?? raw.participantIds),
        participant_type: ensureParticipantType(raw.participant_type ?? raw.participantType),
    } satisfies Partial<FinalistGroupPayload>;

    const parsed = FinalistGroupPayloadSchema.safeParse(candidate);

    if (!parsed.success) {
        console.warn("Skipping finalist document due to validation error", {
            id: docId,
            issues: parsed.error.flatten(),
        });
        return null;
    }

    const payload = parsed.data;

    return {
        ...payload,
        event_code: Array.from(new Set(payload.event_code)),
        participant_ids: Array.from(new Set(payload.participant_ids)),
    };
};

const formatPayloadForStorage = (entry: FinalistGroupPayload, finalId: string): Record<string, unknown> => {
    return {
        ...entry,
        id: finalId,
        event_id: entry.event_id ?? undefined,
        event_type: ensureEventType(entry.event_type),
        event_code: Array.from(new Set(entry.event_code)),
        participant_ids: entry.participant_ids.filter((id) => typeof id === "string" && id.trim().length > 0),
        participant_type: ensureParticipantType(entry.participant_type),
        updated_at: new Date().toISOString(),
    };
};

export const fetchTournamentFinalists = async (tournamentId: string): Promise<FinalistGroupPayload[]> => {
    const finalistsQuery = query(finalistsCollection, where("tournament_id", "==", tournamentId));
    const snapshot = await getDocs(finalistsQuery);

    if (snapshot.empty) {
        return [];
    }

    return snapshot.docs
        .map((docSnapshot) => mapDocumentToPayload(docSnapshot.data(), docSnapshot.id, tournamentId))
        .filter((payload): payload is FinalistGroupPayload => Boolean(payload))
        .filter((payload) => payload.tournament_id === tournamentId);
};

export const saveTournamentFinalists = async (groups: FinalistGroupPayload[]): Promise<void> => {
    if (groups.length === 0) {
        return;
    }

    for (const group of groups) {
        const docRef = group.id ? doc(finalistsCollection, group.id) : doc(finalistsCollection);
        const finalId = group.id ?? docRef.id;
        const storagePayload = formatPayloadForStorage(group, finalId);

        if (!group.id) {
            storagePayload.created_at = new Date().toISOString();
        }

        await setDoc(docRef, storagePayload, {merge: true});
    }
};
