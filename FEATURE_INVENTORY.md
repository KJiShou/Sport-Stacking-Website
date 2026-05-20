# Feature Inventory

## Purpose
This file is the operational feature map for the Sport Stacking Website.

It complements `README.md` (high-level overview) by documenting:
- user-facing capabilities
- technical entry points (routes/pages)
- service-layer touchpoints
- main Firestore collections/entities
- maintenance status and update rules

## How To Use This Document
- Read `Feature Catalog` first to find a domain quickly.
- Use each domain section to locate routes, pages, and Firebase service files before changing behavior.
- When adding/modifying features, update this file in the same PR.

## Feature Catalog
| Domain | User-Facing Capability | Primary Routes | Status |
| --- | --- | --- | --- |
| Authentication and User Profile | Login, Google sign-in, registration, forgot password, profile update, avatar management | `/register`, `/forgot-password`, `/users/:id` | Live |
| Tournament Lifecycle | Create, edit, view, list, and manage tournament status/events | `/tournaments`, `/tournaments/create`, `/tournaments/:id/view` | Live |
| Registration and Participant Management | Register athletes/teams, manage registrations, edit and review registration details, participant list | `/tournaments/:tournamentId/register`, `/tournaments/:tournamentId/registrations`, `/tournaments/:tournamentId/registrations/:registrationId/edit`, `/tournaments/:tournamentId/register/:global_id/view`, `/tournaments/:tournamentId/participants` | Live |
| Prelim and Final Scoring | Capture prelim/final scores, validate completeness, produce rankings/finalists and route to results views | `/tournaments/:tournamentId/start/record`, `/tournaments/:tournamentId/scoring/final`, `/tournaments/:tournamentId/record/prelim`, `/tournaments/:tournamentId/record/final` | Live |
| Records and Rankings | Show event records/rankings and best-time aggregation | `/records` | Live |
| Athletes Directory | Browse athletes and inspect athlete profile/performance | `/athletes`, `/athletes/:athleteId` | Live |
| Admin Modules | User role permissions and admin operations | `/admins`, `/admin/users` | Live |
| Recruitment Modules | Team, individual, and double recruitment management and participation workflows | `/admin/team-recruitment` (+ tournament registration flows) | Live |
| Media and Homepage Content | Manage homepage carousel and showcase tournaments | `/`, `/admin/carousel` | Live |
| Verification Workflow | Verify members/participant details before tournament operations | `/verify` | Live |

## Detailed Feature Domains

### 1) Authentication and User Profile
- Feature name: Authentication and User Account Management
- User value: Users can create accounts, log in securely, recover access, and maintain profile data.
- Main routes/pages:
  - `src/pages/User/Register/RegisterPage.tsx`
  - `src/pages/User/ForgotPassword/ForgotPasswordPage.tsx`
  - `src/pages/User/UserProfile/UserProfile.tsx`
  - Global auth context: `src/context/AuthContext.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/authService.ts`
  - `src/services/firebase/storageService.ts`
- Core collections/entities:
  - `users`
  - `counters`
  - `user_tournament_history`
  - Firebase Storage avatar folders
- Roles/permissions assumptions:
  - Authenticated users can manage their own profile.
  - Admin-only actions (role updates, admin deletion) are gated in UI/service usage.
- Current status: Live

### 2) Tournament Lifecycle
- Feature name: Tournament Create/Edit/View/Status
- User value: Organizers can manage the full tournament setup and lifecycle.
- Main routes/pages:
  - `src/pages/Tournaments/Tournaments.tsx`
  - `src/pages/Tournaments/CreateTournaments/CreateTournaments.tsx`
  - `src/pages/Tournaments/Component/TournamentView.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/tournamentsService.ts`
  - `src/services/firebase/homeTournamentService.ts`
- Core collections/entities:
  - `tournaments`
  - `events`
  - `teams`
  - `registrations`
- Roles/permissions assumptions:
  - Tournament editing/deletion actions depend on user roles and creator/recorder checks in service logic.
