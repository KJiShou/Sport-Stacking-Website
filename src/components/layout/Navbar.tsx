import * as React from "react";

import {Layout, Menu, Avatar, Modal, Button, Dropdown, Message, Spin} from "@arco-design/web-react";
import {IconHome, IconCalendar, IconUser, IconExport} from "@arco-design/web-react/icon";
import {useNavigate, useLocation} from "react-router-dom";
import LoginForm from "../common/Login";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";
import {useState} from "react";

interface MenuItem {
    key: string;
    label: string;
}

const AvatarWithLoading = ({src}: {src: string}) => {
    const [loading, setLoading] = useState(true);

    return (
        <div className="relative inline-block">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80 rounded-full">
                    <Spin size={16} />
                </div>
            )}

            <Avatar
                size={40}
                className="rounded-full overflow-hidden"
                style={{
                    visibility: loading ? "hidden" : "visible",
                }}
            >
                <img
                    src={src}
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
    const Header = Layout.Header;
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

    React.useEffect(() => {
        if (firebaseUser != null) {
            setVisible(false);
        }
    }, [firebaseUser]);

    const recordsMenuItems: MenuItem[] = [
        {key: "/records/cycle", label: "Cycle"},
        {key: "/records/3-6-3", label: "3-6-3"},
        {key: "/records/3-3-3", label: "3-3-3"},
        {key: "/records/double", label: "Double"},
    ];
    return (
        <Header className="fixed h-24 flex z-20 w-full flex-row justify-between bg-white">
            <div className="logo" />
            <Menu
                defaultOpenKeys={["1"]}
                selectedKeys={[location.pathname]}
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
                <SubMenu
                    key="records"
                    title={
                        <span>
                            <IconCalendar />
                            Records
                        </span>
                    }
                >
                    {recordsMenuItems.map(({key, label}) => (
                        <MenuItem key={key}>{label}</MenuItem>
                    ))}
                </SubMenu>
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
                                    <AvatarWithLoading src={user.image_url} />
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
        </Header>
    );
};

export default Navbar;
