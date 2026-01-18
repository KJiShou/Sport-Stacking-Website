import {randomUUID} from "node:crypto";
import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {Timestamp as FirestoreTimestamp, getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {defineSecret} from "firebase-functions/params";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onCall, onRequest} from "firebase-functions/v2/https";
import nodemailer from "nodemailer";
import type {Registration} from "./../../src/schema/RegistrationSchema.js";
import type {Team, TeamMember} from "./../../src/schema/TeamSchema.js";
import type {UserRegistrationRecord} from "./../../src/schema/UserSchema.js";

const corsHandler = cors({
    origin: ["https://rankingstack.com", "http://localhost:5000"],
    methods: ["GET", "POST", "OPTIONS"],
});

const RESEND_API_KEY = defineSecret("RESEND_API_KEY");
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";
const RESEND_API_URL = process.env.RESEND_API_URL ?? "https://api.resend.com/emails";

// AWS SES Secrets for backup email delivery
const AWS_SES_SMTP_USERNAME = defineSecret("AWS_SES_SMTP_USERNAME");
const AWS_SES_SMTP_PASSWORD = defineSecret("AWS_SES_SMTP_PASSWORD");
const AWS_SES_REGION = "ap-southeast-2";
const AWS_SES_FROM_EMAIL = process.env.AWS_SES_FROM_EMAIL ?? "RankingStack <noreply@rankingstack.com>";

if (!getApps().length) {
    initializeApp();
}

const db = getFirestore();

type TeamEventRefs = Partial<Pick<Team, "event_id" | "event">> & {
    event_ids?: unknown;
    events?: unknown;
};

type FirestoreEventRecord = {
    id?: string;
    type?: string;
    gender?: string;
    codes?: string[];
};

const addEventReference = (target: Set<string>, value: unknown): void => {
    if (typeof value !== "string") {
        return;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return;
    }

    target.add(trimmed);
};

const addEventReferences = (target: Set<string>, values: unknown): void => {
    if (!Array.isArray(values)) {
        return;
    }

    for (const value of values) {
        addEventReference(target, value);
    }
};

const getTeamEventIdReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const ids = new Set<string>();
    if (Array.isArray(team.event_id)) {
        addEventReferences(ids, team.event_id);
    } else {
        addEventReference(ids, team.event_id);
    }
    addEventReferences(ids, team.event_ids);

    return Array.from(ids);
};

const getTeamEventNameReferences = (team: TeamEventRefs | null | undefined): string[] => {
    if (!team) {
        return [];
    }

    const names = new Set<string>();
    if (Array.isArray(team.event)) {
        addEventReferences(names, team.event);
    } else {
        addEventReference(names, team.event);
    }
    addEventReferences(names, team.events);

    return Array.from(names);
};

const getTeamEventReferences = (team: TeamEventRefs | null | undefined): string[] => {
    const references = new Set<string>();
    for (const value of getTeamEventIdReferences(team)) {
        references.add(value);
    }
    for (const value of getTeamEventNameReferences(team)) {
        references.add(value);
    }
    return Array.from(references);
};

const getPreferredTeamEventKeys = (team: TeamEventRefs | null | undefined, fallback: string[]): string[] => {
    const ids = getTeamEventIdReferences(team);
    if (ids.length > 0) {
        return ids;
    }

    const names = getTeamEventNameReferences(team);
    if (names.length > 0) {
        return names;
    }

    return fallback;
};

const normalizeEventValue = (value: string): string => value.trim().toLowerCase();

const buildNormalizedEventSet = (values: string[]): Set<string> => {
    const normalized = new Set<string>();
    for (const value of values) {
        if (typeof value !== "string") {
            continue;
        }

        const trimmed = value.trim();
        if (trimmed.length === 0) {
            continue;
        }

        normalized.add(trimmed.toLowerCase());
    }
    return normalized;
};

const hasEventOverlap = (primary: Set<string>, secondary: Set<string>): boolean => {
    for (const value of primary) {
        if (secondary.has(value)) {
            return true;
        }
    }
    return false;
};

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case "&":
                return "&amp;";
            case "<":
                return "&lt;";
            case ">":
                return "&gt;";
            case '"':
                return "&quot;";
            case "'":
                return "&#39;";
            default:
                return character;
        }
    });

