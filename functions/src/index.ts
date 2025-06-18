import sgMail from "@sendgrid/mail";
import cors from "cors";
import {getApps, initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {getFirestore} from "firebase-admin/firestore";
import {defineSecret} from "firebase-functions/params";
import {onRequest} from "firebase-functions/v2/https";
import type {Registration} from "./../../src/schema/RegistrationSchema.js";
const corsHandler = cors({origin: true});

const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");

type Team = NonNullable<NonNullable<Registration["teams"]>[number]>;
type TeamMember = Team["member"][number];

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
        const {to, tournamentId, registrationId, globalId} = req.body;
        if (!to || !tournamentId || !registrationId || !globalId) {
            res.status(400).json({error: "Missing required fields"});
            return;
        }

        // Step 3: 构造验证链接
        const verifyUrl = `https://rankingstack.com/verify?tournamentId=${tournamentId}&registrationId=${registrationId}&globalId=${globalId}`;
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

        const {tournamentId, registrationId, memberGlobalId} = req.body;

        if (!tournamentId || !registrationId || !memberGlobalId) {
            res.status(400).json({error: "Missing fields"});
            return;
        }

        try {
            const regRef = db.collection("tournaments").doc(tournamentId).collection("registrations").doc(registrationId);
            const regSnap = await regRef.get();

            if (!regSnap.exists) {
                res.status(404).json({error: "Registration not found"});
                return;
            }

            const data = regSnap.data();
            const teams = data?.teams ?? [];

            const updatedTeams = teams.map((team: Team) => {
                // 更新 leader
                const updatedLeader = team.leader?.global_id === memberGlobalId ? {...team.leader, verified: true} : team.leader;

                // 更新 members
                const updatedMembers = (team.member ?? []).map((m: TeamMember) =>
                    m.global_id === memberGlobalId ? {...m, verified: true} : m,
                );

                return {
                    ...team,
                    leader: updatedLeader,
                    member: updatedMembers,
                };
            });

            await regRef.update({teams: updatedTeams});
            res.status(200).json({success: true});
        } catch (err: unknown) {
            console.error("Error updating verification:", err);
            res.status(500).json({error: err});
        }
    });
});
