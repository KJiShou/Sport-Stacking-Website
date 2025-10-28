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
            if (!firebaseUser || loading) {
                prevPathRef.current = pathname;
                return;
            }

            const providers = firebaseUser.providerData.map((p) => p.providerId);
            const isGoogleOnly = providers.includes("google.com") && !providers.includes("password");

            const wasOnRegister = prevPathRef.current === "/register" || prevPathRef.current.startsWith("/register/");
            const isNowOffRegister = !(pathname === "/register" || pathname.startsWith("/register/"));

            if (!loading && isGoogleOnly && wasOnRegister && isNowOffRegister) {
                logout().then(() => navigate("/"));
            }

            prevPathRef.current = pathname;
        }, [firebaseUser, loading, pathname, navigate]);

        return null;
    };

    return (
        <ConfigProvider locale={enUS}>
            <Router>
                <Helmet>
                    <link rel="icon" type="image/avif" href={image} />
                </Helmet>
                <AutoLogoutOnLeaveRegister />
                <DeviceInspector />
                <Layout className="max-w-full w-full h-screen">
                    <Navbar /> {/* 固定顶部 */}
                    <ProtectedRoute>
                        {/* 使用窗口滚动，移除内部滚动容器 */}
                        <Content className="mt-24">
                            <Routes>
                                {routes.map((route) => (
                                    <Route key={route.path} path={route.path} element={<route.component />} />
                                ))}
                            </Routes>
                            <Footer />
                        </Content>
                    </ProtectedRoute>
                </Layout>
            </Router>
        </ConfigProvider>
    );
};

export default App;
