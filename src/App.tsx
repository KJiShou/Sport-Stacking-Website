import {useEffect, useState} from "react";
import type * as React from "react";
import {BrowserRouter as Router, Routes, Route} from "react-router-dom";
import "@arco-design/web-react/dist/css/arco.css";
import {Navbar, Footer} from "./components/layout";
import {DeviceInspector} from "./utils/DeviceInspector";
import {Layout} from "@arco-design/web-react";
import routes from "./config/routes";
import ProtectedRoute from "./components/common/ProtectedRoute";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "./context/AuthContext";
import {logout} from "./services/firebase/authService";

const App: React.FC = () => {
    const Content = Layout.Content;

    const AutoLogoutIfIncompleteGoogleRegister = () => {
        const {firebaseUser, user} = useAuthContext();
        const location = useLocation();
        const navigate = useNavigate();

        useEffect(() => {
            const isGoogleUser = firebaseUser?.providerData?.[0]?.providerId === "google.com";
            const isUnregistered = firebaseUser?.providerData?.[1]?.providerId !== "password";
            const notInRegisterPage = location.pathname !== "/register";

            if (isGoogleUser && isUnregistered && notInRegisterPage) {
                logout().then(() => {
                    navigate("/"); // optional redirect
                });
            }
        }, [firebaseUser, user, location.pathname]);

        return null;
    };

    return (
        <Router>
            <AutoLogoutIfIncompleteGoogleRegister />
            <DeviceInspector />
            <Layout className="max-h-full h-full max-w-full w-full">
                <Navbar />
                <ProtectedRoute>
                    <Content className="pt-24">
                        <Routes>
                            {routes.map((route) => (
                                <Route key={route.path} path={route.path} element={<route.component />} />
                            ))}
                        </Routes>
                    </Content>
                </ProtectedRoute>
                <Footer />
            </Layout>
        </Router>
    );
};

export default App;
