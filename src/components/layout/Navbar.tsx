import * as React from "react";

import {Avatar, Badge, Button, Divider, Dropdown, Menu, Message, Modal, Spin} from "@arco-design/web-react";
import {
    IconCalendar,
    IconCheck,
    IconDown,
    IconExport,
    IconHome,
    IconNotification,
    IconUser,
    IconUserAdd,
    IconUserGroup,
} from "@arco-design/web-react/icon";
import {useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import {subscribePendingVerificationCountForGlobalIds} from "../../services/firebase/verificationRequestService";
import LoginForm from "../common/Login";

const AvatarWithLoading = ({src}: {src: string}) => {
    const [loading, setLoading] = useState(true);
    const [hasImageError, setHasImageError] = useState(false);
    const {user} = useAuthContext();
    const image = user?.image_url?.trim() || src.trim();

    React.useEffect(() => {
        setLoading(Boolean(image));
        setHasImageError(false);
    }, [image]);

    if (!image || hasImageError) {
        return (
            <Avatar size={40} className="rounded-full overflow-hidden" style={{backgroundColor: "#3370ff"}}>
                <IconUser />
            </Avatar>
        );
    }

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
                    onError={() => {
                        setLoading(false);
                        setHasImageError(true);
                    }}
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
    const {activeProfileId, firebaseUser, profiles, setActiveProfileId, user} = useAuthContext();
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
        const ownedGlobalIds = profiles
            .map((profile) => profile.global_id?.trim())
            .filter((globalId): globalId is string => Boolean(globalId));
        if (ownedGlobalIds.length === 0) {
            setPendingVerificationCount(0);
            return;
        }

        const unsubscribe = subscribePendingVerificationCountForGlobalIds(ownedGlobalIds, setPendingVerificationCount);
        return () => unsubscribe();
    }, [profiles]);

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
                                <Menu style={{minWidth: 280, padding: 6}}>
                                    {profiles.length > 1 && (
                                        <Menu.Item key="profile-label" disabled style={{height: 28, lineHeight: "28px"}}>
                                            Profiles
                                        </Menu.Item>
                                    )}
                                    {profiles.length > 1 &&
                                        profiles.map((profile) => {
                                            const isCurrentProfile = profile.id === (activeProfileId ?? user?.id);

                                            return (
                                                <Menu.Item
                                                    key={`switch-${profile.id}`}
                                                    onClick={() => setActiveProfileId(profile.id)}
                                                    style={
                                                        isCurrentProfile
                                                            ? {
                                                                  backgroundColor: "rgba(22, 93, 255, 0.12)",
                                                                  color: "rgb(var(--primary-6))",
                                                                  fontWeight: 600,
                                                                  borderLeft: "3px solid rgb(var(--primary-6))",
                                                              }
                                                            : undefined
                                                    }
                                                >
                                                    <div className="flex items-center justify-between gap-3 min-w-[240px]">
                                                        <span className="flex items-center gap-2 min-w-0">
                                                            <IconUser className="shrink-0" />
                                                            <span className="truncate">
                                                                {profile.global_id} - {profile.name}
                                                            </span>
                                                        </span>
                                                        {isCurrentProfile && (
                                                            <span className="flex items-center gap-1 text-xs shrink-0">
                                                                <IconCheck />
                                                                Current
                                                            </span>
                                                        )}
                                                    </div>
                                                </Menu.Item>
                                            );
                                        })}
                                    {profiles.length > 1 && <Divider style={{margin: "6px 0"}} />}
                                    {user && (
                                        <Menu.Item key="verify-requests" onClick={() => navigate("/verify-requests")}>
                                            <IconNotification className="mr-2" />
                                            Verify Requests ({pendingVerificationCount})
                                        </Menu.Item>
                                    )}
                                    {firebaseUser && (
                                        <Menu.Item key="add-profile" onClick={() => navigate("/register")}>
                                            <IconUserAdd className="mr-2" />
                                            Add Participant Profile
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
                            <div className="cursor-pointer flex items-center gap-1 rounded-md bg-transparent px-2 py-1 transition-colors hover:bg-[var(--color-fill-2)]">
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
                                <IconDown className="text-[var(--color-text-3)]" />
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
