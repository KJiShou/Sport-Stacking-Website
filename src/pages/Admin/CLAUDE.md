[Root Directory](./CLAUDE.md) > **Admin Module**

---

# Admin Module

**Path**: `src/pages/Admin/` + `src/services/firebase/homeCarouselService.ts` + `src/services/firebase/teamRecruitmentService.ts`

**Responsibility**: Administrative management of users, homepage carousel, team recruitment listings, and developer maintenance tools.

---

## Entry Points

| Page | Route | File | Access Check |
|------|-------|------|-------------|
| **Admin Permissions** | `/admins` | `AdminPermission.tsx` | Checks `roles.edit_tournament`, `record_tournament`, `modify_admin`, `verify_record` |
| **Team Recruitment Admin** | `/admin/team-recruitment` | `TeamRecruitmentManagement.tsx` | `roles.edit_tournament \|\| modify_admin` |
| **Carousel Management** | `/admin/carousel` | `CarouselManagement.tsx` | Public component, no route guard |
| **User Management** | `/admin/users` | `UserManagement.tsx` | `roles.modify_admin` |
| **Developer Settings** | `/admin/developer-setting` | `DeveloperSetting.tsx` | `user.global_id === "00001"` (hardcoded developer ID) |

---

## User Roles

Defined in `src/schema/RoleSchema.ts`:

```typescript
type Role = {
  edit_tournament: boolean;   // Can create/edit tournaments
  record_tournament: boolean;  // Can enter scores
  modify_admin: boolean;       // Can assign roles to other users
  verify_record: boolean;      // Can verify submitted records
};
```

Client-side role checks via `AuthContext`. Server-side Firestore rules enforcement is **missing** (CRITICAL security gap).

---

## Page Details

### AdminPermission.tsx (249 lines)
- Table of all users fetched via `fetchAllUsers()`
- Sortable columns: Account ID, Name, Member ID, Email, Roles
- Role-based admin tag (red for admin, blue for user)
- Edit modal with Switches for each role + Member ID field
- Saves via `updateUserRoles()` + `updateUserProfile()`
- Search by Global ID or name

### UserManagement.tsx (323 lines)
- Admin-only view with access denied page for non-admins
- Full user table with Global ID, IC, Name, Gmail columns
- View Detail modal showing: Global ID, IC, Email, Name, Phone, Gender, Birthdate, Country/State, School, Roles, Member ID
- Edit mode (Form with Input/Select for name/phone/gender/school)
- Delete account via `deleteUserProfileAdmin()`
- Search by Global ID, IC, name, or Gmail
- Pagination (10 per page)

### CarouselManagement.tsx (312 lines)
- Table of all carousel images with: Order, Preview, Title, Description, Link, Active, Actions
- Add/Edit modal with Upload, Title, Description, Link, Order, Active fields
- Image upload to Firebase Storage -> then Firestore document
- Reorder with up/down buttons (updates `order` field in batch)
- Toggle active state inline with Switch
- Delete with Popconfirm + Storage file cleanup
- Collection name: `homeCarousel` (camelCase, no underscore)

### TeamRecruitmentManagement.tsx (1036 lines)
- Three-tab interface: Individuals | Doubles | Teams
- Tournament filter dropdown (URL search params)
- Summary cards showing counts
- **Individual tab**: Assign participants to teams, delete recruitment
- **Double tab**: Match double partners, age range validation (<=10 years), team creation
- **Team tab**: Edit max_members_needed, status, requirements
- Assignment modal: picks existing team or creates new team
- Double assignment modal: selects partner + leader
- All operations use corresponding recruitment services

### DeveloperSetting.tsx (83 lines)
- **Developer-only** (hardcoded `global_id === "00001"`)
- "Recalculate All Athletes Data" button
- Calls `recalculateAllAthletesBestPerformanceAndTournamentHistory()` from `developerService.ts`
- Shows summary: athletes processed, tournaments processed, ranking job success/failure counts
- Confirmation modal before execution
- Console warns on failed ranking jobs

---

## Services

