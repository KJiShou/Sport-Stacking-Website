import ParticipantListPage from "@/pages/Tournaments/ParticipantList/ParticipantListPage";
import ViewRegisterTournament from "@/pages/Tournaments/RegisterTournaments/ViewRegistration/ViewRegisterTournament";
import EditTournamentRegistrationPage from "@/pages/Tournaments/RegistrationsList/EditRegistration/EditRegistration";
import RegistrationsListPage from "@/pages/Tournaments/RegistrationsList/RegistrationsList";
import ScoringPage from "@/pages/Tournaments/Scoring/ScoringPage";
import VerifyPage from "@/pages/Tournaments/VerifyMember/VerifyPage";
import ForgotPasswordPage from "@/pages/User/ForgotPassword/ForgotPasswordPage";
import type * as React from "react";
import AdminPermissionsPage from "../pages/Admin/AdminPermission";
import Athletes from "../pages/Athletes/Athletes";
import Home from "../pages/Home/Home";
import page_3_3_3 from "../pages/Records/3-3-3/3-3-3";
import page_3_6_3 from "../pages/Records/3-6-3/3-6-3";
import Cycle from "../pages/Records/Cycle/Cycle";
import Double from "../pages/Records/Double/Double";
import CreateTournamentPage from "../pages/Tournaments/CreateTournaments/CreateTournaments";
import RegisterTournamentPage from "../pages/Tournaments/RegisterTournaments/RegisterTournament";
import Tournaments from "../pages/Tournaments/Tournaments";
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
    {path: "/tournaments/create", component: CreateTournamentPage},
    {
        path: "/tournaments/:tournamentId/register",
        component: RegisterTournamentPage,
    },
    {
        path: "/tournaments/:tournamentId/registrations",
        component: RegistrationsListPage,
    },
    {
        path: "/tournaments/:tournamentId/registrations/:registrationId/edit",
        component: EditTournamentRegistrationPage,
    },
    {
        path: "/tournaments/:tournamentId/register/:global_id/view",
        component: ViewRegisterTournament,
    },
    {
        path: "/tournaments/:tournamentId/participants",
        component: ParticipantListPage,
    },
    {
        path: "/tournaments/:tournamentId/start/record",
        component: ScoringPage,
    },
    {
        path: "/verify",
        component: VerifyPage,
    },
    {path: "/records/3-3-3", component: page_3_3_3},
    {path: "/records/3-6-3", component: page_3_6_3},
    {path: "/records/Cycle", component: Cycle},
    {path: "/records/Double", component: Double},
    {path: "/register", component: RegisterPage},
    {path: "/users/:id", component: UserProfile},
    {path: "/admins", component: AdminPermissionsPage},
    {path: "/forgot-password", component: ForgotPasswordPage},
];

export default routes;
