import * as React from "react";

import {Avatar, Badge, Button, Divider, Drawer, Dropdown, Menu, Message, Spin} from "@arco-design/web-react";
import {
    IconCalendar,
    IconCheck,
    IconDown,
    IconExport,
    IconHome,
    IconNotification,
    IconMenu,
    IconUser,
    IconUserAdd,
    IconUserGroup,
} from "@arco-design/web-react/icon";
import {useState} from "react";
import {Link, useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import {subscribeNotificationsForGlobalIds} from "../../services/firebase/notificationService";
import {subscribePendingVerificationCountForGlobalIds} from "../../services/firebase/verificationRequestService";
import logoImage from "../../assets/icon.avif";
import LoginForm from "../common/Login";
import {ResponsiveOverlay} from "../responsive";
import {useDeviceBreakpoint} from "../../utils/DeviceInspector";
import {DeviceBreakpoint} from "../../utils/DeviceInspector/deviceStore";

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
    const [mobileMenuVisible, setMobileMenuVisible] = React.useState(false);
    const [mobileAccountVisible, setMobileAccountVisible] = React.useState(false);
    const [pendingVerificationCount, setPendingVerificationCount] = React.useState(0);
    const [unreadNotificationCount, setUnreadNotificationCount] = React.useState(0);
    const mobileMenuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const mobileAccountTriggerRef = React.useRef<HTMLButtonElement>(null);
    const loginTriggerRef = React.useRef<HTMLButtonElement>(null);
    const {activeProfileId, firebaseUser, profiles, setActiveProfileId, user} = useAuthContext();
    const deviceBreakpoint = useDeviceBreakpoint();
    const isMobileView = deviceBreakpoint < DeviceBreakpoint.md;
    const isRegisterPage = location.pathname === "/register";
    const handleNavigation = (key: string): void => {
        navigate(key);
    };

    const selectedKey = React.useMemo(() => {
        if (location.pathname.startsWith("/tournaments")) {
            return "/tournaments";
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
        if (location.state && typeof location.state === "object" && "openLogin" in location.state && location.state.openLogin) {
            setVisible(true);
            navigate(location.pathname, {replace: true, state: null});
        }
    }, [location, navigate]);

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

    React.useEffect(() => {
        const ownedGlobalIds = profiles
            .map((profile) => profile.global_id?.trim())
            .filter((globalId): globalId is string => Boolean(globalId));
        const unsubscribe = subscribeNotificationsForGlobalIds(ownedGlobalIds, (notifications) => {
            setUnreadNotificationCount(notifications.filter((notification) => notification.status === "unread").length);
        });
        return () => unsubscribe();
    }, [profiles]);

    const handleAccountNavigation = (path: string) => {
        setMobileAccountVisible(false);
        navigate(path);
    };

    const handleLogout = async () => {
        await logout();
        setVisible(false);
        setMobileAccountVisible(false);
        Message.success("Logout Successful");
        navigate("/");
    };

    const renderAccountMenu = () => (
        <Menu className="app-navbar__account-menu" style={{minWidth: 280, padding: 6}}>
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
                            onClick={() => {
                                setActiveProfileId(profile.id);
                                setMobileAccountVisible(false);
                            }}
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
                <Menu.Item key="verify-requests" onClick={() => handleAccountNavigation("/verify-requests")}>
                    <IconNotification className="mr-2" />
                    Verify Requests ({pendingVerificationCount})
                </Menu.Item>
            )}
            {user && (
                <Menu.Item key="notifications" onClick={() => handleAccountNavigation("/notifications")}>
                    <IconNotification className="mr-2" />
                    Notifications ({unreadNotificationCount})
                </Menu.Item>
            )}
            {firebaseUser && (
                <Menu.Item key="add-profile" onClick={() => handleAccountNavigation("/register")}>
                    <IconUserAdd className="mr-2" />
                    Add Participant Profile
                </Menu.Item>
            )}
            {user && (
                <Menu.Item key="profile" onClick={() => handleAccountNavigation(`/users/${user.id}`)}>
                    <IconUser className="mr-2" />
                    Profile
                </Menu.Item>
            )}
            <Menu.Item key="logout" onClick={handleLogout}>
                <span className="text-red-500 flex items-center">
                    <IconExport className="mr-2" />
                    Logout
                </span>
            </Menu.Item>
        </Menu>
    );

    const renderAccountTriggerContent = () => (
        <>
            <Badge count={pendingVerificationCount + unreadNotificationCount} offset={[-2, 6]}>
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
        </>
    );

    return (
        <div className="app-navbar fixed top-0 left-0 z-50 w-full flex items-center justify-between bg-[var(--color-bg-2)] border-b border-[var(--color-border)]">
            <Link to="/" className="app-navbar__brand no-underline" aria-label="Ranking Stack Malaysia">
                <img className="app-navbar__brand-mark" src={logoImage} alt="Malaysia ISSF" />
                <span className="app-navbar__brand-name">Ranking Stack</span>
            </Link>
            <Button
                className="app-navbar__mobile-trigger"
                ref={mobileMenuTriggerRef}
                aria-label="Open navigation"
                aria-expanded={mobileMenuVisible}
                aria-pressed={mobileMenuVisible}
                aria-controls="mobile-navigation-drawer"
                type="text"
                icon={<IconMenu />}
                onClick={() => setMobileMenuVisible(true)}
            />
            <Menu
                className="app-navbar__desktop-menu"
                defaultOpenKeys={["1"]}
                selectedKeys={[selectedKey]}
                onClickMenuItem={handleNavigation}
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
                <div className="app-navbar__account flex items-center ml-4 cursor-pointer">
                    {firebaseUser ? (
                        isMobileView ? (
                            <button
                                type="button"
                                className="app-navbar__account-button"
                                ref={mobileAccountTriggerRef}
                                aria-label="Open account menu"
                                aria-haspopup="dialog"
                                aria-expanded={mobileAccountVisible}
                                aria-pressed={mobileAccountVisible}
                                onClick={() => setMobileAccountVisible(true)}
                            >
                                {renderAccountTriggerContent()}
                            </button>
                        ) : (
                            <Dropdown droplist={renderAccountMenu()} position="br" trigger="click">
                                <button
                                    type="button"
                                    className="app-navbar__account-trigger cursor-pointer rounded-md bg-transparent px-2 py-1 transition-colors hover:bg-[var(--color-fill-2)]"
                                    aria-label="Open account menu"
                                    aria-haspopup="menu"
                                >
                                    {renderAccountTriggerContent()}
                                </button>
                            </Dropdown>
                        )
                    ) : (
                        <Button ref={loginTriggerRef} onClick={() => setVisible(true)} type="primary">
                            Login
                        </Button>
                    )}
                </div>
            )}
            <Drawer
                title="Navigation"
                placement="left"
                width="min(88vw, 360px)"
                visible={mobileMenuVisible}
                onCancel={() => {
                    setMobileMenuVisible(false);
                    window.setTimeout(() => mobileMenuTriggerRef.current?.focus(), 0);
                }}
                footer={null}
                className="app-navbar__mobile-drawer"
            >
                <div id="mobile-navigation-drawer">
                    <Menu
                        selectedKeys={[selectedKey]}
                        onClickMenuItem={(key) => {
                            setMobileMenuVisible(false);
                            window.setTimeout(() => mobileMenuTriggerRef.current?.focus(), 0);
                            handleNavigation(key);
                        }}
                        mode="vertical"
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
                    {user && (
                        <>
                            <MenuItem key="/notifications">
                                <IconNotification />
                                Notifications ({unreadNotificationCount})
                            </MenuItem>
                            <MenuItem key="/verify-requests">
                                <IconNotification />
                                Verify Requests ({pendingVerificationCount})
                            </MenuItem>
                        </>
                    )}
                    {user?.roles?.modify_admin && (
                        <SubMenu
                            key="mobile-admin-menu"
                            title={
                                <>
                                    <IconUser />
                                    Admin
                                </>
                            }
                        >
                            <MenuItem key="/admins">
                                <IconUser /> Permissions
                            </MenuItem>
                            <MenuItem key="/admin/team-recruitment">
                                <IconUserGroup /> Team Recruitment
                            </MenuItem>
                            <MenuItem key="/admin/users">
                                <IconUserGroup /> User Management
                            </MenuItem>
                            <MenuItem key="/admin/carousel">
                                <IconUserGroup /> Carousel Management
                            </MenuItem>
                            {user?.global_id === "00001" && (
                                <MenuItem key="/admin/developer-setting">
                                    <IconUserGroup /> Developer Setting
                                </MenuItem>
                            )}
                        </SubMenu>
                    )}
                    </Menu>
                </div>
            </Drawer>
            {firebaseUser ? (
                <ResponsiveOverlay
                    title="Account"
                    visible={mobileAccountVisible}
                    onCancel={() => setMobileAccountVisible(false)}
                    mobileMode="sheet"
                    returnFocusRef={mobileAccountTriggerRef}
                    footer={null}
                >
                    <div className="mobile-account-menu">{renderAccountMenu()}</div>
                </ResponsiveOverlay>
            ) : null}
            <ResponsiveOverlay
                title="Login"
                visible={visible}
                onCancel={() => {
                    setVisible(false);
                }}
                mobileMode="fullscreen"
                returnFocusRef={loginTriggerRef}
                footer={null}
            >
                <LoginForm onClose={() => setVisible(false)} />
            </ResponsiveOverlay>
        </div>
    );
};

export default Navbar;