| Service | File | Key Functions |
|---------|------|---------------|
| **homeCarouselService** | `services/firebase/homeCarouselService.ts` | `getActiveCarouselImages`, `getAllCarouselImages`, `addCarouselImage`, `updateCarouselImage`, `deleteCarouselImage`, `reorderCarouselImages`, `toggleCarouselActive` |
| **teamRecruitmentService** | `services/firebase/teamRecruitmentService.ts` | `createTeamRecruitment`, `getActiveTeamRecruitments`, `getAllTeamRecruitments`, `updateTeamRecruitmentDetails`, `updateTeamRecruitmentMembersNeeded`, `deleteTeamRecruitment` |
| **individualRecruitmentService** | `services/firebase/individualRecruitmentService.ts` | CRUD for `individual_recruitment` collection |
| **doubleRecruitmentService** | `services/firebase/doubleRecruitmentService.ts` | CRUD for `double_recruitment` collection |
| **authService** | `services/firebase/authService.ts` | `fetchAllUsers`, `updateUserRoles`, `updateUserProfile`, `deleteUserProfileAdmin` |
| **developerService** | `services/firebase/developerService.ts` | `recalculateAllAthletesBestPerformanceAndTournamentHistory` |

---

## Data Schema

### Home Carousel (`homeCarousel` collection)
```typescript
type HomeCarouselImage = {
  id: string;
  imageUrl: string;    // Firebase Storage URL
  title: string;
  description?: string;
  link?: string;        // External URL
  order: number;        // Display order
  active: boolean;
  created_at: Date;
  updated_at: Date;
};
```

### Team Recruitment (`team_recruitment`, `individual_recruitment`, `double_recruitment` collections)
```typescript
type TeamRecruitment = {
  id, tournament_id, registration_id,
  team_id, team_name,
  leader_id, leader_name,
  participant_id, participant_name,
  event_id: string | string[],
  event_name: string,
  status: "active" | "closed" | "matched",
  max_members_needed?: number,
  requirements?: string,
  created_at: Date
};

type IndividualRecruitment = {
  id, tournament_id, registration_id,
  participant_id, participant_name,
  event_id, event_name,
  age, gender, country,
  status: "active" | "matched",
  created_at: Date
};

type DoubleRecruitment = {
  id, tournament_id, registration_id,
  participant_id, participant_name,
  event_id, event_name,
  age, gender, country,
  status: "active" | "matched",
  team_id?: string,  // Set after matching
  partner_id?: string,
  created_at: Date
};
```

---

## Firestore Collections

- `homeCarousel` -- Homepage carousel images
- `team_recruitment` -- Team recruitment listings
- `individual_recruitment` -- Individual recruitment listings
- `double_recruitment` -- Double event recruitment
- `users` -- User profiles with roles and `memberId`

---

## FAQ

**Q: Who can access admin pages?**
A: Client-side checks only. `UserManagement` requires `modify_admin`, `TeamRecruitmentManagement` requires `edit_tournament || modify_admin`, `DeveloperSetting` requires `global_id === "00001"`. **Firestore rules are open -- server-side enforcement is missing.**

**Q: How is the homepage carousel managed?**
A: Admins at `/admin/carousel` create, update, delete, reorder, and toggle carousel images. Active images appear on the homepage in a carousel banner.

**Q: How does the team recruitment admin work?**
A: Admins view all recruitment listings across tournaments, filter by tournament, and manage entries -- assign individuals to teams, match double partners, edit team recruitment details.

**Q: What does the developer recalculation do?**
A: It runs `recalculateUserBestTimesByGlobalIds()` for all users, then calls `updateParticipantRankingsAndResults()` for all tournaments across all 4 classifications (prelim, advance, intermediate, beginner).

---

## Related Files

- Schema: `src/schema/RoleSchema.ts`, `src/schema/HomeCarouselSchema.ts`, `src/schema/TeamRecruitmentSchema.ts`, `src/schema/IndividualRecruitmentSchema.ts`, `src/schema/DoubleRecruitmentSchema.ts`
- Services: `src/services/firebase/homeCarouselService.ts`, `src/services/firebase/teamRecruitmentService.ts`, `src/services/firebase/individualRecruitmentService.ts`, `src/services/firebase/doubleRecruitmentService.ts`, `src/services/firebase/authService.ts`, `src/services/firebase/developerService.ts`
- Home page: `src/pages/Home/Home.tsx` (consumes carousel data)
- Auth context: `src/context/AuthContext.tsx`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Initial deep scan. All 5 admin pages documented: AdminPermission (role management), UserManagement (user CRUD), CarouselManagement (carousel CRUD), TeamRecruitmentManagement (3-tab recruitment admin), DeveloperSetting (global recalculation). |
| 2026-04-10 | Module level documented from deep scan. |