const sanitizeEventCodes = (codes: unknown): string[] =>
    Array.isArray(codes)
        ? codes.filter((code): code is string => typeof code === "string" && code.length > 0 && code !== "Overall")
        : [];

const formatEventLabel = (event: FirestoreEventRecord): string | null => {
    if (!event.type) {
        return null;
    }

    const gender = event.gender === "Male" || event.gender === "Female" ? event.gender : "Mixed";
    const codes = sanitizeEventCodes(event.codes);
    const codesLabel = codes.length > 0 ? ` (${codes.join(", ")})` : "";
    return `${event.type} - ${gender}${codesLabel}`;
};

const eventMatchesReference = (event: FirestoreEventRecord, reference: string): boolean => {
    const normalizedReference = normalizeEventValue(reference);
    if (!normalizedReference) {
        return false;
    }

    const candidates: string[] = [];
    if (event.id) {
        candidates.push(event.id);
    }
    if (event.type) {
        candidates.push(event.type);
    }
    for (const code of sanitizeEventCodes(event.codes)) {
        candidates.push(code);
        if (event.type) {
            candidates.push(`${code}-${event.type}`);
        }
    }
    const label = formatEventLabel(event);
    if (label) {
        candidates.push(label);
    }

    return candidates.some((candidate) => normalizeEventValue(candidate) === normalizedReference);
};

const resolveEventLabels = async (tournamentId: string, references: string[]): Promise<string[]> => {
    if (!tournamentId || references.length === 0) {
        return [];
    }

    const eventsSnapshot = await db.collection("events").where("tournament_id", "==", tournamentId).get();
    if (eventsSnapshot.empty) {
        return [];
    }

    const events = eventsSnapshot.docs.map((docSnap) => {
        const raw = docSnap.data() as Record<string, unknown>;
        return {
            id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : docSnap.id,
            type: typeof raw.type === "string" ? raw.type : undefined,
            gender: typeof raw.gender === "string" ? raw.gender : undefined,
            codes: Array.isArray(raw.codes) ? raw.codes.filter((code): code is string => typeof code === "string") : [],
        } satisfies FirestoreEventRecord;
    });

    const labels = new Set<string>();
    for (const reference of references) {
        const match = events.find((event) => eventMatchesReference(event, reference));
        if (match) {
            const label = formatEventLabel(match);
            if (label) {
                labels.add(label);
            }
        }
    }

    return Array.from(labels);
};

const resolveLeaderName = async (leaderId: string): Promise<string | null> => {
    if (!leaderId) {
        return null;
    }

    const leaderSnap = await db.collection("users").where("global_id", "==", leaderId).limit(1).get();
    if (leaderSnap.empty) {
        return null;
    }

    const leaderData = leaderSnap.docs[0]?.data();
    return typeof leaderData?.name === "string" ? leaderData.name : null;
};

/**
 * Send email using AWS SES SMTP as a backup when Resend fails
 */
async function sendEmailViaSES(
    to: string,
    subject: string,
    htmlBody: string,
    username: string,
    password: string,
): Promise<{success: boolean; messageId?: string; error?: string}> {
    try {
        // Create SMTP transporter for AWS SES
        const transporter = nodemailer.createTransport({
            host: `email-smtp.${AWS_SES_REGION}.amazonaws.com`,
            port: 587,
            secure: false, // Use STARTTLS
            auth: {
                user: username,
                pass: password,
            },
        });

        // Send email
        const info = await transporter.sendMail({
            from: AWS_SES_FROM_EMAIL,
            to: to,
            subject: subject,
            html: htmlBody,
        });

        return {success: true, messageId: info.messageId};
    } catch (error) {
        console.error("❌ AWS SES SMTP send failed:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown AWS SES error",
        };
    }
}

