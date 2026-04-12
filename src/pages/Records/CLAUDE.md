[Root Directory](../CLAUDE.md) > **Athletes & Records Module**

---

# Athletes & Records Module

**Path**: `src/pages/Athletes/`, `src/pages/Records/`, `src/services/firebase/athleteRankingsService.ts`, `src/services/firebase/userBestTimesService.ts`, `src/services/firebase/recordService.ts`

**Responsibility**: Athlete directory, global rankings, personal best time tracking, and records aggregation across all tournaments.

---

## Entry Points

| Page | Route | File |
|------|-------|------|
| Athletes Directory | `/athletes` | `src/pages/Athletes/Athletes.tsx` |
| Athlete Profile | `/athletes/:athleteId` | `src/pages/Athletes/AthleteProfile.tsx` |
| Global Records | `/records` | `src/pages/Records/index.tsx` |

---

## Data Schema

Key schema: `src/schema/RecordSchema.ts`, `src/schema/UserSchema.ts`

### Record Schemas
```typescript
// TournamentRecord (individual)
{
  id, tournament_id, event_id,
  event, code: "3-3-3" | "3-6-3" | "Cycle",
  participant_id, participant_global_id, participant_name,
  gender, country, age,
  best_time, try1, try2, try3,
  status: "submitted" | "verified",
  classification: "prelim" | "advance" | "intermediate" | "beginner",
  video_url, verified_by, verified_at
}

// TournamentTeamRecord
{
  ...TournamentRecord,
  team_id, team_name,
  member_global_ids[], leader_id
}

// TournamentOverallRecord
{
  ...TournamentRecord,
  three_three_three, three_six_three, cycle, overall_time
}

// RecordDisplay (UI transformed)
{
  key, rank, event, gender, time, athlete, country,
  ageGroup, age, status, videoUrl, rawTime,
  recordId, participantId, teamName, members[], leaderId,
  tournament_name, tournamentId
}
```

### User Best Times (Firestore `users` collection)
```typescript
best_times: {
  "3-3-3": {time: number, updated_at: Timestamp, season: string},
  "3-6-3": {time: number, updated_at: Timestamp, season: string},
  "Cycle": {time: number, updated_at: Timestamp, season: string},
  "Overall": {time: number, updated_at: Timestamp, season: string}
}
// Overall is derived from sum of 3 individual best times, not a direct record
```

---

## Services

| Service | File | Key Functions |
|---------|------|---------------|
| **athleteRankingsService** | `src/services/firebase/athleteRankingsService.ts` | `getTopAthletesByEvent`, `getTopAthletesByEventAndGender`, `getTopAthletesByEventAndAge`, `getAthleteRankingByEvent`, `getAthleteBestTimes`, `getAllAroundAthletes` |
| **userBestTimesService** | `src/services/firebase/userBestTimesService.ts` | `updateUserBestTime`, `updateUserBestTimes`, `recalculateUserBestTimesByGlobalIds`, `deriveOverallFromIndividualBests` |
| **recordService** | `src/services/firebase/recordService.ts` | `getBestRecords`, `saveRecord`, `saveTeamRecord`, `saveOverallRecord`, `getTournamentRecords`, `deleteRecord`, `toggleRecordVerification`, `updateRecordVideoUrl`, `getParticipantRankingsAndResults` |

---

## Rankings Architecture

### Client-Side Rankings (`athleteRankingsService`)
- Queries `users` collection filtered by `best_times.{event}.time > 0`
- Ordered by best time ascending (lower = better)
- Supports filtering by gender and age group (age filtering is in-memory)
- Global ranking computed by counting athletes with better times

### Global Records Aggregation (`recordService.getBestRecords`)
- Loads ALL records from `records` and `overall_records` collections
- Filters out `classification: "prelim"` records
- Groups by category (Individual, Double, Team Relay, Parent & Child, Special Need) and event type
- Sorts by time ascending, ties broken by `created_at` (earlier wins)
- Returns a nested shape: `Record<Category, Record<EventType, GlobalResult[]>>`

### Cloud-Side Best Times Sync (`functions/src/index.ts`)
| Function | Trigger | Behavior |
|----------|---------|----------|
| `updateUserBestTimes` | `records/{id}` written | Updates user's `best_times` if new time is lower (non-prelim only) |
| `updateUserBestTimesFromOverall` | `overall_records/{id}` written | Updates individual event best times from overall record |
| `syncUserTournamentHistory*` (3 variants) | Any of `records/prelim_records/overall_records` written | Aggregates all tournament history into `user_tournament_history` |

---

## Record Categories

