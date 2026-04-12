[Root Directory(../../../CLAUDE.md) > [src/pages/Tournaments/](../) > **Tournaments Scoring Module**

---

# Tournaments Scoring Module

**Path**: `src/pages/Tournaments/Scoring/`, `src/pages/Tournaments/ScoreSheet/`, `src/pages/Tournaments/PrintResults/`, `src/pages/Tournaments/PrelimResults/`, `src/pages/Tournaments/FinalResults/`

**Responsibility**: Real-time tournament scoring (prelim/final), results display, PDF export/print, and public score sheet sharing.

---

## Pages

| Page | Route | File | Description |
|------|-------|------|-------------|
| **ScoringPage** | `/tournaments/:id/start/record` | `Scoring/ScoringPage.tsx` | Prelim scoring -- enter try1/try2/try3 for each participant by event + age bracket |
| **FinalScoringPage** | `/tournaments/:id/scoring/final` | `Scoring/FinalScoringPage.tsx` | Final scoring -- same UI but for finalist groups with classification tabs |
| **ScoreSheetPage** | `/score-sheet/:id/:round` | `ScoreSheet/ScoreSheetPage.tsx` | Public shareable score sheet (no auth required) with finalist classification color coding |
| **PrintResultsPage** | `/tournaments/:id/print-results` | `PrintResults/PrintResultsPage.tsx` | Print/export results as PDF (prelim, final, certificates) |
| **PrelimResultsPage** | `/tournaments/:id/record/prelim` | `PrelimResults/PrelimResultsPage.tsx` | Prelim results display with edit/verify/modify |
| **FinalResultsPage** | `/tournaments/:id/record/final` | `FinalResults/FinalResultsPage.tsx` | Final results display with edit/verify/modify |

---

## Scoring Flow

```
Tournament Recorder enters scores
    |
    v
ScoringPage.tsx (prelim)
    -> Validates all three tries (try1, try2, try3 > 0)
    -> Computes best_time = min(try1, try2, try3)
    -> Saves to Firestore: prelim_records collection
    -> Updates local state with record IDs
    -> Calls updateParticipantRankingsAndResults(tournamentId, "prelim")
    -> [Cloud Function] updateUserBestTimes trigger (skips prelim)
    -> [Cloud Function] syncUserTournamentHistory trigger
    -> If Individual event: calculateOverallResults (saves to overall_records)
    -> Navigate to PrelimResultsPage

Tournament Recorder completes bracket
    -> "Prelim Done" button validates all participants in current bracket
    -> updateParticipantRankingsAndResults called per classification
    -> Navigate to PrelimResultsPage

Finalists selected based on age bracket final_criteria
    |
    v
FinalScoringPage.tsx (final)
    -> Tabbed by Event -> Age Bracket -> Classification (advance/intermediate/beginner)
    -> Saves to Firestore: records collection (not prelim_records)
    -> [Cloud Function] updateUserBestTimes trigger fires (best time comparison)
    -> [Cloud Function] syncUserTournamentHistory trigger fires
    -> calculateOverallResults for Individual events
    -> "Final Done" button calls updateParticipantRankingsAndResults for all final classifications
    -> Navigate to FinalResultsPage
```

---

## New Record Detection

Both `ScoringPage.tsx` and `FinalScoringPage.tsx` include a `checkAndNotifyNewRecord` function that:

1. Fetches global best records via `getBestRecords()`
2. Compares new time against current best for the same age
3. If new time is faster, shows a `Modal.info` with:
   - Time improvement (seconds saved)
   - Link to ISSF world records page
   - Age group label (6U, 8U, 10U, 12U, 14U, 17U, Open)

This runs client-side for every saved record.

---

## Age Group Mapping

```typescript
function getAgeGroup(age: number): string {
    if (age <= 6) return "6U";
    if (age <= 8) return "8U";
    if (age <= 10) return "10U";
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    if (age <= 17) return "17U";
    return "Open";
}
```

---

## Validation Logic

All scoring pages validate:
- All three tries must be present and > 0
- Score completeness check before allowing "Done" (Prelim Done / Final Done)
- Real-time status column ("Complete" / "Incomplete") per participant
- Search by Global ID or Name

---

## Results Aggregation

`PrintResultsPage.tsx` uses a shared aggregation system:
- `computeEventBracketResults()` from `src/utils/tournament/resultAggregation.ts`
- `buildFinalistClassificationMap()` from `src/utils/tournament/finalistStyling.ts`
- `AggregationContext` type for passing records + registration/team maps

PDF export functions in `src/utils/PDF/pdfExport.ts`:
- `exportAllPrelimResultsToPDF()` -- results table with finalist highlighting
- `exportCertificatesPDF()` -- participant certificates with times and placement
- `exportCombinedTimeSheetsPDF()` -- combined time sheets
- `exportFinalistsNameListToPDF()` -- finalist roster

---

## ScoreSheetPage (Public)

`ScoreSheetPage.tsx` is a **public** route -- no authentication required. It:
- Loads data via `getShareScoreSheetData()` from `shareResultService.ts`
- Checks Firestore security rules for read access on `prelim_records`/`records`
- Shows finalist classification color coding via CSS class injection
- Has copy link functionality (requires `edit_tournament` or `verify_record` role)
- Mobile-first design with Drawer for full table view
- Time formatting: `seconds.thousandths` (e.g., "3.456"), `M:SS.mmm` for > 60s

### Finalist Color Coding

```css
.finalist-row--advance td { background: #fdf2f8; border-color: #f9a8d4; }
.finalist-row--intermediate td { background: #fefce8; border-color: #fde047; }
.finalist-row--beginner td { background: #ecfeff; border-color: #67e8f9; }
.finalist-row--prelim td { background: #f7f8fb; border-color: #e6e9f0; }
```

---

## Key Schemas

- `src/schema/RecordSchema.ts` -- TournamentRecordSchema, TournamentTeamRecordSchema, TournamentOverallRecordSchema
- `src/schema/TournamentSchema.ts` -- TournamentEvent, AgeBracket, FinalCriterion

---

## Key Services

| Service | Purpose |
|---------|---------|
| `recordService.ts` | Save/update records (individual, team, overall) |
| `shareResultService.ts` | Build shareable score sheet payload |
| `tournamentsService.ts` | Fetch tournament, events, teams |
| `registerService.ts` | Fetch approved registrations |
| `userBestTimesService.ts` | Client-side best time tracking |

---

## FAQ

**Q: Why does FinalScoringPage save to `records` instead of `prelim_records`?**
A: Final scores are stored in the `records` collection (final records), while prelim scores go to `prelim_records`. The Cloud Functions `updateUserBestTimes` only triggers on `records` (not `prelim_records`), so final scores update global best times.

**Q: How does the score sheet page get public access?**
A: The `ScoreSheetPage` relies on Firestore security rules for `prelim_records` and `records` collections. If rules allow public read, anyone can view. The "Copy Link" button requires auth role.

**Q: How is overall time calculated for Individual events?**
A: Client-side in both `ScoringPage` and `FinalScoringPage`: best_333 + best_363 + best_cycle = overall_time. Saved as `TournamentOverallRecord` in `overall_records` collection.

---

## Related Files

- Cloud Functions: `functions/src/index.ts` (best times sync, history sync)
- PDF utilities: `src/utils/PDF/pdfExport.ts`
- Result aggregation: `src/utils/tournament/resultAggregation.ts`
- Finalist styling: `src/utils/tournament/finalistStyling.ts`
- Event utilities: `src/utils/tournament/eventUtils.ts`
- Tournament schema: `src/schema/TournamentSchema.ts`
- Record schema: `src/schema/RecordSchema.ts`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Full scoring lifecycle, new record detection, PDF export, and public score sheet documented. |