import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {
    type DocumentData,
    type Firestore,
    Timestamp as FirestoreTimestamp,
    type QueryDocumentSnapshot,
    type QuerySnapshot,
    type WhereFilterOp,
    getFirestore,
} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onRequest} from "firebase-functions/v2/https";
import type {TournamentRecord, TournamentTeamRecord} from "./../../src/schema/RecordSchema.js";
import type {Registration} from "./../../src/schema/RegistrationSchema.js";
import type {Team, TeamMember} from "./../../src/schema/TeamSchema.js";
import type {UserRegistrationRecord} from "./../../src/schema/UserSchema.js";
const corsHandler = cors({origin: true});

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";
const RESEND_API_URL = process.env.RESEND_API_URL ?? "https://api.resend.com/emails";

if (!getApps().length) {
    initializeApp();
}

export const sendEmail = onRequest({secrets: [RESEND_API_KEY]}, (req, res) => {
    corsHandler(req, res, async () => {
        const apiKey = RESEND_API_KEY.value();
        const auth = getAuth();

        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            res.status(401).json({error: "Missing or invalid Authorization header"});
            return;
        }

        const idToken = authHeader.split("Bearer ")[1];

        try {
            await auth.verifyIdToken(idToken);
        } catch (err) {
            console.error("❌ Token verification failed", err);
            res.status(401).json({error: "Unauthorized"});
            return;
        }

        // Step 2: 校验必要参数
        const {to, tournamentId, teamId, memberId} = req.body;
        if (!to || !tournamentId || !teamId || !memberId) {
            res.status(400).json({error: "Missing required fields"});
            return;
        }

        // Step 3: 构造验证链接
        const verifyUrl = `https://rankingstack.com/verify?tournamentId=${tournamentId}&teamId=${teamId}&memberId=${memberId}`;
        const safeVerifyUrl = verifyUrl.replace(/&/g, "&amp;");

        const html = `
    <p>Hello,</p>
    <p>Please click the button below to verify your team membership for the <strong>RankingStack</strong> competition:</p>
    <p>
        <a href="${safeVerifyUrl}"
   style="padding: 10px 16px; background-color: #165DFF; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
   🔐 Verify My Participation
</a>
    </p>
    <p>If you did not expect this email, you can safely ignore it.</p>
    <p>Thank you!</p>
`;

        // Step 4: 发送邮件
        try {
            const resendResponse = await fetch(RESEND_API_URL, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    from: RESEND_FROM_EMAIL,
                    to: [to],
                    subject: "Please verify your competition registration",
                    html,
                }),
            });

            const payload = await resendResponse.json().catch((err) => {
                console.error("❌ Failed to parse Resend response JSON:", err);
                return undefined;
            });

            if (!resendResponse.ok) {
                const message = typeof payload === "object" && payload?.error ? payload.error : "Send failed";
                console.error("❌ Resend error:", payload || resendResponse.statusText);
                res.status(500).json({error: message});
                return;
            }

            res.status(200).json({success: true, id: payload?.id});
        } catch (err: unknown) {
            console.error("❌ Resend send attempt failed:", err);
            res.status(500).json({error: (err as Error).message || "Send failed"});
        }
    });
});

const db = getFirestore();

type RecordLike = Partial<TournamentRecord & TournamentTeamRecord> & Record<string, unknown>;

interface RecordQuerySpec {
    field: string;
    operator: WhereFilterOp;
    value: unknown;
}

interface RecordQueryResult {
    snapshot: QuerySnapshot | null;
    skipped: boolean;
}

function isFailedPreconditionError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }
    const code = (error as {code?: unknown}).code;
    if (typeof code === "string") {
        const normalized = code.toLowerCase().replace(/_/g, "-");
        return normalized === "failed-precondition";
    }
    if (typeof code === "number") {
        return code === 9;
    }
    return false;
}

