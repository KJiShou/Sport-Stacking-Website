[Root Directory](../CLAUDE.md) > **Utilities Module**

---

# Utilities Module

**Path**: `src/utils/`

**Responsibility**: Pure utility functions and helpers shared across the application. Organized into subdirectories by domain: PDF export, date formatting, device inspection, tournament logic, team helpers, and miscellaneous helpers.

---

## Directory Structure

```
src/utils/
├── Date/
│   └── formatDate.ts            # Smart date formatting (handles Timestamp, Date, Dayjs, string)
├── DeviceInspector/
│   ├── deviceStore.ts           # Jotai atoms: breakpoint, orientation, network, language
│   ├── DeviceInspector.tsx     # Device info modal (Ctrl+Alt+I or 3-finger tap)
│   └── index.tsx                # Barrel re-export + hooks (useDeviceBreakpoint, etc.)
├── PDF/
│   └── pdfExport.ts             # jsPDF-based PDF generation (participant lists, results, certificates)
├── SenderGrid/
│   └── sendMail.ts              # Frontend email sender (calls Cloud Function endpoint)
├── tournament/
│   ├── eventUtils.ts            # Event key matching, labeling, grouping, team event helpers
│   ├── finalistStyling.ts       # Finalist classification visual styles (advance/intermediate/beginner)
│   └── resultAggregation.ts     # Core scoring aggregation engine (individual + team, single + multi-code)
├── countryFlags.ts               # Country name -> ISO code -> flag icon URL mapping
├── genderLabel.ts               # Gender label formatter
├── teamLeaderId.ts              # Team leader ID prefix formatter (D/P/T prefix for Double/Parent/Team Relay)
├── teamVerification.ts          # Team verification status helpers
├── time.ts                      # Time formatting (stacking time, safe date)
└── validation/
    └── validateAgeBrackets.tsx  # Age bracket validation (no overlap, required fields)
```

---

## Key Utilities

### `resultAggregation.ts` (~390 lines)

Core tournament scoring engine. Computes ranked results per event/bracket/classification.

**Key function**: `computeEventBracketResults(event, bracket, context, classification?)`
- `context`: `{ allRecords, teamMap, teamNameMap, ageMap, registrationMap, nameMap }`
- Handles 4 cases:
  1. **Team + multi-code** (e.g., Combined 3-3-3+3-6-3+Cycle): Sums all codes, sorts by total
  2. **Team + single-code** (e.g., Cycle): Sorts by individual best time
  3. **Individual + multi-code** (e.g., 3-3-3+3-6-3+Cycle Overall): Sums all codes, sorts
  4. **Individual + single-code**: Sorts by individual best time

**Result shape**: `AggregatedResultRow` -- contains rank, bestTime, secondBestTime, thirdBestTime, and dynamic fields for each code's Best/Second/Third/Try1-3.

**Used by**: `ScoringPage.tsx`, `FinalScoringPage.tsx`, `PrintResultsPage.tsx`, `pdfExport.ts`

### `eventUtils.ts` (~352 lines)

Event matching and labeling utilities for tournament forms and scoring pages.

**Key exports**:
- `isTeamEvent(event)` -- returns true for Double, Team Relay, Parent & Child
- `matchesEventKey(value, event)` -- fuzzy match by id, type, label, or code
- `groupEventSelections(values, events)` -- groups raw string selections into `EventSelectionGroup[]`
- `getEventLabel(event)` -- human-readable: "Individual - Male (3-3-3)"
- `findDuplicateEventSelections()` -- detects duplicate selections in form input
- `getTeamEvents(team, events)` -- resolves which tournament events a team belongs to
- `TEAM_EVENT_TYPES` -- Set of team event type strings

### `pdfExport.ts` (~2044 lines, `@ts-nocheck`)

Full-featured PDF export using `jspdf` + `jspdf-autotable`.

