import type * as React from "react";

import CompetitionList from "./Component/CompetitionList";
import { useLocation } from "react-router-dom";

interface CompetitionListProps {
    type: "current" | "history";
}

const Tournaments: React.FC = () => {
    const location = useLocation();
    const searchParams = new URLSearchParams(location.search);
    const type = searchParams.get("type") as CompetitionListProps["type"] | null;

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <CompetitionList type={type ?? "current"} />
        </div>
    );
};

export default Tournaments;