| Category | Events | Age Groups | Storage |
|----------|--------|-----------|---------|
| **Individual** | 3-3-3, 3-6-3, Cycle, Overall | 5-70+ in 1-2yr bands | `records` + `overall_records` |
| **Double** | Cycle | 8&Under, 10&Under, 13&Under, 14-19, 20-29, 30-39, 40-49, 50++ | `records` (team) |
| **Team Relay** | Cycle, 3-6-3 | 9U, 10-14, 15-20, 21-29, 30-39, 40-49, 50++ | `records` (team) |
| **Parent & Child** | Cycle | Open | `records` (team) |
| **Special Need** | 3-3-3, 3-6-3, Cycle | Open | `records` |

---

## Season Labeling

Best times include a season label (`YYYY-YYYY`) derived from the current date:
- If month >= 6: season = `YYYY-(YYYY+1)` (e.g., "2025-2026" starting July)
- If month < 6: season = `(YYYY-1)-YYYY` (e.g., "2024-2025" starting January)

---

## Athletes Directory Page (`src/pages/Athletes/Athletes.tsx`)

A large (~780 lines) ranking table with multi-dimensional filtering.

### Features
- **Event selection**: Individual 3-3-3, 3-6-3, Cycle, Overall (via `Select` dropdown)
- **Filters**: Search by name/ID, Age group (17 options from "Age 5 & Under" to "Age 70++"), Gender (All/Male/Female), Country (from data), Season (auto-derived from data)
- **Ranking computation**: Loads top 500 athletes per event from `getTopAthletesByEvent`, computes age at record time (not current date), sorts by time ascending
- **Responsive columns**: Country, Age, Season columns hidden on mobile (`useDeviceBreakpoint`)
- **Links**: Each athlete name links to `/athletes/:participantId` (via `Link` component)

### Data Flow
```
loadRankingData()
  -> Promise.all(individualEvents.map(evt => getTopAthletesByEvent(evt, 500)))
  -> for each user: derive age at record time, determine season, extract best_times
  -> Map<key, AthleteRankingEntry> -> sorted by eventTime
  -> filtered by age/gender/location/season/search -> rankedRows
```

---

## Athlete Profile Page (`src/pages/Athletes/AthleteProfile.tsx`)

Individual athlete detail page showing personal bests, rankings, and tournament history.

### Features
- **Dual ID lookup**: Tries `getUserByGlobalId(athleteId)` first, then falls back to `fetchUserByID(athleteId)` (for routes passing Firebase UID)
- **Ranking resolution**: Loads all 4 event rankings (top 1000 each), finds athlete's position in each
- **Best Times table**: Shows time, global rank (#), season, last updated -- formatted with `formatStackingTime`
- **Tournament history**: Shows only `status: "approved"` registrations from `user.registration_records` -- with prelim/final rank and overall times
- **Age calculation**: Computed from `birthdate` relative to `updated_at` timestamp (not current date)

### Key UI Patterns
- `Spin` loading state with "Loading athlete profile..."
- `Result` error state with "Go Back" button
- Responsive layout: Avatar + info on top (mobile) or left (desktop)
- `Tag` for ID badge, global rank, season

---

## FAQ

**Q: How is "Overall" best time calculated?**
A: It's the sum of `3-3-3` + `3-6-3` + `Cycle` best times, rounded to 3 decimal places. The `userBestTimesService.deriveOverallFromIndividualBests` function computes it, and `Overall` is stored as a separate entry in `best_times`.

**Q: Why are some records marked "verified"?**
A: Admins with `verify_record` role can toggle verification status. Verified records show a green badge. Video URLs can be attached to verified records.

**Q: How does the global ranking work for athletes?**
A: `getAthleteRankingByEvent` counts how many athletes have a better (lower) time, then adds 1. This is computed per-query, not pre-computed.

**Q: What triggers best time recalculation?**
A: When a record is deleted, `recalculateUserBestTimesByGlobalIds` can be called with the affected athlete IDs to recompute their best times from remaining records.

**Q: Why does the Athletes page load top 500 athletes per event?**
A: The page needs to compute rankings client-side. It fetches a large window, then filters and sorts in-memory. This is a performance trade-off -- consider pagination or server-side ranking if dataset grows.

---

## Related Files

- Schema: `src/schema/RecordSchema.ts`, `src/schema/UserSchema.ts`
- Cloud Functions: `functions/src/index.ts` (`updateUserBestTimes`, `updateUserBestTimesFromOverall`, `syncUserTournamentHistoryFrom*`)
- Utils: `src/utils/time.ts`, `src/utils/genderLabel.ts`, `src/utils/countryFlags.ts`
- Pages: `src/pages/Athletes/Athletes.tsx`, `src/pages/Athletes/AthleteProfile.tsx`, `src/pages/Records/index.tsx`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Rankings architecture (client vs cloud), record category table, season labeling, and FAQ created. |
| 2026-04-10 09:10 | Deep scan Athletes.tsx and AthleteProfile.tsx: document filters, ranking computation, data flow, profile lookup logic, age-at-record-time calculation. |
