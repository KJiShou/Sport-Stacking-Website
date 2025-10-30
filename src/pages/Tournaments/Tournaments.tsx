import type * as React from "react";

import type {TournamentListType} from "@/schema";
import {useLocation} from "react-router-dom";
import TournamentList from "./Component/TournamentList";

const Tournaments: React.FC = () => {
    const location = useLocation();
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get("type") as TournamentListType | null;

    return (
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <TournamentList />
        </div>
    );
};

export default Tournaments;
