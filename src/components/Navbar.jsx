import { useState, useEffect } from 'react';
import { Layout, Menu, Button, Message } from '@arco-design/web-react';
import {
    IconHome,
    IconCalendar,
    IconCaretRight,
    IconCaretLeft,
} from '@arco-design/web-react/icon';
import { DeviceBreakpoint } from '../hooks/DeviceInspector/deviceStore';
import { useDeviceBreakpoint } from '../hooks/DeviceInspector/index';
import { useNavigate } from 'react-router-dom';

const Navbar = () => {
    const MenuItem = Menu.Item;
    const SubMenu = Menu.SubMenu;
    //const Sider = Layout.Sider;
    const Header = Layout.Header;
    const Footer = Layout.Footer;
    const Content = Layout.Content;
    const navigate = useNavigate();
    const [collapse, setCollapse] = useState(false);

    const deviceBreakPoint = useDeviceBreakpoint();

    useEffect(() => {
        setCollapse(deviceBreakPoint < DeviceBreakpoint.md);
    }, [deviceBreakPoint]);

    return (
        <Layout className={`max-h-full h-full max-w-full w-full`}>
            <Header
                className={`fixed h-24 flex z-20 w-full flex-row justify-between`}
            >
                <div className="logo" />
                <Menu
                    defaultOpenKeys={['1']}
                    defaultSelectedKeys={['0_3']}
                    onClickMenuItem={(key) =>
                        Message.info({
                            content: `You select ${key}`,
                            showIcon: true,
                        })
                    }
                    style={{ width: '100%' }}
                    mode="horizontal"
                >
                    <MenuItem key="0_1" disabled>
                        <IconHome />
                        Menu 1
                    </MenuItem>
                    <MenuItem
                        key="0_2"
                        onClick={() => {
                            navigate('/admin');
                        }}
                    >
                        <IconCalendar />
                        Menu 2
                    </MenuItem>
                    <MenuItem key="0_3">
                        <IconCalendar />
                        Menu 3
                    </MenuItem>
                    <SubMenu
                        key="1"
                        title={
                            <span>
                                <IconCalendar />
                                Navigation 1
                            </span>
                        }
                    >
                        <MenuItem key="1_1">Menu 1</MenuItem>
                        <MenuItem key="1_2">Menu 2</MenuItem>
                        <SubMenu key="2" title="Navigation 2">
                            <MenuItem key="2_1">Menu 1</MenuItem>
                            <MenuItem key="2_2">Menu 2</MenuItem>
                        </SubMenu>
                        <SubMenu key="3" title="Navigation 3">
                            <MenuItem key="3_1">Menu 1</MenuItem>
                            <MenuItem key="3_2">Menu 2</MenuItem>
                            <MenuItem key="3_3">Menu 3</MenuItem>
                        </SubMenu>
                    </SubMenu>
                    <SubMenu
                        key="4"
                        title={
                            <span>
                                <IconCalendar />
                                Navigation 4
                            </span>
                        }
                    >
                        <MenuItem key="4_1">Menu 1</MenuItem>
                        <MenuItem key="4_2">Menu 2</MenuItem>
                        <MenuItem key="4_3">Menu 3</MenuItem>
                    </SubMenu>
                </Menu>
            </Header>
            <Content className={`pt-24`}>
                <Button
                    shape="round"
                    className="trigger"
                    onClick={() => {
                        setCollapse(!collapse);
                    }}
                >
                    {collapse ? <IconCaretRight /> : <IconCaretLeft />}
                </Button>
            </Content>
            <Footer>Footer</Footer>
        </Layout>
    );
};

export default Navbar;
