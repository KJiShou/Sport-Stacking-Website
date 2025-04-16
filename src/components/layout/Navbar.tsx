import * as React from 'react';

import { Layout, Menu, Avatar } from "@arco-design/web-react";
import { IconHome, IconCalendar, IconUser } from "@arco-design/web-react/icon";
import { useNavigate, useLocation } from "react-router-dom";

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

  const handleNavigation = (key: string): void => {
    navigate(key);
  };

  const recordsMenuItems: MenuItem[] = [
    { key: "/records/cycle", label: "Cycle" },
    { key: "/records/3-6-3", label: "3-6-3" },
    { key: "/records/3-3-3", label: "3-3-3" },
    { key: "/records/double", label: "Double" },
  ];

  return (
    <Header className="fixed h-24 flex z-20 w-full flex-row justify-between bg-white">
      <div className="logo" />
      <Menu
        defaultOpenKeys={["1"]}
        defaultSelectedKeys={[location.pathname]}
        onClickMenuItem={handleNavigation}
        style={{ width: "100%" }}
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
          {recordsMenuItems.map(({ key, label }) => (
            <MenuItem key={key}>{label}</MenuItem>
          ))}
        </SubMenu>
      </Menu>
      <div className="flex items-center m-10 cursor-pointer">
        <Avatar style={{ backgroundColor: "#3370ff" }} className="">
          <IconUser />
        </Avatar>
      </div>
    </Header>
  );
};

export default Navbar;
