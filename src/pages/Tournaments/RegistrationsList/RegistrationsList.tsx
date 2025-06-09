import {useAuthContext} from "@/context/AuthContext";
import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

export default function RegistrationsPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    // const refreshRegistrations = async () => {
    //     if (!tournamentId) return;

    //     setLoading(true);
    //     try {
    //         console.log("Hello World");
    //     } catch (error) {
    //         console.error("Failed to refresh registrations:", error);
    //     } finally {
    //         setLoading(false);
    //     }
    // };

    useEffect(() => {
        if (!tournamentId) return;
        setLoading(true);
    }, [tournamentId]);

    return <div>Hello</div>;
}
