[Root Directory](../CLAUDE.md) > **Home Module**

---

# Home Module

**Path**: `src/pages/Home/` + `src/services/firebase/homeCarouselService.ts` + `src/services/firebase/homeTournamentService.ts`

**Responsibility**: Public homepage displaying hero carousel banners, upcoming tournaments, and top world records.

---

## Entry Point

| Page | Route | File |
|------|-------|------|
| Home | `/` | `src/pages/Home/Home.tsx` |

---

## Data Sources

| Data | Service | Function |
|------|---------|----------|
| Carousel Images | `homeCarouselService.ts` | `getActiveCarouselImages()` |
| Upcoming Tournaments | `homeTournamentService.ts` | `getNextTournaments(n)` |
| World Records | `recordService.ts` | `getBestRecords()` |

---

## Homepage Layout

1. **Hero Carousel** -- Full-width banner from `home_carousel` Firestore collection, auto-playing with dot indicators
2. **Two-Column Grid** (md+):
   - Left: Upcoming Tournaments card with status badges
   - Right: Best Records card showing top 3-3-3, 3-6-3, and Cycle records
3. **Benefits Section** -- Static cards (Hand-Eye Coordination, Brain Activation, Fine Motor Skills)
4. **Call to Action** -- Buttons to Tournaments and Records pages
5. **Image Detail Modal** -- Opens when clicking a carousel image

### Tournament Status Badges
| Status | Color |
|--------|-------|
| Up Coming | Primary blue |
| On Going | Success green |
| Close Registration | Warning orange |
| End | Neutral gray |

---

## Services

| Service | File | Key Functions |
|---------|------|---------------|
| **homeCarouselService** | `src/services/firebase/homeCarouselService.ts` | `getActiveCarouselImages`, `createCarouselImage`, `updateCarouselImage`, `deleteCarouselImage`, `toggleCarouselActive` |
| **homeTournamentService** | `src/services/firebase/homeTournamentService.ts` | `getNextTournaments` |

---

## FAQ

**Q: How are carousel images managed?**
A: Admins create/update/delete carousel images from `/admin/carousel`. Only `isActive: true` images appear on the homepage.

**Q: What tournaments appear on the homepage?**
A: The next 3 non-draft tournaments sorted by start date. Managed via `homeTournamentService.getNextTournaments(3)`.

**Q: What records are shown on the homepage?**
A: The top (fastest) record for each of the three individual events: 3-3-3, 3-6-3, and Cycle. Pulled from the first entry of each event bucket in `getBestRecords()`.

---

## Related Files

- Schema: `src/schema/HomeCarouselSchema.ts`, `src/schema/TournamentSchema.ts`
- Services: `src/services/firebase/homeCarouselService.ts`, `src/services/firebase/homeTournamentService.ts`
- Admin: `src/pages/Admin/CarouselManagement.tsx`

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 | Module documented. Homepage layout, data sources, services, and FAQ created. |
