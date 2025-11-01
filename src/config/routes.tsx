import TournamentView from "@/pages/Tournaments/Component/TournamentView";
import FinalResultsPage from "@/pages/Tournaments/FinalResults/FinalResultsPage";
import ParticipantListPage from "@/pages/Tournaments/ParticipantList/ParticipantListPage";
import PrelimResultsPage from "@/pages/Tournaments/PrelimResults/PrelimResultsPage";
import ViewRegisterTournament from "@/pages/Tournaments/RegisterTournaments/ViewRegistration/ViewRegisterTournament";
import EditTournamentRegistrationPage from "@/pages/Tournaments/RegistrationsList/EditRegistration/EditRegistration";
import RegistrationsListPage from "@/pages/Tournaments/RegistrationsList/RegistrationsList";
import FinalScoringPage from "@/pages/Tournaments/Scoring/FinalScoringPage";
import ScoringPage from "@/pages/Tournaments/Scoring/ScoringPage";
import VerifyPage from "@/pages/Tournaments/VerifyMember/VerifyPage";
import ForgotPasswordPage from "@/pages/User/ForgotPassword/ForgotPasswordPage";
import type {AppRoute} from "@/schema";
import AdminPermissionsPage from "../pages/Admin/AdminPermission";
import {CarouselManagement} from "../pages/Admin/CarouselManagement";
import TeamRecruitmentManagement from "../pages/Admin/TeamRecruitmentManagement";
import AthleteProfilePage from "../pages/Athletes/AthleteProfile";
import Athletes from "../pages/Athletes/Athletes";
import Home from "../pages/Home/Home";
import RecordsIndex from "../pages/Records";
import CreateTournamentPage from "../pages/Tournaments/CreateTournaments/CreateTournaments";
import RegisterTournamentPage from "../pages/Tournaments/RegisterTournaments/RegisterTournament";
import Tournaments from "../pages/Tournaments/Tournaments";
import RegisterPage from "../pages/User/Register/RegisterPage";
import UserProfile from "../pages/User/UserProfile/UserProfile";

const routes: AppRoute[] = [
    {
        path: "/tournaments/:id/view",
        component: TournamentView,
    },
    {
        path: "/tournaments/:id/view",
        component: TournamentView,
    },
    {path: "/", component: Home},
    {path: "/athletes", component: Athletes},
    {path: "/athletes/:athleteId", component: AthleteProfilePage},
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
        path: "/tournaments/:tournamentId/record/prelim",
        component: PrelimResultsPage,
    },
    {
        path: "/tournaments/:tournamentId/scoring/final",
        component: FinalScoringPage,
    },
    {
        path: "/tournaments/:tournamentId/record/final",
        component: FinalResultsPage,
    },
    {
        path: "/verify",
        component: VerifyPage,
    },
    {path: "/records", component: RecordsIndex},
    {path: "/register", component: RegisterPage},
    {path: "/users/:id", component: UserProfile},
    {path: "/admins", component: AdminPermissionsPage},
    {path: "/admin/team-recruitment", component: TeamRecruitmentManagement},
    {path: "/admin/carousel", component: CarouselManagement},
    {path: "/forgot-password", component: ForgotPasswordPage},
];

export default routes;
