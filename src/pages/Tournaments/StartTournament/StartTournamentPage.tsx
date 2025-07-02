import type {Registration, Tournament} from "@/schema";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {
    exportParticipantListToPDF,
    getCurrentEventData,
    exportAllBracketsListToPDF,
    exportMasterListToPDF,
} from "@/utils/PDF/pdfExport";
import {Button, Dropdown, Input, Menu, Message, Table, Tabs, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {nanoid} from "nanoid";
// src/pages/ParticipantListPage.tsx
import React, {useState, useRef} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";
import {IconUndo} from "@arco-design/web-react/icon";

export default function StartTournamentPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registrationList, setRegistrationList] = useState<Registration[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const mountedRef = useRef(false);

    const refreshParticipantList = async () => {
        if (!tournamentId) return;
        setLoading(true);
        try {
            const t = await fetchTournamentById(tournamentId);
            setTournament(t);
            const regs = await fetchRegistrations(tournamentId);
            setRegistrationList(regs.filter((r) => r.registration_status === "approved"));
        } catch {
            Message.error("Unable to fetch participants");
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;
        refreshParticipantList();
    });

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                Hello
            </div>
        </div>
    );
}
