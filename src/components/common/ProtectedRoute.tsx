import {Spin} from "@arco-design/web-react";
import type {FC, ReactElement, ReactNode} from "react";
import {useAuthContext} from "../../context/AuthContext";

interface ProtectedRouteProps {
    children: ReactNode;
}

const ProtectedRoute: FC<ProtectedRouteProps> = ({children}): ReactElement => {
    const {loading} = useAuthContext();

    if (loading) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                <Spin tip="Loading..." size={40} />
            </div>
        );
    }
    return <>{children}</>;
};

export default ProtectedRoute;