export const sendEmail = onRequest({secrets: [RESEND_API_KEY, AWS_SES_SMTP_USERNAME, AWS_SES_SMTP_PASSWORD]}, (req, res) => {
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
        const {to, tournamentId, teamId, memberId, registrationId} = req.body;
        if (!to || !tournamentId || !teamId || !memberId || !registrationId) {
            res.status(400).json({error: "Missing required fields"});
            return;
        }

        const teamSnap = await db.collection("teams").doc(teamId).get();
        const teamData = teamSnap.exists ? (teamSnap.data() as Team) : null;
        const teamEventReferences = teamData ? getTeamEventReferences(teamData) : [];
        const eventLabels = teamData ? await resolveEventLabels(tournamentId, teamEventReferences) : [];
        const eventLabel = eventLabels.length > 0 ? eventLabels.join(", ") : (teamEventReferences[0] ?? "");
        const teamName = teamData?.name ?? "";
        const leaderId = teamData?.leader_id ?? "";
        const leaderName = leaderId ? await resolveLeaderName(leaderId) : null;
        const leaderLabel = leaderName ? `${leaderName} (${leaderId})` : leaderId;

        const detailItems: string[] = [];
        if (eventLabel) {
            detailItems.push(`<li><strong>Event:</strong> ${escapeHtml(eventLabel)}</li>`);
        }
        if (teamName) {
            detailItems.push(`<li><strong>Team:</strong> ${escapeHtml(teamName)}</li>`);
        }
        if (leaderLabel) {
            detailItems.push(`<li><strong>Invited by:</strong> ${escapeHtml(leaderLabel)}</li>`);
        }

        const detailList = detailItems.length > 0 ? `<p>Verification details:</p><ul>${detailItems.join("")}</ul>` : "";

        // Step 3: 构造验证链接，包含 registrationId
        const verifyUrl = `https://rankingstack.com/verify?tournamentId=${tournamentId}&teamId=${teamId}&memberId=${memberId}&registrationId=${registrationId}`;
        const safeVerifyUrl = verifyUrl.replace(/&/g, "&amp;");

        const html = `
    <p>Hello,</p>
    <p>Please click the button below to verify your team membership for the <strong>RankingStack</strong> competition.</p>
    ${detailList}
    <p>
        <a href="${safeVerifyUrl}"
   style="padding: 10px 16px; background-color: #165DFF; color: white; text-decoration: none; border-radius: 6px; font-weight: 500;">
   🔐 Verify My Participation
</a>
    </p>
    <p>If you did not expect this email, you can safely ignore it.</p>
    <p>Thank you!</p>
`;

        // Step 4: 发送邮件 (Resend primary, AWS SES backup)
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

                // Try AWS SES as backup
                console.info("⚡ Attempting AWS SES as backup...");
                const sesResult = await sendEmailViaSES(
                    to,
                    "Please verify your competition registration",
                    html,
                    AWS_SES_SMTP_USERNAME.value(),
                    AWS_SES_SMTP_PASSWORD.value(),
                );

                if (sesResult.success) {
                    console.info("✅ Email sent successfully via AWS SES backup");
                    res.status(200).json({success: true, id: sesResult.messageId, provider: "aws-ses"});
                    return;
                }

                // Both services failed
                console.error("❌ Both Resend and AWS SES failed");
                res.status(500).json({
                    error: message,
                    backup_error: sesResult.error,
                });
                return;
            }

            res.status(200).json({success: true, id: payload?.id, provider: "resend"});
        } catch (err: unknown) {
            console.error("❌ Resend send attempt failed:", err);

            // Try AWS SES as backup
            console.info("⚡ Attempting AWS SES as backup after Resend exception...");
            try {
                const sesResult = await sendEmailViaSES(
                    to,
                    "Please verify your competition registration",
                    html,
                    AWS_SES_SMTP_USERNAME.value(),
                    AWS_SES_SMTP_PASSWORD.value(),
                );

                if (sesResult.success) {
                    console.info("✅ Email sent successfully via AWS SES backup");
                    res.status(200).json({success: true, id: sesResult.messageId, provider: "aws-ses"});
                    return;
                }

                // Both services failed
                console.error("❌ Both Resend and AWS SES failed");
                res.status(500).json({
                    error: (err as Error).message || "Send failed",
                    backup_error: sesResult.error,
                });
            } catch (sesErr: unknown) {
                console.error("❌ AWS SES backup also threw exception:", sesErr);
                res.status(500).json({
                    error: (err as Error).message || "Send failed",
                    backup_error: (sesErr as Error).message || "AWS SES backup failed",
                });
            }
        }
    });
});

