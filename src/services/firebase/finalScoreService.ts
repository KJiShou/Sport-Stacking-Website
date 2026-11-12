import {type Firestore, collection, doc, getDocs, query, runTransaction, where} from "firebase/firestore";
import {TournamentOverallRecordSchema, type TournamentRecord, TournamentRecordSchema} from "../../schema/RecordSchema";

const CODES = ["3-3-3", "3-6-3", "Cycle"] as const;

// Read all three slots in a transaction, including missing slots. Stable IDs make
// simultaneous first-time submissions conflict and retry instead of losing Overall.
export const saveFinalIndividualScores = async (db: Firestore, input: TournamentRecord[]): Promise<void> => {
    if (input.length === 0) return;
    const records = input.map((record) => TournamentRecordSchema.parse(record));
    const first = records[0];
    const matches = (record: TournamentRecord) =>
        record.tournament_id === first.tournament_id &&
        record.event_id === first.event_id &&
        record.participant_global_id === first.participant_global_id &&
        record.classification === first.classification;
    if (
        !first.participant_global_id ||
        !first.event_id ||
        !["advance", "intermediate", "beginner"].includes(first.classification ?? "") ||
        !records.every((record) => matches(record) && ["Individual", "Open Age Individual"].includes(record.event)) ||
        !records.every((record) => CODES.some((code) => code === record.code)) ||
        new Set(records.map((record) => record.code)).size !== records.length
    ) {
        throw new Error("Final scores must belong to one participant, event and classification.");
    }

    // A single-field query also supports legacy randomly assigned document IDs
    // without requiring a new production composite index.
    const [existingScores, existingOverall] = await Promise.all(
        ["records", "overall_records"].map((name) =>
            getDocs(query(collection(db, name), where("tournament_id", "==", first.tournament_id))),
        ),
    );
    const key = [first.tournament_id, first.event_id, first.participant_global_id, first.classification]
        .map((value) => encodeURIComponent(value ?? ""))
        .join("_");
    const scoreRefs = CODES.map((code) => {
        const candidates = existingScores.docs.filter((snapshot) => {
            const record = snapshot.data() as TournamentRecord;
            return matches(record) && record.code === code;
        });
        if (candidates.length > 1) throw new Error(`Duplicate final scores for ${code}; resolve them before saving.`);
        return candidates[0]?.ref ?? doc(db, "records", `final_${key}_${code}`);
    });
    const overallCandidates = existingOverall.docs.filter((snapshot) => matches(snapshot.data() as TournamentRecord));
    if (overallCandidates.length > 1) throw new Error("Duplicate final Overall records; resolve them before saving.");
    const overallRef = overallCandidates[0]?.ref ?? doc(db, "overall_records", `final_${key}`);

    await runTransaction(db, async (transaction) => {
        const snapshots = await Promise.all(scoreRefs.map((ref) => transaction.get(ref)));
        const overallSnapshot = await transaction.get(overallRef);
        const now = new Date().toISOString();
        const merged = CODES.map((code, index) => {
            const stored = snapshots[index].data();
            const incoming = records.find((record) => record.code === code);
            if (!incoming) return stored ? TournamentRecordSchema.parse(stored) : undefined;
            const record = TournamentRecordSchema.parse({
                ...stored,
                ...incoming,
                id: scoreRefs[index].id,
                submitted_at: stored?.submitted_at ?? now,
                created_at: stored?.created_at ?? now,
                updated_at: now,
            });
            transaction.set(scoreRefs[index], record);
            return record;
        });
        if (!merged.every((record) => record && Number.isFinite(record.best_time) && record.best_time > 0)) return;
        const [three, six, cycle] = merged.map((record) => record?.best_time as number);
        const previous = overallSnapshot.data();
        const changed = previous?.three_three_three !== three || previous?.three_six_three !== six || previous?.cycle !== cycle;
        transaction.set(
            overallRef,
            TournamentOverallRecordSchema.parse({
                ...first,
                ...previous,
                id: overallRef.id,
                code: "Overall",
                three_three_three: three,
                three_six_three: six,
                cycle,
                overall_time: Math.round((three + six + cycle) * 1000) / 1000,
                status: changed ? "submitted" : (previous?.status ?? "submitted"),
                verified_at: changed ? null : (previous?.verified_at ?? null),
                verified_by: changed ? null : (previous?.verified_by ?? null),
                submitted_at: previous?.submitted_at ?? now,
                created_at: previous?.created_at ?? now,
                updated_at: now,
            }),
            {merge: true},
        );
    });
};
