import {useAuthContext} from "@/context/AuthContext";
import type {Profile} from "@/schema";
import {claimProfile, fetchProfileById} from "@/services/firebase/profileService";
import {Button, Message, Result, Spin} from "@arco-design/web-react";
import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

export default function ClaimProfilePage() {
    const {profileId} = useParams<{profileId: string}>();
    const {firebaseUser} = useAuthContext();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [profile, setProfile] = useState<Profile | null>(null);

    useEffect(() => {
        const loadProfile = async () => {
            if (!profileId) {
                setLoading(false);
                return;
            }
            try {
                const data = await fetchProfileById(profileId);
                setProfile(data);
            } catch (error) {
                console.error("Failed to load profile:", error);
            } finally {
                setLoading(false);
            }
        };
        loadProfile();
    }, [profileId]);

    const handleClaim = async () => {
        if (!firebaseUser || !profile?.id) {
            Message.error("Please log in first.");
            return;
        }
        try {
            await claimProfile(profile.id, firebaseUser.uid, firebaseUser.email ?? null);
            Message.success("Profile claimed");
            navigate("/tournaments");
        } catch (error) {
            console.error("Failed to claim profile:", error);
            Message.error("Failed to claim profile");
        }
    };

    if (loading) {
        return <Spin loading className="w-full" />;
    }

    if (!profile) {
        return <Result status="404" title="Profile not found" subTitle="The profile link is invalid or expired." />;
    }

    if (profile.owner_uid) {
        return (
            <Result
                status="warning"
                title="Profile already claimed"
                subTitle="This profile has already been claimed."
                extra={<Button onClick={() => navigate("/tournaments")}>Back to tournaments</Button>}
            />
        );
    }

    return (
        <Result
            status="info"
            title={`Claim profile for ${profile.name}`}
            subTitle="Log in with the Gmail you want to associate with this profile."
            extra={
                firebaseUser ? (
                    <Button type="primary" onClick={handleClaim}>
                        Claim Profile
                    </Button>
                ) : (
                    <Button type="primary" onClick={() => navigate("/register")}>
                        Log In / Register
                    </Button>
                )
            }
        />
    );
}