export const cacheGoogleAvatarCallable = onCall(async (request) => {
    if (!request.auth?.uid) {
        throw new Error("Unauthorized");
    }

    const photoURL = request.data?.photoURL;
    if (!photoURL || typeof photoURL !== "string") {
        throw new Error("Missing photoURL");
    }

    const uid = request.auth.uid;
    const bucket = getStorage().bucket();
    const file = bucket.file(`avatars/${uid}`);

    const buildDownloadUrl = (token: string) => {
        const encodedPath = encodeURIComponent(file.name);
        return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
    };

    const ensureDownloadUrl = async () => {
        const [metadata] = await file.getMetadata();
        let token = metadata.metadata?.firebaseStorageDownloadTokens;
        if (!token) {
            token = randomUUID();
            try {
                await file.setMetadata(
                    {metadata: {firebaseStorageDownloadTokens: token}},
                    {ifMetagenerationMatch: metadata.metageneration},
                );
            } catch {
                const [retryMetadata] = await file.getMetadata();
                token = retryMetadata.metadata?.firebaseStorageDownloadTokens ?? token;
            }
        }
        return buildDownloadUrl(String(token));
    };

    const [exists] = await file.exists();
    if (exists) {
        return {url: await ensureDownloadUrl()};
    }

    const response = await fetch(photoURL);
    if (!response.ok) {
        throw new Error("Failed to fetch Google avatar");
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    const token = randomUUID();

    try {
        await file.save(buffer, {
            contentType,
            metadata: {
                firebaseStorageDownloadTokens: token,
            },
            preconditionOpts: {
                ifGenerationMatch: 0,
            },
        });
        return {url: buildDownloadUrl(token)};
    } catch (err: unknown) {
        const apiError = err as {code?: number};
        if (apiError?.code === 409 || apiError?.code === 412) {
            return {url: await ensureDownloadUrl()};
        }
        throw err;
    }
});

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

        const {tournamentId, teamId, memberId, registrationId} = req.body;

        if (!tournamentId || !teamId || !memberId || !registrationId) {
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

            // Find registration by registrationId
            const regRef = db.collection("registrations").doc(registrationId);
            const regSnap = await regRef.get();
            if (!regSnap.exists) {
                res.status(404).json({error: "Registration not found"});
                return;
            }
            const registrationData = regSnap.data() as Registration;

            await db.runTransaction(async (transaction) => {
                // 'team_recruitments' is now a top-level collection, not under tournaments
                const teamRef = db.collection("teams").doc(teamId);
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
                const teamEventReferences = getTeamEventReferences(teamData);
                const normalizedTeamEventReferences = buildNormalizedEventSet(teamEventReferences);
                const eventKeysToRegister = getPreferredTeamEventKeys(teamData, teamEventReferences);

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
                const existingEvents = Array.isArray(record.events) ? record.events : [];

                if (normalizedTeamEventReferences.size > 0) {
                    const teamsQuery = db.collection("teams").where("tournament_id", "==", tournamentId);
                    const teamsSnapshot = await transaction.get(teamsQuery);
                    let conflictingTeamName: string | null = null;

                    for (const teamDocSnap of teamsSnapshot.docs) {
                        if (teamDocSnap.id === teamId) {
                            continue;
                        }

                        const otherTeam = teamDocSnap.data() as Team;
                        const isLeader = otherTeam.leader_id === memberId;
                        const memberRecord = Array.isArray(otherTeam.members)
                            ? otherTeam.members.find((member) => member.global_id === memberId)
                            : undefined;
                        const isVerifiedMember = Boolean(memberRecord?.verified);

                        if (!isLeader && !isVerifiedMember) {
                            continue;
                        }

                        const otherTeamReferences = getTeamEventReferences(otherTeam);
                        const normalizedOtherTeamReferences = buildNormalizedEventSet(otherTeamReferences);
                        if (hasEventOverlap(normalizedTeamEventReferences, normalizedOtherTeamReferences)) {
                            conflictingTeamName = otherTeam.name ?? "another team";
                            break;
                        }
                    }

                    if (conflictingTeamName) {
                        throw new Error(`You are already participating in ${conflictingTeamName} for this event.`);
                    }
                }

                if (normalizedTeamEventReferences.size > 0) {
                    const normalizedExistingEvents = buildNormalizedEventSet(existingEvents);
                    if (hasEventOverlap(normalizedTeamEventReferences, normalizedExistingEvents)) {
                        throw new Error("You are already registered for one or more of these team events.");
                    }
                }

                const updatedEvents =
                    eventKeysToRegister.length > 0
                        ? [...new Set([...existingEvents, ...eventKeysToRegister])]
                        : [...new Set(existingEvents)];
                const newRegistrationRecords = [...registrationRecords];
                newRegistrationRecords[recordIndex] = {...record, events: updatedEvents};

                const updatedMembers = [...teamData.members];
                updatedMembers[memberIndex].verified = true;

                // Update the registration document with the new events
                const registrationEvents = Array.isArray(registrationData.events_registered)
                    ? registrationData.events_registered
                    : [];
                if (normalizedTeamEventReferences.size > 0) {
                    const normalizedRegisteredEvents = buildNormalizedEventSet(registrationEvents);
                    if (hasEventOverlap(normalizedTeamEventReferences, normalizedRegisteredEvents)) {
                        throw new Error("You are already registered for one or more of these team events.");
                    }
                }

                // Update the registration document with the new events
                await transaction.update(regRef, {
                    events_registered:
                        eventKeysToRegister.length > 0
                            ? [...new Set([...registrationEvents, ...eventKeysToRegister])]
                            : [...new Set(registrationEvents)],
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
            } else if (errorMessage.startsWith("You are already participating in")) {
                res.status(409).json({error: errorMessage});
            } else {
                res.status(500).json({error: errorMessage});
            }
        }
    });
});

