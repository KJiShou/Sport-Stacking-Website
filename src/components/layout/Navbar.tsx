import * as React from "react";

import {Layout, Menu, Avatar, Modal, Button, Dropdown, Message} from "@arco-design/web-react";
import {IconHome, IconCalendar, IconUser, IconExport} from "@arco-design/web-react/icon";
import {useNavigate, useLocation} from "react-router-dom";
import LoginForm from "../common/Login";
import {useAuthContext} from "../../context/AuthContext";
import {logout} from "../../services/firebase/authService";

interface MenuItem {
    key: string;
    label: string;
}

const Navbar: React.FC = () => {
    const MenuItem = Menu.Item;
    const SubMenu = Menu.SubMenu;
    const Header = Layout.Header;
    const navigate = useNavigate();
    const location = useLocation();

    const [visible, setVisible] = React.useState(false);
    const {firebaseUser} = useAuthContext();
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
                    {firebaseUser ? (
                        <Dropdown
                            droplist={
                                <Menu>
                                    <Menu.Item key="profile" onClick={() => navigate("/profile")}>
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
                            <Avatar style={{backgroundColor: "#3370ff"}} className="cursor-pointer">
                                {firebaseUser?.photoURL ? (
                                    <img
                                        src={firebaseUser.photoURL}
                                        alt="avatar"
                                        className="w-24 h-24 rounded-full object-cover"
                                    />
                                ) : (
                                    <IconUser />
                                )}
                            </Avatar>
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
                className={`w-full max-w-[95vw] md:max-w-[80vw] lg:max-w-[60vw]`}
            >
                <LoginForm onClose={() => setVisible(false)} />
            </Modal>
        </Header>
    );
};

export default Navbar;