- Current status: Live

### 3) Registration and Participant Management
- Feature name: Tournament Registration Operations
- User value: Participants can register; organizers can review, edit, and manage participant lists.
- Main routes/pages:
  - `src/pages/Tournaments/RegisterTournaments/RegisterTournament.tsx`
  - `src/pages/Tournaments/RegistrationsList/RegistrationsList.tsx`
  - `src/pages/Tournaments/RegistrationsList/EditRegistration/EditRegistration.tsx`
  - `src/pages/Tournaments/RegisterTournaments/ViewRegistration/ViewRegisterTournament.tsx`
  - `src/pages/Tournaments/ParticipantList/ParticipantListPage.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/registerService.ts`
  - `src/services/firebase/tournamentsService.ts`
  - `src/services/firebase/authService.ts` (registration record sync)
- Core collections/entities:
  - `registrations`
  - `teams`
  - `tournaments`
  - `users.registration_records`
- Roles/permissions assumptions:
  - Approval and edit actions are role-sensitive in the operations flow.
- Current status: Live

### 4) Prelim and Final Scoring and Results
- Feature name: Score Capture, Ranking, and Result Publication
- User value: Judges/organizers can enter scores and produce prelim/final outcomes.
- Main routes/pages:
  - `src/pages/Tournaments/Scoring/ScoringPage.tsx`
  - `src/pages/Tournaments/Scoring/FinalScoringPage.tsx`
  - `src/pages/Tournaments/PrelimResults/PrelimResultsPage.tsx`
  - `src/pages/Tournaments/FinalResults/FinalResultsPage.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/recordService.ts`
  - `src/services/firebase/finalistService.ts`
  - `src/services/firebase/registerService.ts`
- Core collections/entities:
  - `prelim_records`
  - `records`
  - `overall_records`
  - `finalists`
  - `users.registration_records` (rank/overall updates)
- Roles/permissions assumptions:
  - Scoring and finalization pages are expected for authorized tournament operators.
- Current status: Live

### 5) Records and Rankings
- Feature name: Global Records and Athlete Ranking Views
- User value: Users can see best performances and ranking outcomes across events.
- Main routes/pages:
  - `src/pages/Records/index.tsx`
  - Supporting ranking pages/components under tournaments results flow
- Main backend/service touchpoints:
  - `src/services/firebase/recordService.ts`
  - `src/services/firebase/athleteRankingsService.ts`
  - `src/services/firebase/userBestTimesService.ts`
  - `src/services/firebase/athleteService.ts`
- Core collections/entities:
  - `records`
  - `overall_records`
  - `globalResult/{type}/{event}` (legacy/compat usage remains in services)
  - `users` (best times and ranking-derived fields)
- Roles/permissions assumptions:
  - Read-heavy public/participant-facing behavior; verification/update actions are restricted.
- Current status: Live (with some legacy compatibility pathways)

### 6) Athletes Directory and Athlete Profile
- Feature name: Athlete Discovery and Performance Detail
- User value: Users can browse athlete list and inspect profile/history/performance.
- Main routes/pages:
  - `src/pages/Athletes/Athletes.tsx`
  - `src/pages/Athletes/AthleteProfile.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/athleteService.ts`
  - `src/services/firebase/athleteRankingsService.ts`
  - `src/services/firebase/userHistoryService.ts`
- Core collections/entities:
  - `users`
  - `user_tournament_history`
  - `records` / `overall_records` (indirect ranking/profile metrics)
- Roles/permissions assumptions:
  - Primarily read access for authenticated users.
- Current status: Live

### 7) Admin Modules
- Feature name: Admin Permission and User Management
- User value: Admins can manage user roles and admin-level controls.
- Main routes/pages:
  - `src/pages/Admin/AdminPermission.tsx`
  - `src/pages/Admin/UserManagement.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/authService.ts` (role update, user profile admin deletion)
