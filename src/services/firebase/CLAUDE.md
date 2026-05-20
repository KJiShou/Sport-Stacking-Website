[Root Directory](../../CLAUDE.md) > **Services (Firebase)**

---

# Services Module (Firebase)

**Path**: `src/services/firebase/`

**Responsibility**: All Firestore data access layer -- auth, tournaments, registrations, records, teams, recruitment, verification, storage, and rankings. Single source of truth for all database interactions from the frontend.

---

## Service Inventory (19 files)

| Service | File | Purpose |
|---------|------|---------|
| **config** | `config.ts` | Firebase SDK init, App Check (ReCAPTCHA v3), multi-DB support |
| **authService** | `firebase/authService.ts` | Auth operations + user CRUD + team management + registration orchestration |
| **firestoreService** | `firebase/firestoreService.tsx` | Empty bridge (1 line), unused |
| **tournamentsService** | `firebase/tournamentsService.ts` | Tournament CRUD, events, teams, team creation, age calculation |
| **registerService** | `firebase/registerService.ts` | Registration create/update/delete with capacity checking |
| **recordService** | `firebase/recordService.ts` + `firebase/recordService.js` | Record CRUD (individual, team, overall), best time updates, ranking computation |
| **verificationRequestService** | `firebase/verificationRequestService.ts` | Verification request CRUD, real-time count subscription |
| **finalistService** | `firebase/finalistService.ts` | Finalist group management |
| **shareResultService** | `firebase/shareResultService.ts` | Score sheet sharing data (public read, no auth required) |
| **homeCarouselService** | `firebase/homeCarouselService.ts` | Carousel image CRUD with Storage upload |
| **teamRecruitmentService** | `firebase/teamRecruitmentService.ts` | Team/individual/double recruitment CRUD |
| **individualRecruitmentService** | `firebase/individualRecruitmentService.ts` | Individual recruitment CRUD |
| **doubleRecruitmentService** | `firebase/doubleRecruitmentService.ts` | Double pairing recruitment CRUD |
| **athleteRankingsService** | `firebase/athleteRankingsService.ts` | Top athletes by event/gender/age |
| **userBestTimesService** | `firebase/userBestTimesService.ts` | Client-side best time tracking with season labels |
| **userHistoryService** | `firebase/userHistoryService.ts` | User tournament history aggregation |
| **storageService** | `firebase/storageService.ts` | Avatar and general file upload/download |
| **developerService** | `firebase/developerService.ts` | Global recalculation (best times + rankings) |
| **authService (auth/)** | `auth/CLAUDE.md` | Separate auth UI components module |

---

## Key Service Dependencies

```
authService.ts
  -> config.ts (db, auth, storage)
  -> doubleRecruitmentService.ts
  -> individualRecruitmentService.ts
  -> teamRecruitmentService.ts
  -> storageService.ts
  -> userBestTimesService.ts

tournamentsService.ts
  -> config.ts
  -> authService.ts (for team operations)

registerService.ts
  -> config.ts
  -> doubleRecruitmentService.ts
  -> individualRecruitmentService.ts
  -> teamRecruitmentService.ts
  -> verificationRequestService.ts

recordService.ts
  -> config.ts
  -> tournamentsService.ts
  -> userBestTimesService.ts

shareResultService.ts
  -> config.ts
  -> recordService.ts
  -> registerService.ts
  -> tournamentsService.ts

developerService.ts
  -> config.ts
  -> recordService.ts
  -> userBestTimesService.ts
```

---

## Common Patterns

### Firestore Collection Naming

Collections referenced: `users`, `tournaments`, `events`, `registrations`, `teams`, `records`, `prelim_records`, `overall_records`, `user_tournament_history`, `homeCarousel`, `team_recruitment`, `individual_recruitment`, `double_recruitment`, `verification_requests`, `finalists`, `counters`, `user_best_times`.

**Note**: `homeCarousel` collection (not `home_carousel` with underscore) is used in `homeCarouselService.ts`.

### Zod Schema Validation

All services use Zod schemas from `src/schema/` for data validation before Firestore writes:
- `TournamentSchema`, `TournamentRecordSchema`, `TournamentTeamRecordSchema`, `TournamentOverallRecordSchema`
- `FirestoreUserSchema`, `TeamSchema`, `RegistrationSchema`
- Event-specific schemas

### Error Handling

All services wrap Firestore operations in try-catch with `console.error` + throw, letting UI pages handle via `Message.error`.

### Real-time Subscriptions

`verificationRequestService.ts` uses `onSnapshot` for real-time pending verification count in the Navbar.

---

## TS/JS Mix Issue

- `recordService.ts` (TypeScript) -- the primary service file with all logic
- `recordService.js` (JavaScript) -- a 2-line bridge file (`export * from "./recordService.ts"`) to help Vite resolve the TS source during dev builds. The `.js` file is a workaround, not a separate implementation.

---

## Data Flow Overview

```
User Action
    |
    v
Page Component (React)
    |
    v
Service Layer (src/services/firebase/*.ts)
    |
    v
Firestore / Storage
    |
    v
Cloud Functions (background triggers)
    -> updateUserBestTimes (on records/prelim_records/overall_records written)
    -> syncUserTournamentHistory* (on records/prelim_records/overall_records written)
    -> sendEmail / updateVerification (on-demand HTTP)
    |
    v
User's best_times / user_tournament_history (updated in background)
```

---

## FAQ

**Q: Why is `firestoreService.tsx` only 1 line?**
A: It appears to be an unused/placeholder file. All actual Firestore operations go through specific service files.

**Q: How is team event conflict detection handled?**
A: The `updateVerification` Cloud Function checks both `teams` collection and `registration_records` on the user document to prevent double-registration in the same event.

**Q: How does the home carousel differ from other services?**
A: It uploads images to Firebase Storage first, then creates a Firestore document. The collection name is `homeCarousel` (camelCase, no underscore).

---

## Related Files

- Firebase config: `src/services/firebase/config.ts`
- Cloud Functions: `functions/src/index.ts`
- Schema definitions: `src/schema/` (27 Zod schemas)
- Auth service barrel: `src/services/auth/CLAUDE.md`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Full service inventory, dependencies, collection naming conventions, and TS/JS mix issue documented. |