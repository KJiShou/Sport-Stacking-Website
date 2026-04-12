[Root Directory](../CLAUDE.md) > **Tournaments Module**

---

# Tournaments Module

**Path**: `src/pages/Tournaments/` + `src/services/firebase/tournamentsService.ts` + `src/services/firebase/registerService.ts` + `src/services/firebase/finalistService.ts`

**Responsibility**: Full lifecycle management of sport stacking tournaments -- creation, event configuration, participant registration, team formation, scoring, and results publication.

---

## Entry Points

| Page | Route | File |
|------|-------|------|
| Tournament List | `/tournaments` | `src/pages/Tournaments/Tournaments.tsx` |
| Create Tournament | `/tournaments/create` | `src/pages/Tournaments/CreateTournaments/CreateTournaments.tsx` |
| Tournament View | `/tournaments/:id/view` | `src/pages/Tournaments/Component/TournamentView.tsx` |
| Tournament Register | `/tournaments/:id/register` | `src/pages/Tournaments/RegisterTournaments/RegisterTournament.tsx` |
| View Registration | `/tournaments/:id/register/:global_id/view` | `src/pages/Tournaments/RegisterTournaments/ViewRegistration/ViewRegisterTournament.tsx` |
| Registrations List | `/tournaments/:id/registrations` | `src/pages/Tournaments/RegistrationsList/RegistrationsList.tsx` |
| Edit Registration | `/tournaments/:id/registrations/:rid/edit` | `src/pages/Tournaments/RegistrationsList/EditRegistration/EditRegistration.tsx` |
| Participant List | `/tournaments/:id/participants` | `src/pages/Tournaments/ParticipantList/ParticipantListPage.tsx` |
| Start Scoring | `/tournaments/:id/start/record` | `src/pages/Tournaments/Scoring/ScoringPage.tsx` |
| Prelim Results | `/tournaments/:id/record/prelim` | `src/pages/Tournaments/PrelimResults/PrelimResultsPage.tsx` |
| Final Scoring | `/tournaments/:id/scoring/final` | `src/pages/Tournaments/Scoring/FinalScoringPage.tsx` |
| Final Results | `/tournaments/:id/record/final` | `src/pages/Tournaments/FinalResults/FinalResultsPage.tsx` |
| Print Results | `/tournaments/:id/print-results` | `src/pages/Tournaments/PrintResults/PrintResultsPage.tsx` |
| Score Sheet | `/score-sheet/:id/:round` | `src/pages/Tournaments/ScoreSheet/ScoreSheetPage.tsx` |

> **Scoring sub-module**: Detailed scoring pages (ScoringPage, FinalScoringPage, ScoreSheetPage, PrintResultsPage) are documented in [`Scoring/CLAUDE.md`](./Scoring/CLAUDE.md).

---

## Data Schema

Key schema: `src/schema/TournamentSchema.ts`

```typescript
// Tournament
{
  id, name, country, address, venue, agenda, description, logo,
  status: "Up Coming" | "On Going" | "Close Registration" | "End",
  start_date, end_date,
  registration_start_date, registration_end_date,
  registration_fee, member_registration_fee,
  max_participants, participants,
  editor, recorder,          // User IDs of assigned staff
  isDraft: boolean,
  payment_methods: PaymentMethod[],
  events: TournamentEvent[]
}

// TournamentEvent
{
  id, tournament_id,
  type: "Individual" | "Open Age Individual" | "Double" | "Team Relay" | "Parent & Child" | "Special Need",
  codes: ("3-3-3" | "3-6-3" | "Cycle")[],
  gender: "Male" | "Female" | "Mixed",
  teamSize, max_participants,
  additional_fee_enabled, additional_fee,
  age_brackets: AgeBracket[]
}

// AgeBracket
{
  name, min_age, max_age,
  number_of_participants,
  final_criteria: FinalCriterion[]
}

// FinalCriterion
{
  classification: "advance" | "intermediate" | "beginner" | "prelim",
  number  // number of finalists
}
```

---

## Services

| Service | File | Key Functions |
|---------|------|---------------|
| **TournamentsService** | `src/services/firebase/tournamentsService.ts` | `fetchTournaments`, `fetchTournamentById`, `fetchTournamentEvents`, `fetchTeamsByTournament`, `createTournament`, `updateTournament` |
| **RegisterService** | `src/services/firebase/registerService.ts` | `createRegistration`, `updateRegistration`, `fetchRegistrations`, `fetchApprovedRegistrations`, `deleteRegistration` |
| **FinalistService** | `src/services/firebase/finalistService.ts` | `fetchTournamentFinalists`, `saveFinalists`, `deriveFinalists` |
| **ScoringService** | `src/services/firebase/recordService.ts` | `saveRecord`, `saveTeamRecord`, `saveOverallRecord`, `getTournamentRecords`, `getTournamentFinalRecords`, `getTournamentPrelimRecords`, `getParticipantRankingsAndResults` |
| **VerificationRequestService** | `src/services/firebase/verificationRequestService.ts` | `createVerificationRequest`, `fetchVerificationRequests` |

---