/**
 * Cloud Function to update user best times when records are created/updated
 * Triggers on: records/{recordId} and overall_records/{recordId}
 */
export const updateUserBestTimes = onDocumentWritten(
    {
        document: "records/{recordId}",
        region: process.env.FUNCTIONS_REGION ?? "asia-southeast1",
        retry: false,
    },
    async (event) => {
        const afterData = event.data?.after?.data();
        if (!afterData) {
            return;
        }

        const participantGlobalId = typeof afterData.participant_global_id === "string" ? afterData.participant_global_id : null;
        if (!participantGlobalId) {
            return;
        }

        const bestTime = typeof afterData.best_time === "number" ? afterData.best_time : null;
        if (!bestTime || bestTime <= 0) {
            return;
        }

        const eventName = typeof afterData.event === "string" ? afterData.event.toLowerCase() : "";
        let eventType: "3-3-3" | "3-6-3" | "Cycle" | null = null;

        if (eventName.includes("3-3-3")) {
            eventType = "3-3-3";
        } else if (eventName.includes("3-6-3")) {
            eventType = "3-6-3";
        } else if (eventName.includes("cycle")) {
            eventType = "Cycle";
        }

        if (!eventType) {
            return;
        }

        try {
            const usersSnap = await db.collection("users").where("global_id", "==", participantGlobalId).limit(1).get();
            if (usersSnap.empty) {
                console.warn(`User not found with global_id: ${participantGlobalId}`);
                return;
            }

            const userDoc = usersSnap.docs[0];
            const userData = userDoc.data();
            const currentBestTimes = userData?.best_times || {};

            const extractTime = (entry: unknown): number | null => {
                if (entry === null || entry === undefined) return null;
                if (typeof entry === "number") return entry;
                if (typeof entry === "object" && typeof (entry as {time?: unknown}).time === "number") {
                    return (entry as {time: number}).time;
                }
                return null;
            };

            const currentBestTime = extractTime(currentBestTimes[eventType]);

            // Update if no current best or new time is better
            if (currentBestTime === null || currentBestTime === undefined || bestTime < currentBestTime) {
                const now = FirestoreTimestamp.now();
                const jsDate = new Date(now.toMillis());
                const year = jsDate.getUTCFullYear();
                const month = jsDate.getUTCMonth();
                const seasonStartYear = month >= 6 ? year : year - 1;
                const season = `${seasonStartYear}-${seasonStartYear + 1}`;

                const updatedBestTimes = {
                    ...currentBestTimes,
                    [eventType]: {time: bestTime, updated_at: now, season},
                };

                await userDoc.ref.update({
                    best_times: updatedBestTimes,
                    updated_at: now,
                });
            }
        } catch (error) {
            console.error(`Failed to update best time for user ${participantGlobalId}:`, error);
        }
    },
);

