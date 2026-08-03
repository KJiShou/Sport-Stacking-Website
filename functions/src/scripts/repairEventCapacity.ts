import {getApps, initializeApp} from "firebase-admin/app";
import {Timestamp, getFirestore} from "firebase-admin/firestore";
import {writeScriptAudit} from "../observability.js";

type EventData = {
    id?: string;
    type?: string;
    max_participants?: number | null;
};
type RegistrationData = {
    registration_status?: string;
    events_registered?: string[];
    created_at?: Timestamp;
    user_name?: string;
};

const args = process.argv.slice(2);
const getArg = (name: string): string => {
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? "").trim() : "";
};
const tournamentId = getArg("--tournament");
const apply = args.includes("--apply");

if (!tournamentId) {
    throw new Error("Usage: yarn workspace functions repair:event-capacity --tournament <id> [--apply]");
}

if (!getApps().length) initializeApp();
const app = getApps()[0] ?? initializeApp();
const db = getFirestore(app);

const normalize = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[\\s_-]+/g, "");
const matchesEvent = (registration: RegistrationData, eventId: string, event: EventData): boolean => {
    const candidates = new Set([eventId, event.id ?? "", event.type ?? ""].map(normalize));
    return (registration.events_registered ?? []).some((selection) => candidates.has(normalize(selection)));
};
const createdAtMillis = (registration: RegistrationData): number =>
    registration.created_at?.toMillis() ?? Number.MAX_SAFE_INTEGER;

const main = async (): Promise<void> => {
    const [tournamentSnapshot, eventSnapshot, registrationSnapshot] = await Promise.all([
        db.collection("tournaments").doc(tournamentId).get(),
        db.collection("events").where("tournament_id", "==", tournamentId).get(),
        db.collection("registrations").where("tournament_id", "==", tournamentId).get(),
    ]);
    if (!tournamentSnapshot.exists) throw new Error("Tournament not found");

    const limitedEvents = eventSnapshot.docs
        .map((snapshot) => ({id: snapshot.id, ref: snapshot.ref, data: snapshot.data() as EventData}))
        .filter(({data}) => typeof data.max_participants === "number" && data.max_participants > 0);
    const approved = registrationSnapshot.docs
        .filter((snapshot) => (snapshot.data() as RegistrationData).registration_status === "approved")
        .sort(
            (left, right) => createdAtMillis(left.data() as RegistrationData) - createdAtMillis(right.data() as RegistrationData),
        );

    const demoted = new Map<string, Set<string>>();
    for (const event of limitedEvents) {
        const maxParticipants = event.data.max_participants;
        if (typeof maxParticipants !== "number" || maxParticipants <= 0) continue;
        const approvedForEvent = approved.filter((registration) =>
            matchesEvent(registration.data() as RegistrationData, event.id, event.data),
        );
        for (const registration of approvedForEvent.slice(maxParticipants)) {
            const labels = demoted.get(registration.id) ?? new Set<string>();
            labels.add(event.data.type ?? event.id);
            demoted.set(registration.id, labels);
        }
    }

    const remainingApproved = approved.filter((registration) => !demoted.has(registration.id));
    const eventCounts = limitedEvents.map((event) => ({
        ...event,
        approvedParticipants: remainingApproved.filter((registration) =>
            matchesEvent(registration.data() as RegistrationData, event.id, event.data),
        ).length,
    }));
    const report = {
        tournamentId,
        mode: apply ? "apply" : "dry-run",
        approvedBefore: approved.length,
        approvedAfter: remainingApproved.length,
        demotions: Array.from(demoted, ([registrationId, events]) => {
            const registration = registrationSnapshot.docs.find((item) => item.id === registrationId)?.data() as RegistrationData;
            return {registrationId, name: registration.user_name ?? "", events: Array.from(events)};
        }),
        eventCounts: eventCounts.map((event) => ({
            eventId: event.id,
            event: event.data.type ?? event.id,
            approvedParticipants: event.approvedParticipants,
        })),
    };
    console.info(JSON.stringify(report, null, 2));
    if (!apply) return;

    const writes = [
        ...Array.from(demoted.keys()).map((registrationId) => ({kind: "registration" as const, registrationId})),
        ...eventCounts.map((event) => ({kind: "event" as const, event})),
        {kind: "tournament" as const},
    ];
    for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = db.batch();
        for (const write of writes.slice(offset, offset + 400)) {
            if (write.kind === "registration") {
                batch.update(db.collection("registrations").doc(write.registrationId), {
                    registration_status: "pending",
                    updated_at: Timestamp.now(),
                });
            } else if (write.kind === "event") {
                batch.update(write.event.ref, {
                    approved_participants: write.event.approvedParticipants,
                    updated_at: Timestamp.now(),
                });
            } else {
                batch.update(tournamentSnapshot.ref, {participants: remainingApproved.length, updated_at: Timestamp.now()});
            }
        }
        await batch.commit();
    }
    await writeScriptAudit(db, {
        action: "repair.event-capacity.apply",
        status: "success",
        entityType: "tournament",
        entityId: tournamentId,
        tournamentId,
        changedFields: ["registration_status", "approved_participants", "participants"],
        after: {
            demotions: demoted.size,
            approvedRegistrations: remainingApproved.length,
            eventsUpdated: eventCounts.length,
        },
    });
};

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