## Tournament Lifecycle

```
[Create] -> [Configure Events & Age Brackets] -> [Open Registration]
                                                              |
    -> [Close Registration] -> [Start Scoring (Prelim)] -> [Publish Prelim Results]
                                                              |
    -> [Final Scoring] -> [Publish Final Results] -> [Print/Export]
```

### Registration Flow
1. User browses tournament and clicks "Register"
2. Selects events based on age brackets
3. For team events: team leader creates/joins team via `TeamRecruitmentService`
4. Team members receive email verification link (via Cloud Function `sendEmail`)
5. Member clicks link -> `VerifyPage.tsx` -> `updateVerification` Cloud Function
6. After verification, user events are added to registration

### Scoring Flow
1. Tournament recorder (role: `record_tournament`) starts scoring at `/tournaments/:id/start/record`
2. Scores entered for each participant: `try1`, `try2`, `try3`, `best_time`
3. Prelim results displayed at `/tournaments/:id/record/prelim`
4. Finalists selected based on `final_criteria` per age bracket
5. Final scoring at `/tournaments/:id/scoring/final`
6. Final results at `/tournaments/:id/record/final`

---

## Key Types

```typescript
// Team and recruitment
type TeamMember = {global_id: string; verified: boolean; name?: string};
type Team = {
  id, name, tournament_id, leader_id,
  event_id: string | string[],
  members: TeamMember[],
  event?: string | string[]
};
type Registration = {
  id, user_id, user_global_id, tournament_id,
  events_registered: string[],
  status: "pending" | "approved" | "rejected"
};
type VerificationRequest = {
  target_global_id, tournament_id, team_id,
  registration_id, status: "pending" | "verified",
  event_label, team_name, leader_label
};
```

---

## Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| `TournamentList` | `Component/TournamentList.tsx` | Filterable tournament list with status badges |
| `TournamentView` | `Component/TournamentView.tsx` | Tournament detail page with tabs |
| `AgeBracketModal` | `Component/AgeBracketModal.tsx` | Age bracket editor modal |
| `EventField` | `Component/EventField.tsx` | Event type selector |
| `FinalCategoriesFields` | `Component/FinalCategoriesFields.tsx` | Finalist category config |
| `FinalCriteriaFields` | `Component/FinalCriteriaFields.tsx` | Number of finalists per classification |
| `LocationPicker` | `Component/LocationPicker.tsx` | Venue location input with Google Maps |
| `useAgeBracketEditor` | `Component/useAgeBracketEditor.tsx` | Hook for age bracket editing state |

---

## Firestore Collections Used

- `tournaments` -- Main tournament documents
- `events` -- Event subcollection per tournament (via `tournament_id`)
- `registrations` -- Tournament signups
- `teams` -- Team records
- `records` -- Final (non-prelim) results
- `prelim_records` -- Preliminary results
- `overall_records` -- Overall event results
- `individual_recruitment` -- Individual recruitment listings
- `double_recruitment` -- Double event recruitment
- `team_recruitment` -- Team recruitment listings
- `verification_requests` -- Team verification workflow
- `finalists` -- Finalist group assignments

---

## FAQ

**Q: How are team event conflicts prevented?**
A: The `updateVerification` Cloud Function checks both the `teams` collection and the user's `registration_records` to detect overlapping event registrations. It prevents verification if the athlete is already registered for the same event in another team.

**Q: How is scoring persisted?**
A: Scores are saved to `prelim_records` (for prelim) or `records` (for final). Individual records use `TournamentRecordSchema`, team records use `TournamentTeamRecordSchema`, and overall (sum of 3 events) use `TournamentOverallRecordSchema`.

**Q: How are finalists determined?**
A: Each `TournamentEvent` has `age_brackets`, and each `AgeBracket` has `final_criteria` specifying how many from each classification (`advance`, `intermediate`, `beginner`) advance to finals.

**Q: What happens to best times after scoring?**
A: The `ScoringPage` calls `updateUserBestTime` (client-side) for each saved record. Additionally, the Cloud Functions `updateUserBestTimes` and `updateUserBestTimesFromOverall` trigger on Firestore writes to `records` and `overall_records`.

---

## Related Files

- Schema: `src/schema/TournamentSchema.ts`, `src/schema/RegistrationSchema.ts`, `src/schema/TeamSchema.ts`, `src/schema/FinalistSchema.ts`
- Services: `src/services/firebase/tournamentsService.ts`, `src/services/firebase/registerService.ts`, `src/services/firebase/recordService.ts`, `src/services/firebase/finalistService.ts`, `src/services/firebase/teamRecruitmentService.ts`
- Cloud Functions: `functions/src/index.ts` (`sendEmail`, `updateVerification`, `syncUserTournamentHistory*`, `updateUserBestTimes*`)
- Scoring sub-module: [`src/pages/Tournaments/Scoring/CLAUDE.md`](./Scoring/CLAUDE.md)

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Full route table, lifecycle flow, data schemas, and service inventory created. |
| 2026-04-10 | Added reference to Scoring sub-module at `Scoring/CLAUDE.md` for detailed scoring page documentation. |