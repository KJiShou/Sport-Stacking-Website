import {getAuth} from "firebase/auth";

export async function sendProtectedEmail(gmail: string, tournamentId: string, teamId: string, memberId: string) {
    const auth = getAuth();
    const token = await auth.currentUser?.getIdToken();

    const res = await fetch("https://sendemail-jzbhzqtcdq-uc.a.run.app", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`, // Firebase Auth token
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            to: gmail, // 收件人邮箱
            tournamentId: tournamentId,
            teamId: teamId,
            memberId: memberId,
        }),
    });

    if (!res.ok) {
        const errorText = await res.text(); // 👈 防止非 JSON 错误
        throw new Error(`Request failed: ${res.status} - ${errorText}`);
    }

    const data = await res.json();
}