- Core collections/entities:
  - `users`
- Roles/permissions assumptions:
  - Admin role required for role-management operations.
- Current status: Live

### 8) Recruitment Modules
- Feature name: Team/Individual/Double Recruitment
- User value: Users and admins can publish/find recruitment opportunities tied to tournaments.
- Main routes/pages:
  - `src/pages/Admin/TeamRecruitmentManagement.tsx`
  - Registration/tournament flows that consume recruitment outcomes
- Main backend/service touchpoints:
  - `src/services/firebase/teamRecruitmentService.ts`
  - `src/services/firebase/individualRecruitmentService.ts`
  - `src/services/firebase/doubleRecruitmentService.ts`
- Core collections/entities:
  - team recruitment collection(s) managed by service layer
  - individual recruitment collection(s) managed by service layer
  - double recruitment collection(s) managed by service layer
- Roles/permissions assumptions:
  - Creation and moderation depend on role and tournament context.
- Current status: Live

### 9) Media and Homepage Content
- Feature name: Home Page Content and Carousel Management
- User value: Visitors see curated tournament/home content; admins can manage hero carousel assets.
- Main routes/pages:
  - `src/pages/Home/Home.tsx`
  - `src/pages/Admin/CarouselManagement.tsx`
- Main backend/service touchpoints:
  - `src/services/firebase/homeCarouselService.ts`
  - `src/services/firebase/homeTournamentService.ts`
- Core collections/entities:
  - `homeCarousel`
  - `tournaments` (for upcoming/ongoing display)
- Roles/permissions assumptions:
  - Carousel management is admin-only.
- Current status: Live

### 10) Verification Workflow
- Feature name: Membership/Identity Verification
- User value: Supports verification steps needed before tournament participation/scoring actions.
- Main routes/pages:
  - `src/pages/Tournaments/VerifyMember/VerifyPage.tsx`
- Main backend/service touchpoints:
  - Verification service endpoints and registration/user services used by verification flows
- Core collections/entities:
  - `users`
  - `teams`
  - `registrations`
- Roles/permissions assumptions:
  - Verification actions are for authorized staff/admin roles.
- Current status: Live

## Cross-Feature Dependencies
- Scoring -> Records -> Rankings:
  - Scoring pages save to `prelim_records`/`records`/`overall_records`.
  - Ranking update logic writes participant rank and overall metrics into `users.registration_records`.
  - Records pages and athlete rankings consume these datasets.
- Registration -> Teams -> Scoring:
  - Registration and team composition determine eligible participants in scoring flows.
- Admin permissions -> All protected operations:
  - Role changes in `users.roles` affect tournament and admin management capabilities.

## Known Gaps / Future Candidates
- Route duplication detected for `/tournaments/:id/view` in `src/config/routes.tsx`.
- Some legacy compatibility paths still exist for `globalResult/{type}/{event}`.
- Add explicit role matrix per route (currently inferred from page/service logic).

## Mandatory Update Checklist (Use In Every Feature PR)
When adding or changing a feature, update this file and check each item:
- [ ] New route or page added/removed/renamed
- [ ] New Firebase service function added/removed/renamed
- [ ] New Firestore collection/entity added/removed/renamed
- [ ] Role/permission behavior changed
- [ ] Feature status changed (`live`, `partial`, `legacy`, `deprecated`)
- [ ] Cross-feature dependency changed
- [ ] Added an entry in `Change Log`

## New Feature Entry Template
Copy and fill this block for each new feature:

```md
### X) <Feature Domain Name>
- Feature name: <Name>
- User value: <What users can do / business value>
- Main routes/pages:
  - <path or file>
- Main backend/service touchpoints:
  - <service file + function>
- Core collections/entities:
  - <collection/entity list>
- Roles/permissions assumptions:
  - <who can do what>
- Current status: <live|partial|legacy|deprecated>
```

## Change Log
- 2026-02-18: Initial baseline inventory created from routes, pages, and Firebase services.
