import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {Timestamp as FirestoreTimestamp, getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onDocumentWritten} from "firebase-functions/v2/firestore";
import {onRequest} from "firebase-functions/v2/https";
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
        const {to, tournamentId, teamId, memberId, registrationId} = req.body;
        if (!to || !tournamentId || !teamId || !memberId || !registrationId) {
            res.status(400).json({error: "Missing required fields"});
            return;
        }

        // Step 3: 构造验证链接，包含 registrationId
        const verifyUrl = `https://rankingstack.com/verify?tournamentId=${tournamentId}&teamId=${teamId}&memberId=${memberId}&registrationId=${registrationId}`;
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
                const teamEvents = Array.isArray(teamData.event) ? teamData.event : [];
                const hasConflict = teamEvents.some((event: string) => existingEvents.includes(event));

                if (hasConflict) {
                    throw new Error("You are already registered for one or more of these team events.");
                }

                const updatedEvents = [...new Set([...existingEvents, ...teamEvents])];
                const newRegistrationRecords = [...registrationRecords];
                newRegistrationRecords[recordIndex] = {...record, events: updatedEvents};

                const updatedMembers = [...teamData.members];
                updatedMembers[memberIndex].verified = true;

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
