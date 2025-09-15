import * as React from "react";

import {Avatar, Button, Dropdown, Menu, Message, Modal, Spin} from "@arco-design/web-react";
import {IconCalendar, IconExport, IconHome, IconUser, IconUserGroup} from "@arco-design/web-react/icon";
import {useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import LoginForm from "../common/Login";

interface MenuItem {
    key: string;
    label: string;
}

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
    const {firebaseUser, user} = useAuthContext();
    const providers = firebaseUser?.providerData.map((p) => p.providerId);
    const hasPasswordLinked = providers?.includes("password");
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
                    </SubMenu>
                )}
            </Menu>
            {!isRegisterPage && (
                <div className="flex items-center m-10 cursor-pointer">
                    {user && hasPasswordLinked ? (
                        <Dropdown
                            droplist={
                                <Menu>
                                    <Menu.Item key="profile" onClick={() => navigate(`/users/${user.id}`)}>
                                        <IconUser className="mr-2" />
                                        Profile
                                    </Menu.Item>
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
                                {user.image_url ? (
                                    <AvatarWithLoading src={user.image_url} key={user.image_url} />
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
