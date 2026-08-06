# Mobile UI/UX Audit

## Scope and acceptance sizes

This audit covers every route in `src/config/routes.tsx`, the shared navigation/footer, and the login overlay. The target widths are 360px, 390px, and 430px portrait plus a representative 844px landscape viewport. Desktop behavior remains the source of truth at 768px and above.

The responsive implementation is an incremental baseline. A route is `Verified` only after the desktop, tablet, and mobile viewport pass records screenshots and data-dependent issues. No route is marked `Verified` in this workspace because a browser/device capture pass has not been run yet.

The implementation uses compact expandable tables for ranking data and cards for touch-oriented management lists. Page-level horizontal overflow is not allowed. A table that needs horizontal comparison must show a visible scroll affordance and keep its primary identity columns usable.

## Route checklist

| Route | Primary mobile risk | Implemented treatment | Status / evidence |
| --- | --- | --- | --- |
| `/` | Fixed-height hero and dense card headings | Responsive hero, wrapped headings, full-width mobile actions | Partial — capture pending |
| `/athletes` | Fixed filter widths and wide ranking table | Complete desktop table; tablet expandable rows; mobile Rank/Name/Time table with expandable details, draft filter drawer and pagination | Implemented — capture pending |
| `/athletes/:athleteId` | Dense history tables | Summary cards and local table scrolling | Partial — capture pending |
| `/tournaments` | Absolute title and wide management table | Stacked header, date filter drawer, scrollable tabs and mobile records | Implemented — capture pending |
| `/tournaments/:id/view` | Nested tabs and result matrices | Summary cards, responsive tabs and mobile Rank/Name/Result tables with expandable attempts/details; desktop full result actions retained | Implemented — capture pending |
| `/tournaments/create` | Horizontal event/age-bracket fields | Collapsible form sections and sticky actions | Implemented — capture pending |
| `/tournaments/:id/register` | Long registration form | Full-width controls, payment summary and sticky submit | Implemented — capture pending |
| `/tournaments/:id/registrations` | Wide list/import preview and raw Event IDs on mobile | Paginated cards, resolved Event labels/duplicate warnings and fullscreen import overlay/preview | Implemented — capture pending |
| `/tournaments/:id/registrations/new` | Search/result density | Touch-friendly selected-member cards | Partial — capture pending |
| `/tournaments/:id/registrations/:registrationId/edit` | Dense member/status controls | Stacked member cards and sticky save | Partial — capture pending |
| `/tournaments/:id/register/:global_id/view` | Read-only team/payment density | Label/value cards and visible status | Partial — capture pending |
| `/tournaments/:id/participants` | Fixed search and wide participant tables | Stacked controls and participant cards | Implemented — capture pending |
| `/tournaments/:id/start/record` | Wide score tables and 800px editor | Participant/team score cards and fullscreen score editor | Implemented — capture pending |
| `/tournaments/:id/record/prelim` | Nested tabs and dense results | Responsive tabs and mobile expandable Rank/Name/Best Time table; desktop table preserved | Implemented — capture pending |
| `/tournaments/:id/scoring/final` | Nested classifications and score editor | Participant/team score cards and fullscreen score editor | Implemented — capture pending |
| `/tournaments/:id/record/final` | Nested tabs and dense results | Classification tabs and mobile expandable Rank/Name/Best Time table; desktop table preserved | Implemented — capture pending |
| `/tournaments/:id/print-results` | Fixed-width filters | Stacked filters and action controls | Partial — capture pending |
| `/score-sheet/:tournamentId/:round` | Dense comparison table | Existing card/drawer pattern retained | Partial — capture pending |
| `/verify` | Long verification details | Wrapped details and full-width primary action | Partial — capture pending |
| `/verify-requests` | Inline action buttons | Stacked actions and confirmation | Implemented — capture pending |
| `/notifications` | Header/card action crowding | Shared page header, unread metadata and expandable message cards | Implemented — capture pending |
| `/records` | Dense filters/results | Connected mobile search/filter trigger, draft filter drawer and expandable Rank/Name/Time table; desktop table preserved | Implemented — interaction smoke passed; capture pending |
| `/register` | Long profile/claim forms | Scrollable tabs, touch controls and sticky submit | Implemented — capture pending |
| `/users/:id` | Profile history tables | Single-column profile and card/table hybrid | Partial — capture pending |
| `/admins` | Permission table and editor | Permission cards and responsive editor | Implemented — capture pending |
| `/admin/team-recruitment` | Three wide tables and many dialogs | Recruitment cards, responsive tabs and actions | Implemented — capture pending |
| `/admin/carousel` | Image table and fixed dialog | Image cards and responsive editor | Implemented — capture pending |
| `/admin/users` | User/claim tables and dialogs | User cards and responsive review overlays | Implemented — capture pending |
| `/admin/developer-setting` | Destructive actions | Stacked settings and explicit confirmation | Partial — capture pending |
| `/forgot-password` | Small form affordances | Full-width form and return-to-login action | Implemented — capture pending |

## Shared surfaces

| Surface | Treatment | Status / evidence |
| --- | --- | --- |
| Navbar / mobile drawer | ISSF logo, 44px hamburger/account controls, all primary/Admin/notification routes, account sheet | Implemented — capture pending |
| Login overlay | Desktop modal and mobile responsive overlay with safe-area footer | Implemented — capture pending |
| Footer | Compact icon/title/content rows with tel, email, WhatsApp, address and Facebook links | Implemented — capture pending |

## Shared components

- `src/components/responsive/MobilePageHeader.tsx` keeps titles, back navigation, and actions from colliding.
- `src/components/responsive/ResponsiveDataView.tsx` provides desktop/tablet/mobile slots without changing data contracts.
- `src/components/responsive/MobileRankingTable.tsx` provides the shared mobile Rank/Name/Result table, multi-row expansion, details and pagination shell.
- `src/components/responsive/ResponsiveOverlay.tsx` renders a desktop Modal or a mobile sheet/fullscreen Drawer, with sticky-safe content and focus restoration support.
- `src/components/responsive/MobileStickyActions.tsx` keeps save/submit actions above the safe-area inset.
- `src/components/responsive/MobileFilterDrawer.tsx` provides draft/apply/cancel/reset filter semantics.
- `src/components/responsive/MobileFilterTrigger.tsx` keeps the filter icon centred while rendering the active count as an external badge.
- `src/components/responsive/ResponsiveTabs.tsx` keeps active tabs reachable on narrow screens.
- `src/components/responsive/CountryFlag.tsx` renders mapped flags with a visible fallback when country data or the remote image is unavailable.

## Manual evidence

Add before/after screenshots here after running the authenticated route matrix. Record the viewport, auth role, route, and scenario for each screenshot. The final pass must include login, registration, tournament scoring, result viewing, verification, admin approval, recruitment assignment, image upload, and developer-setting confirmation.

## Automated checks completed

- `yarn validate` — passed.
- `yarn build` — passed; only existing Firebase chunking and stale Browserslist warnings remain.
- `yarn responsive:smoke` — passed (30 unique route declarations, shared responsive components, stable ranking expansion wiring, shared filter triggers, no duplicate routes, no page-level overflow clipping, and no hover-only Cascader source usage).
- `git diff --check` — passed.
- Browser screenshots and soft-keyboard/200% zoom checks — not run in this environment (no Chromium/Playwright binary available).
