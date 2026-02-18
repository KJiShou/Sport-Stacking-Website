import * as React from "react";

import {Avatar, Button, Dropdown, Menu, Message, Modal, Spin} from "@arco-design/web-react";
import {IconCalendar, IconExport, IconHome, IconUser, IconUserGroup} from "@arco-design/web-react/icon";
import {useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import LoginForm from "../common/Login";

const AvatarWithLoading = ({src}: {src?: string | null}) => {
    const [loading, setLoading] = useState(true);

    return (
        <div className="relative inline-block">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80 rounded-full">
                    <Spin size={16} />
                </div>
            )}
            <Avatar size={40} className="rounded-full overflow-hidden" style={{visibility: loading ? "hidden" : "visible"}}>
                <img
                    src={src ?? ""}
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
    const {firebaseUser, user, currentProfile, userProfiles, setCurrentProfile} = useAuthContext();
    const isRegisterPage = location.pathname === "/register";
    const isAdmin = currentProfile?.roles?.modify_admin ?? false;
    const avatarSrc = currentProfile?.image_url ?? user?.image_url ?? firebaseUser?.photoURL ?? "";
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
                {isAdmin && (
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
                            Admin Dashboard
                        </MenuItem>
                        <MenuItem key="/admin/team-recruitment">
                            <IconUserGroup />
                            Team Recruitment
                        </MenuItem>
                        <MenuItem key="/admin/carousel">
                            <IconUserGroup />
                            Carousel Management
                        </MenuItem>
                    </SubMenu>
                )}
            </Menu>
            {!isRegisterPage && (
                <div className="flex items-center m-10 cursor-pointer">
                    {firebaseUser ? (
                        <Dropdown
                            droplist={
                                <Menu>
                                    <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 mb-2 cursor-default bg-transparent">
                                        <div className="flex flex-col">
                                            <span className="font-bold truncate" style={{color: "var(--color-text-1)"}}>
                                                {currentProfile?.name ?? user?.name}
                                            </span>
                                            <span className="text-xs text-gray-600 dark:text-gray-400 truncate">
                                                {user?.email}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Profile Management Link */}
                                    <Menu.Item
                                        key="profile"
                                        onClick={() => {
                                            const targetId = currentProfile?.id ?? user?.id;
                                            if (targetId) {
                                                navigate(`/users/${targetId}`);
                                            }
                                        }}
                                    >
                                        <IconUser className="mr-2" />
                                        Manage Profile
                                    </Menu.Item>

                                    {/* Profile Switcher Section */}
                                    {userProfiles.length > 1 && (
                                        <SubMenu
                                            key="switch_profile"
                                            title={
                                                <span>
                                                    <IconUserGroup className="mr-2" />
                                                    Switch Profile
                                                </span>
                                            }
                                        >
                                            {userProfiles.map((p) => (
                                                <Menu.Item
                                                    key={p.id ?? "unknown"}
                                                    onClick={() => setCurrentProfile(p)}
                                                    className={
                                                        p.id === currentProfile?.id ? "bg-blue-50 dark:bg-blue-900/20" : ""
                                                    }
                                                >
                                                    <div className="flex items-center">
                                                        <Avatar size={24} className="mr-2">
                                                            {p.name.charAt(0)}
                                                        </Avatar>
                                                        {p.name}
                                                    </div>
                                                </Menu.Item>
                                            ))}
                                        </SubMenu>
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
                                {avatarSrc ? (
                                    <AvatarWithLoading src={avatarSrc} key={avatarSrc || "avatar"} />
                                ) : (
                                    <Avatar style={{backgroundColor: "#3370ff"}}>
                                        <IconUser />
                                    </Avatar>
                                )}
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
