import type * as React from "react";

import {useLocation} from "react-router-dom";
import TournamentList from "./Component/TournamentList";

interface TournamentListProps {
    type: "current" | "history";
}

const Tournaments: React.FC = () => {
    const location = useLocation();
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get("type") as TournamentListProps["type"] | null;

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <TournamentList />
        </div>
    );
};

export default Tournaments;
