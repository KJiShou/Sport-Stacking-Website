import React from "react";
import type { ReactNode } from "react";
import { useAuthContext } from "../../context/AuthContext";
import { Spin } from "@arco-design/web-react";

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
    const { loading } = useAuthContext();

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                <Spin tip="Loading..." size={40} />
            </div>
        );
    }
    return children;
};

export default ProtectedRoute;
