import * as React from "react";

import {Avatar, Badge, Button, Dropdown, Menu, Message, Modal, Spin} from "@arco-design/web-react";
import {IconCalendar, IconExport, IconHome, IconNotification, IconUser, IconUserGroup} from "@arco-design/web-react/icon";
import {useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import {subscribePendingVerificationCount} from "../../services/firebase/verificationRequestService";
import LoginForm from "../common/Login";

const AvatarWithLoading = ({src}: {src: string}) => {
    const [loading, setLoading] = useState(true);
    const {user} = useAuthContext();
    let image = user?.image_url ?? src;
    React.useEffect(() => {
        image = user?.image_url ?? src;
    }, [src, user]);

    return (
        <div className="relative inline-block">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80 rounded-full">
                    <Spin size={16} />
                </div>
            )}
            <Avatar size={40} className="rounded-full overflow-hidden" style={{visibility: loading ? "hidden" : "visible"}}>
                <img
                    src={image}
                    alt="avatar"
                    onLoad={() => setLoading(false)}
                    onError={() => setLoading(false)}
                    className="w-full h-full object-cover rounded-full"
                />
            </Avatar>
        </div>
    );
};

const Navbar: React.FC = () => {
    const MenuItem = Menu.Item;
    const SubMenu = Menu.SubMenu;
    const navigate = useNavigate();
    const location = useLocation();

    const [visible, setVisible] = React.useState(false);
    const [pendingVerificationCount, setPendingVerificationCount] = React.useState(0);
    const {firebaseUser, user} = useAuthContext();
    const isRegisterPage = location.pathname === "/register";
    const handleNavigation = (key: string): void => {
        navigate(key);
    };

    const selectedKey = React.useMemo(() => {
        if (location.pathname.startsWith("/tournaments")) {
            return location.pathname + location.search;
        }
        if (location.pathname.startsWith("/records")) {
            return location.pathname;
        }
        return location.pathname;
    }, [location]);

    React.useEffect(() => {
        if (firebaseUser != null) {
            setVisible(false);
        }
    }, [firebaseUser]);

    React.useEffect(() => {
        if (!user?.global_id) {
            setPendingVerificationCount(0);
            return;
        }

        const unsubscribe = subscribePendingVerificationCount(user.global_id, setPendingVerificationCount);
        return () => unsubscribe();
    }, [user?.global_id]);

    return (
        <div className="fixed top-0 left-0 z-50 w-full h-24 flex items-center justify-between px-6 py-4 bg-[var(--color-bg-2)] border-b border-[var(--color-border)]">
            <div className="logo" />
            <Menu
                defaultOpenKeys={["1"]}
                selectedKeys={[selectedKey]}
                onClickMenuItem={handleNavigation}
                style={{width: "100%"}}
                mode="horizontal"
            >
                <MenuItem key="/">
                    <IconHome />
                    Home
                </MenuItem>
                <MenuItem key="/athletes">
                    <IconCalendar />
                    Athletes
                </MenuItem>
                <MenuItem key="/tournaments">
                    <IconCalendar />
                    Tournaments
                </MenuItem>
                <MenuItem key="/records">
                    <IconCalendar />
                    Records
                </MenuItem>
                {user?.roles?.modify_admin && (
                    <SubMenu
                        key="admin-menu"
                        title={
                            <>
                                <IconUser />
                                Admin
                            </>
                        }
                    >
                        <MenuItem key="/admins">
                            <IconUser />
                            Permissions
                        </MenuItem>
                        <MenuItem key="/admin/team-recruitment">
                            <IconUserGroup />
                            Team Recruitment
                        </MenuItem>
                        <MenuItem key="/admin/users">
                            <IconUserGroup />
                            User Management
                        </MenuItem>
                        <MenuItem key="/admin/carousel">
                            <IconUserGroup />
                            Carousel Management
                        </MenuItem>
                        {user?.global_id === "00001" && (
                            <MenuItem key="/admin/developer-setting">
                                <IconUserGroup />
                                Developer Setting
                            </MenuItem>
                        )}
                    </SubMenu>
                )}
            </Menu>
            {!isRegisterPage && (
                <div className="flex items-center m-10 cursor-pointer">
                    {firebaseUser ? (
                        <Dropdown
                            droplist={
                                <Menu>
                                    {user && (
                                        <Menu.Item key="verify-requests" onClick={() => navigate("/verify-requests")}>
                                            <IconNotification className="mr-2" />
                                            Verify Requests ({pendingVerificationCount})
                                        </Menu.Item>
                                    )}
                                    {user && (
                                        <Menu.Item key="profile" onClick={() => navigate(`/users/${user.id}`)}>
                                            <IconUser className="mr-2" />
                                            Profile
                                        </Menu.Item>
                                    )}
                                    <Menu.Item
                                        key="logout"
                                        onClick={async () => {
                                            await logout();
                                            setVisible(false);
                                            Message.success("Logout Successful");
                                            navigate("/");
                                        }}
                                    >
                                        <span className="text-red-500 flex items-center">
                                            <IconExport className="mr-2" />
                                            Logout
                                        </span>
                                    </Menu.Item>
                                </Menu>
                            }
                            position="br"
                            trigger="click"
                        >
                            <div className="cursor-pointer">
                                <Badge count={pendingVerificationCount} offset={[-2, 6]}>
                                    {user?.image_url || firebaseUser?.photoURL ? (
                                        <AvatarWithLoading
                                            src={user?.image_url ?? firebaseUser?.photoURL ?? ""}
                                            key={user?.image_url ?? firebaseUser?.photoURL ?? "avatar"}
                                        />
                                    ) : (
                                        <Avatar style={{backgroundColor: "#3370ff"}}>
                                            <IconUser />
                                        </Avatar>
                                    )}
                                </Badge>
                            </div>
                        </Dropdown>
                    ) : (
                        <Button onClick={() => setVisible(true)} type="primary">
                            Login
                        </Button>
                    )}
                </div>
            )}
            <Modal
                title="Login"
                visible={visible}
                onCancel={() => {
                    setVisible(false);
                }}
                footer={null}
                autoFocus={false}
                focusLock={true}
                className={`max-w-[95vw] md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                <LoginForm onClose={() => setVisible(false)} />
            </Modal>
        </div>
    );
};

export default Navbar;
