import type * as React from "react";
import Home from "../pages/Home/Home";
import Athletes from "../pages/Athletes/Athletes";
import Tournaments from "../pages/Tournaments/Tournaments";
import page_3_3_3 from "../pages/Records/3-3-3/3-3-3";
import page_3_6_3 from "../pages/Records/3-6-3/3-6-3";
import Cycle from "../pages/Records/Cycle/Cycle";
import Double from "../pages/Records/Double/Double";
import RegisterPage from "../pages/User/Register/RegisterPage";
import UserProfile from "../pages/User/UserProfile/UserProfile";

export interface Route {
    path: string;
    component: React.ComponentType;
}

const routes: Route[] = [
    {path: "/", component: Home},
    {path: "/athletes", component: Athletes},
    {path: "/tournaments", component: Tournaments},
    {path: "/records/3-3-3", component: page_3_3_3},
    {path: "/records/3-6-3", component: page_3_6_3},
    {path: "/records/Cycle", component: Cycle},
    {path: "/records/Double", component: Double},
    {path: "/register", component: RegisterPage},
    {path: "/users/:id", component: UserProfile},
];

export default routes;
