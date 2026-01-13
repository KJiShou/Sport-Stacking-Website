import {useEffect, useRef} from "react";
import type {FC} from "react";
import {Route, BrowserRouter as Router, Routes} from "react-router-dom";
import "@arco-design/web-react/dist/css/arco.css";
import {ConfigProvider, Layout} from "@arco-design/web-react";
import enUS from "@arco-design/web-react/es/locale/en-US";
import {Helmet as HelmetBase} from "react-helmet";
import type {HelmetProps} from "react-helmet";
import {useLocation, useNavigate} from "react-router-dom";
import image from "./assets/icon.avif";
import ProtectedRoute from "./components/common/ProtectedRoute";
import {Footer, Navbar} from "./components/layout";
import routes from "./config/routes";
import {useAuthContext} from "./context/AuthContext";
import {logout} from "./services/firebase/authService";
import {DeviceInspector} from "./utils/DeviceInspector";

const HelmetComponent = HelmetBase as unknown as FC<HelmetProps>;
const Helmet: FC<HelmetProps> = (props) => <HelmetComponent {...props} />;

const App: FC = () => {
    const Content = Layout.Content;

    const AutoLogoutOnLeaveRegister = () => {
        const {firebaseUser, loading, user} = useAuthContext();
        const {pathname} = useLocation();
        const navigate = useNavigate();
        const prevPathRef = useRef<string>(pathname);

        useEffect(() => {
            if (!firebaseUser || loading || !user) {
                prevPathRef.current = pathname;
                return;
            }

            const providers = firebaseUser.providerData.map((p) => p.providerId);
            const isGoogleOnly = providers.includes("google.com") && !providers.includes("password");

            const wasOnRegister = prevPathRef.current === "/register" || prevPathRef.current.startsWith("/register/");
            const isNowOffRegister = !(pathname === "/register" || pathname.startsWith("/register/"));

            if (!loading && isGoogleOnly && wasOnRegister && isNowOffRegister) {
                const targetPath = pathname;
                logout().then(() => navigate(targetPath, {replace: true}));
            }

            prevPathRef.current = pathname;
        }, [firebaseUser, loading, user, pathname, navigate]);

        return null;
    };
    const RedirectOrLogoutMissingProfile = () => {
        const {firebaseUser, loading, user} = useAuthContext();
        const {pathname} = useLocation();
        const navigate = useNavigate();
        const prevPathRef = useRef<string>(pathname);

        useEffect(() => {
            if (loading || !firebaseUser || user) {
                prevPathRef.current = pathname;
                return;
            }

            const providers = firebaseUser.providerData.map((p) => p.providerId);
            const isGoogle = providers.includes("google.com");
            const wasOnRegister =
                prevPathRef.current === "/register" || prevPathRef.current.startsWith("/register/");
            const isOnRegister = pathname === "/register" || pathname.startsWith("/register/");
            const isNowOffRegister = !isOnRegister;

            if (wasOnRegister && isNowOffRegister) {
                const targetPath = pathname;
                logout().then(() => navigate(targetPath, {replace: true}));
                prevPathRef.current = pathname;
                return;
            }

            if (isGoogle) {
                if (!isOnRegister) {
                    navigate("/register", {
                        state: {
                            email: firebaseUser.email ?? "",
                            fromGoogle: true,
                        },
                    });
                }
                prevPathRef.current = pathname;
                return;
            }

            logout().then(() => navigate("/"));
            prevPathRef.current = pathname;
        }, [firebaseUser, loading, user, pathname, navigate]);

        return null;
    };

    return (
        <ConfigProvider locale={enUS}>
            <Router>
                <Helmet>
                    <link rel="icon" type="image/avif" href={image} />
                </Helmet>
                <AutoLogoutOnLeaveRegister />
                <RedirectOrLogoutMissingProfile />
                <DeviceInspector />
                <Layout className="max-w-full w-full h-screen">
                    <Navbar /> {/* 固定顶部 */}
                    <ProtectedRoute>
                        {/* 使用窗口滚动，移除内部滚动容器 */}
                        <Content className="mt-24 flex flex-col min-h-[calc(100vh-6rem)]">
                            <div className="flex-grow">
                                <Routes>
                                    {routes.map((route) => (
                                        <Route key={route.path} path={route.path} element={<route.component />} />
                                    ))}
                                </Routes>
                            </div>
                            <Footer />
                        </Content>
                    </ProtectedRoute>
                </Layout>
            </Router>
        </ConfigProvider>
    );
};

export default App;