async function runRecordQuery(dbInstance: Firestore, spec: RecordQuerySpec): Promise<RecordQueryResult> {
    try {
        const snapshot = await dbInstance.collectionGroup("records").where(spec.field, spec.operator, spec.value).get();
        return {snapshot, skipped: false};
    } catch (error) {
        if (isFailedPreconditionError(error)) {
            console.warn(
                `⚠️ Skipping user history query for field ${spec.field} due to missing index or unavailable data.`,
                error,
            );
            return {snapshot: null, skipped: true};
        }
        throw error;
    }
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return null;
}

function toTimestamp(value: unknown): FirestoreTimestamp | null {
    if (!value) {
        return null;
    }
    if (value instanceof FirestoreTimestamp) {
        return value;
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) {
        return FirestoreTimestamp.fromDate(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const date = new Date(value);
        if (Number.isFinite(date.getTime())) {
            return FirestoreTimestamp.fromDate(date);
        }
    }
    if (typeof value === "object" && value !== null) {
        // Firestore Timestamp objects from client SDK expose toDate
        const maybeTimestamp = value as {toDate?: () => Date};
        if (typeof maybeTimestamp.toDate === "function") {
            const date = maybeTimestamp.toDate();
            if (date instanceof Date && Number.isFinite(date.getTime())) {
                return FirestoreTimestamp.fromDate(date);
            }
        }
    }
    return null;
}

function extractParticipantGlobalIds(data: RecordLike): string[] {
    const ids = new Set<string>();
    const leaderId = typeof data.leaderId === "string" ? data.leaderId.trim() : "";
    const memberIds = Array.isArray(data.memberIds)
        ? (data.memberIds as unknown[]).map((id) => (typeof id === "string" ? id.trim() : "")).filter((id) => id.length > 0)
        : [];
    const hasTeamShape = leaderId.length > 0 || memberIds.length > 0;

    if (!hasTeamShape) {
        const participantId = typeof data.participantId === "string" ? data.participantId.trim() : "";
        if (participantId.length > 0) {
            ids.add(participantId);
        }
    }

    if (leaderId.length > 0) {
        ids.add(leaderId);
    }
    for (const id of memberIds) {
        ids.add(id);
    }

    return Array.from(ids);
}

interface CachedTournamentResult {
    recordPath: string;
    event: string | null;
    eventKey: string | null;
    eventCategory: string | null;
    round: string | null;
    bestTime: number | null;
    try1: number | null;
    try2: number | null;
    try3: number | null;
    status: string | null;
    classification: string | null;
    resultType: "individual" | "team";
    participantRole: "participant" | "leader" | "member";
    teamContext: {
        leaderId: string | null;
        memberIds: string[];
    } | null;
    submittedAt: FirestoreTimestamp | null;
    verifiedAt: FirestoreTimestamp | null;
    createdAt: FirestoreTimestamp | null;
    updatedAt: FirestoreTimestamp | null;
    videoUrl: string | null;
}

interface CachedTournamentSummary {
    tournamentId: string;
    tournamentName: string | null;
    startDate: FirestoreTimestamp | null;
    endDate: FirestoreTimestamp | null;
    country: string | null;
    venue: string | null;
    lastActivityAt: FirestoreTimestamp | null;
    results: CachedTournamentResult[];
}

async function rebuildUserTournamentHistory(globalIdRaw: string): Promise<void> {
    const globalId = globalIdRaw.trim();
    if (!globalId) {
        return;
    }

    const userSnap = await db.collection("users").where("global_id", "==", globalId).limit(1).get();
    if (userSnap.empty) {
        console.warn(`⚠️ No user found for global_id ${globalId}, skipping cache rebuild.`);
        return;
    }

    const userDoc = userSnap.docs[0];
    const querySpecs: RecordQuerySpec[] = [
        {field: "participantId", operator: "==", value: globalId},
        {field: "leaderId", operator: "==", value: globalId},
        {field: "memberIds", operator: "array-contains", value: globalId},
    ];

    const queryResults = await Promise.all(querySpecs.map((spec) => runRecordQuery(db, spec)));
    const hadQueryFailure = queryResults.some((result) => result.skipped);

    const recordDocs = new Map<string, QueryDocumentSnapshot<DocumentData>>();
    for (const {snapshot} of queryResults) {
        if (!snapshot) {
            continue;
        }
        for (const docSnap of snapshot.docs) {
            recordDocs.set(docSnap.ref.path, docSnap);
        }
    }

    if (hadQueryFailure && recordDocs.size === 0) {
        console.warn(
            `⚠️ Skipping user history rebuild for ${globalId} because at least one index query failed and no records were found.`,
        );
        return;
    }

    const tournaments = new Map<string, CachedTournamentSummary>();

    for (const docSnap of recordDocs.values()) {
        const data = docSnap.data() as RecordLike;
        const recordsCollection = docSnap.ref.parent;
        const eventDoc = recordsCollection.parent;
        const categoryCollection = eventDoc?.parent;
        const roundDoc = categoryCollection?.parent;
        const eventsCollection = roundDoc?.parent;
        const tournamentDoc = eventsCollection?.parent;

        if (!tournamentDoc) {
            continue;
        }

        const tournamentId = tournamentDoc.id;
        const round = roundDoc?.id ?? null;
        const eventCategory = categoryCollection?.id ?? null;
        const eventKey = eventDoc?.id ?? null;
        const eventName = typeof data.event === "string" ? data.event : eventKey;

        const classification = typeof data.classification === "string" ? data.classification : null;
        const status = typeof data.status === "string" ? data.status : null;
        const leaderId = typeof data.leaderId === "string" ? data.leaderId : null;
        const memberIds = Array.isArray(data.memberIds)
            ? (data.memberIds as unknown[])
                  .map((id) => (typeof id === "string" ? id : null))
                  .filter((id): id is string => id != null)
            : [];
        const isTeam = leaderId != null || memberIds.length > 0;
        const participantRole: CachedTournamentResult["participantRole"] = !isTeam
            ? "participant"
            : leaderId === globalId
              ? "leader"
              : memberIds.includes(globalId)
                ? "member"
                : "participant";

        const result: CachedTournamentResult = {
            recordPath: docSnap.ref.path,
            event: eventName ?? null,
            eventKey,
            eventCategory,
            round,
            bestTime: toNumber(data.bestTime),
            try1: toNumber(data.try1),
            try2: toNumber(data.try2),
            try3: toNumber(data.try3),
            status,
            classification,
            resultType: isTeam ? "team" : "individual",
            participantRole,
            teamContext: isTeam
                ? {
                      leaderId,
                      memberIds,
                  }
                : null,
            submittedAt: toTimestamp(data.submitted_at),
            verifiedAt: toTimestamp(data.verified_at),
            createdAt: toTimestamp(data.created_at),
            updatedAt: toTimestamp(data.updated_at),
            videoUrl: typeof data.videoUrl === "string" ? data.videoUrl : null,
        };

        const current = tournaments.get(tournamentId);
        if (!current) {
            tournaments.set(tournamentId, {
                tournamentId,
                tournamentName: null,
                startDate: null,
                endDate: null,
                country: null,
                venue: null,
                lastActivityAt: result.updatedAt ?? result.createdAt,
                results: [result],
            });
        } else {
            current.results.push(result);
            const candidateTimestamp = result.updatedAt ?? result.createdAt;
            if (candidateTimestamp && current.lastActivityAt) {
                if (candidateTimestamp.toMillis() > current.lastActivityAt.toMillis()) {
                    current.lastActivityAt = candidateTimestamp;
                }
            } else if (candidateTimestamp) {
                current.lastActivityAt = candidateTimestamp;
            }
        }
    }

    if (tournaments.size === 0) {
        await db.collection("user_tournament_history").doc(globalId).set(
            {
                globalId,
                userId: userDoc.id,
                updatedAt: FirestoreTimestamp.now(),
                tournamentCount: 0,
                recordCount: 0,
                tournaments: [],
            },
            {merge: false},
        );
        return;
    }

    const tournamentDocRefs = Array.from(tournaments.keys()).map((id) => db.collection("tournaments").doc(id));
    const tournamentDocs = await Promise.allSettled(tournamentDocRefs.map((ref) => ref.get()));

    tournamentDocs.forEach((result, index) => {
        if (result.status !== "fulfilled") {
            console.error("❌ Failed to load tournament metadata:", result.reason);
            return;
        }
        const docSnap = result.value;
        if (!docSnap.exists) {
            return;
        }
        const entry = tournaments.get(tournamentDocRefs[index].id);
        if (!entry) {
            return;
        }
        const data = docSnap.data() ?? {};
        entry.tournamentName = typeof data.name === "string" ? data.name : null;
        entry.startDate = toTimestamp(data.start_date);
        entry.endDate = toTimestamp(data.end_date);
        entry.country = typeof data.country === "string" ? data.country : null;
        entry.venue = typeof data.venue === "string" ? data.venue : null;
    });

    const sortedSummaries = Array.from(tournaments.values()).map((summary) => {
        summary.results.sort((a, b) => {
            const aMillis = (a.updatedAt ?? a.createdAt)?.toMillis() ?? 0;
            const bMillis = (b.updatedAt ?? b.createdAt)?.toMillis() ?? 0;
            if (aMillis !== bMillis) {
                return bMillis - aMillis;
            }
            return (a.event ?? "").localeCompare(b.event ?? "");
        });
        return summary;
    });

    sortedSummaries.sort((a, b) => {
        const aMillis = a.lastActivityAt?.toMillis() ?? a.endDate?.toMillis() ?? 0;
        const bMillis = b.lastActivityAt?.toMillis() ?? b.endDate?.toMillis() ?? 0;
        return bMillis - aMillis;
    });

    const recordCount = sortedSummaries.reduce((total, summary) => total + summary.results.length, 0);

    await db.collection("user_tournament_history").doc(globalId).set(
        {
            globalId,
            userId: userDoc.id,
            updatedAt: FirestoreTimestamp.now(),
            tournamentCount: sortedSummaries.length,
            recordCount,
            tournaments: sortedSummaries,
        },
        {merge: false},
    );
}

export const updateVerification = onRequest(async (req, res) => {
    corsHandler(req, res, async () => {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
            res.status(401).json({error: "Missing or invalid auth header"});
            return;
        }

        const idToken = authHeader.split("Bearer ")[1];

        try {
            const decoded = await getAuth().verifyIdToken(idToken);
            if (!decoded.uid) {
                res.status(401).json({error: "Invalid token"});
                return;
            }
        } catch (err) {
            console.error("❌ Token verification failed", err);
            res.status(401).json({error: "Invalid token"});
            return;
        }

        const {tournamentId, teamId, memberId} = req.body;

        if (!tournamentId || !teamId || !memberId) {
            res.status(400).json({error: "Missing fields"});
            return;
        }

        try {
            const usersRef = db.collection("users");
            const userQuery = usersRef.where("global_id", "==", memberId);
            const userSnap = await userQuery.get();

            if (userSnap.empty) {
                res.status(404).json({error: "User not found"});
                return;
            }
            const userDocRef = userSnap.docs[0].ref;

            await db.runTransaction(async (transaction) => {
                const teamRef = db.collection("tournaments").doc(tournamentId).collection("teams").doc(teamId);
                const teamDoc = await transaction.get(teamRef);
                const userDoc = await transaction.get(userDocRef);

                if (!teamDoc.exists) {
                    throw new Error("Team not found");
                }
                if (!userDoc.exists) {
                    throw new Error("User not found");
                }

                const teamData = teamDoc.data() as Team;
                const memberIndex = teamData.members.findIndex((m: TeamMember) => m.global_id === memberId);

                if (memberIndex === -1) {
                    throw new Error("You are not a member of this team.");
                }

                if (teamData.members[memberIndex].verified) {
                    // Member is already verified, so we can just return success.
                    return;
                }

                const userData = userDoc.data();
                const registrationRecords: UserRegistrationRecord[] = userData?.registration_records ?? [];
                const recordIndex = registrationRecords.findIndex((record) => record.tournament_id === tournamentId);

                if (recordIndex === -1) {
                    throw new Error("You are not registered for this tournament.");
                }

                const record = registrationRecords[recordIndex];
                const existingEvents = record.events;
                const teamEvents = Array.isArray(teamData.events) ? teamData.events : [];
                const hasConflict = teamEvents.some((event: string) => existingEvents.includes(event));

                if (hasConflict) {
                    throw new Error("You are already registered for one or more of these team events.");
                }

                const updatedEvents = [...new Set([...existingEvents, ...teamEvents])];
                const newRegistrationRecords = [...registrationRecords];
                newRegistrationRecords[recordIndex] = {...record, events: updatedEvents};

                const updatedMembers = [...teamData.members];
                updatedMembers[memberIndex].verified = true;

                const regRef = db.collection("tournaments").doc(tournamentId).collection("registrations").doc(userDoc.id);
                const regSnap = await transaction.get(regRef);
                if (!regSnap.exists) {
                    throw new Error("Registration not found");
                }
                const registrationData = regSnap.data() as Registration;

                // Update the registration document with the new events
                const userHasConflict = teamEvents.some((event: string) => registrationData.events_registered.includes(event));

                if (userHasConflict) {
                    throw new Error("You are already registered for one or more of these team events.");
                }

                // Update the registration document with the new events
                await transaction.update(regRef, {
                    events_registered: [...new Set([...registrationData.events_registered, ...teamEvents])],
                    updated_at: new Date(),
                });

                transaction.update(userDocRef, {registration_records: newRegistrationRecords});
                transaction.update(teamRef, {members: updatedMembers});
            });

            res.status(200).json({success: true});
        } catch (err: unknown) {
            console.error("Error updating verification:", err);
            const errorMessage = (err as Error).message;
            if (errorMessage === "Team not found") {
                res.status(404).json({error: errorMessage});
            } else if (errorMessage === "User not found") {
                res.status(404).json({error: errorMessage});
            } else if (errorMessage === "You are not a member of this team.") {
                res.status(400).json({error: errorMessage});
            } else if (errorMessage === "You are not registered for this tournament.") {
                res.status(400).json({error: errorMessage});
            } else if (errorMessage === "You are already registered for one or more of these team events.") {
                res.status(409).json({error: errorMessage});
            } else {
                res.status(500).json({error: "An unexpected error occurred during verification."});
            }
        }
    });
});

export const syncUserTournamentHistory = onDocumentWritten(
    {
        document: "tournaments/{tournamentId}/events/{round}/{eventCategory}/{eventName}/records/{recordId}",
        region: process.env.FUNCTIONS_REGION ?? "asia-southeast1",
        retry: false,
    },
    async (event) => {
        const affectedIds = new Set<string>();

        const beforeData = event.data?.before?.data() as RecordLike | undefined;
        const afterData = event.data?.after?.data() as RecordLike | undefined;

        if (beforeData) {
            for (const id of extractParticipantGlobalIds(beforeData)) {
                affectedIds.add(id);
            }
        }
        if (afterData) {
            for (const id of extractParticipantGlobalIds(afterData)) {
                affectedIds.add(id);
            }
        }

        if (affectedIds.size === 0) {
            return;
        }

        await Promise.all(
            Array.from(affectedIds).map(async (globalId) => {
                try {
                    await rebuildUserTournamentHistory(globalId);
                } catch (error) {
                    console.error(`❌ Failed to rebuild history for ${globalId}:`, error);
                }
            }),
        );
    },
);