**Export functions**:
| Function | Description |
|----------|-------------|
| `exportParticipantListToPDF` | Per-event/bracket participant name list |
| `exportMasterListToPDF` | All participants with events registered |
| `exportAllPrelimResultsToPDF` | Full prelim results with classification color coding |
| `exportFinalistsNameListToPDF` | Finalist roster by event/bracket |
| `exportAllBracketsListToPDF` | All events with their brackets |
| `exportNameListStickerPDF` | 2-column sticker format (A4) |
| `exportLargeNameListStickerPDF` | 1-column large stickers |
| `generateStackingSheetPDF` | Individual time sheets (2 per page) |
| `generateTeamStackingSheetPDF` | Team time sheet |
| `exportCombinedTimeSheetsPDF` | Combined sheets for mixed participants |
| `exportCertificatesPDF` | Award certificates with decorative styling |

**Stacking sheet includes**: Logo headers, participant info, time table (Try 1/2/3/Best), judge signature box, scratch key (S1-S6), and official instructions.

### `DeviceInspector/` (~3 files)

Jotai-based responsive design utilities.

**Store atoms**:
- `deviceBreakpointAtom` -- `xs(240)` through `6xl(4096)` (from Tailwind breakpoints)
- `deviceOrientationAtom` -- PORTRAIT/LANDSCAPE
- `deviceNetworkStatusAtom` -- Online/Offline
- `deviceLanguageAtom` -- Persisted to localStorage via `atomWithStorage`

**Hooks**: `useDeviceBreakpoint`, `useDeviceOrientation`, `useDeviceNetworkStatus`, `useDeviceLanguage`

**DeviceInspector component**: Hidden component that listens to `resize` events, 3-finger touch, and `Ctrl+Alt+I` shortcut. Opens a modal with OS, browser, resolution, pixel ratio, color depth, and touch screen info.

### `finalistStyling.ts`

Finalist classification visual system (Advance/Intermediate/Beginner/Prelim) with per-classification colors for table row highlighting.

**Key**: `buildFinalistClassificationMap(records, eventCodes, criteria)` -- maps record IDs to their finalist classification.

### `teamLeaderId.ts`

Team leader ID formatting:
- `D{num}` for Double events
- `P{num}` for Parent & Child events
- `T{num}` for Team Relay events

### `validateAgeBrackets.tsx`

Validates age bracket arrays:
- All fields required
- `min_age <= max_age`
- No overlapping ages across brackets

### `time.ts`

- `formatStackingTime(time)` -- formats seconds to `M:SS.mmm` or `SS.mmm`, handles rounding overflow
- `formatDateSafe(value)` -- null-safe date formatter (Date/string/number), returns "—" on failure

### `countryFlags.ts`

- `getCountryFlag(countryName)` -- returns flag icon URL
- `getCountryCode(countryName)` -- returns ISO 3166-1 alpha-2 code
- `hasCountryFlag(countryName)` -- boolean check
- `getFlagIconUrl(code, style)` -- returns URL from `flagicons.lipis.dev`
- Maps ~200 country names to ISO codes

### `genderLabel.ts`

- `formatGenderLabel(gender)` -- "Mixed" -> "Mixed Gender", others unchanged

### `SenderGrid/sendMail.ts`

- `sendProtectedEmail(gmail, tournamentId, teamId, memberId, registrationId)` -- calls the Cloud Function endpoint with Firebase ID token. Skipped in dev if no custom endpoint set.

---

## Design Patterns

- **Pure functions**: All utilities are side-effect-free except `DeviceInspector` (event listeners) and `pdfExport.ts` (DOM/async)
- **No schema dependency**: Utils accept raw data and return structured results
- **Aggregation is centralized**: `resultAggregation.ts` is the single source of truth for scoring computation
- **PDF is self-contained**: `pdfExport.ts` handles its own logo loading, layout, and table generation

---

## Related Files

- Consumed by: `ScoringPage.tsx`, `FinalScoringPage.tsx`, `PrintResultsPage.tsx`, `ParticipantListPage.tsx`, `ScoreSheetPage.tsx`, `TournamentList.tsx`, `RegisterTournament.tsx`, `pdfExport.ts`
- Schema dependencies: `src/schema/RecordSchema.ts`, `src/schema/TournamentSchema.ts`
- Services: `src/services/firebase/recordService.ts`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 09:10 | Module documented. All 11 utility files documented: result aggregation engine, event utilities, PDF exports (13 functions), device inspector, team helpers, time/country/gender formatters, validation, email sender. |
