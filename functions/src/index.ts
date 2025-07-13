import sgMail from "@sendgrid/mail";
import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";
import type {Team} from "./../../src/schema/TeamSchema.js";
import type {UserRegistrationRecord} from "./../../src/schema/UserSchema.js";
const corsHandler = cors({origin: true});

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

if (!getApps().length) {
    initializeApp();
}

export const sendEmail = onRequest({secrets: [SENDGRID_API_KEY]}, (req, res) => {
    corsHandler(req, res, async () => {
        const apiKey = SENDGRID_API_KEY.value(); // ✅ 正确：只有函数运行时才执行
        sgMail.setApiKey(apiKey);
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
            await sgMail.send({
                to,
                from: "noreply@rankingstack.com",
                subject: "Please verify your competition registration",
                html,
            });
            res.status(200).json({success: true});
        } catch (err: unknown) {
            console.error("❌ SendGrid error:", err);
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
            const teamRef = db.collection("tournaments").doc(tournamentId).collection("teams").doc(teamId);
            const teamSnap = await teamRef.get();

            if (!teamSnap.exists) {
                res.status(404).json({error: "Team not found"});
                return;
            }

            const teamData = teamSnap.data() as Team;
            const memberIndex = teamData.members.findIndex((m) => m.global_id === memberId);

            if (memberIndex === -1) {
                res.status(400).json({error: "You are not a member of this team."});
                return;
            }

            // Update user's personal registration record first
            const usersRef = db.collection("users");
            const userQuery = usersRef.where("global_id", "==", memberId);
            const userSnap = await userQuery.get();

            if (userSnap.empty) {
                res.status(404).json({error: "User not found"});
                return;
            }

            const userDoc = userSnap.docs[0];
            const userData = userDoc.data();
            const registrationRecords: UserRegistrationRecord[] = userData.registration_records ?? [];
            const recordIndex = registrationRecords.findIndex((record) => record.tournament_id === tournamentId);

            if (recordIndex === -1) {
                res.status(400).json({error: "You are not registered for this tournament."});
                return;
            }

            const record = registrationRecords[recordIndex];
            const existingEvents = record.events;
            const hasConflict = teamData.events.some((event) => existingEvents.includes(event));

            if (hasConflict) {
                res.status(409).json({error: "You are already registered for one or more of these team events."});
                return;
            }

            const updatedEvents = [...new Set([...existingEvents, ...teamData.events])];
            registrationRecords[recordIndex] = {...record, events: updatedEvents};
            await userDoc.ref.update({registration_records: registrationRecords});

            // Now, update the team document
            const updatedMembers = [...teamData.members];
            updatedMembers[memberIndex].verified = true;
            await teamRef.update({members: updatedMembers});

            res.status(200).json({success: true});
        } catch (err: unknown) {
            console.error("Error updating verification:", err);
            res.status(500).json({error: err});
        }
    });
});
