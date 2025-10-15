import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
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

            const payload = await resendResponse.json().catch(() => undefined);

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
                const userHasConflict = teamEvents.some((event: string) =>
                    registrationData.events_registered.includes(event),
                );

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