export const updateUserBestTimesFromOverall = onDocumentWritten(
    {
        document: "overall_records/{recordId}",
        region: process.env.FUNCTIONS_REGION ?? "asia-southeast1",
        retry: false,
    },
    async (event) => {
        const afterData = event.data?.after?.data();
        if (!afterData) {
            return;
        }

        const participantGlobalId = typeof afterData.participant_global_id === "string" ? afterData.participant_global_id : null;
        if (!participantGlobalId) {
            return;
        }

        const threeTime = typeof afterData.three_three_three === "number" ? afterData.three_three_three : null;
        const sixTime = typeof afterData.three_six_three === "number" ? afterData.three_six_three : null;
        const cycleTime = typeof afterData.cycle === "number" ? afterData.cycle : null;
        const overallTime = typeof afterData.overall_time === "number" ? afterData.overall_time : null;

        if (!threeTime && !sixTime && !cycleTime && !overallTime) {
            return;
        }

        try {
            const usersSnap = await db.collection("users").where("global_id", "==", participantGlobalId).limit(1).get();
            if (usersSnap.empty) {
                console.warn(`User not found with global_id: ${participantGlobalId}`);
                return;
            }

            const userDoc = usersSnap.docs[0];
            const userData = userDoc.data();
            const currentBestTimes = userData?.best_times || {};

            const extractTime = (entry: unknown): number | null => {
                if (entry === null || entry === undefined) return null;
                if (typeof entry === "number") return entry;
                if (typeof entry === "object" && typeof (entry as {time?: unknown}).time === "number") {
                    return (entry as {time: number}).time;
                }
                return null;
            };

            const now = FirestoreTimestamp.now();
            const jsDate = new Date(now.toMillis());
            const year = jsDate.getUTCFullYear();
            const month = jsDate.getUTCMonth();
            const seasonStartYear = month >= 6 ? year : year - 1;
            const season = `${seasonStartYear}-${seasonStartYear + 1}`;

            const updatePayload: Record<string, unknown> = {};

            if (threeTime && threeTime > 0) {
                const current = extractTime(currentBestTimes["3-3-3"]);
                if (current === null || current === undefined || threeTime < current) {
                    updatePayload["best_times.3-3-3"] = {time: threeTime, updated_at: now, season};
                }
            }
            if (sixTime && sixTime > 0) {
                const current = extractTime(currentBestTimes["3-6-3"]);
                if (current === null || current === undefined || sixTime < current) {
                    updatePayload["best_times.3-6-3"] = {time: sixTime, updated_at: now, season};
                }
            }
            if (cycleTime && cycleTime > 0) {
                const current = extractTime(currentBestTimes.Cycle);
                if (current === null || current === undefined || cycleTime < current) {
                    updatePayload["best_times.Cycle"] = {time: cycleTime, updated_at: now, season};
                }
            }
            // Overall best time is no longer tracked in best_times

            if (Object.keys(updatePayload).length > 0) {
                await userDoc.ref.update({
                    ...updatePayload,
                    updated_at: now,
                });
            }
        } catch (error) {
            console.error(`Failed to update best times for user ${participantGlobalId}:`, error);
        }
    },
);
