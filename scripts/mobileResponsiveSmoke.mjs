import {readFileSync} from "node:fs";
import {resolve} from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);

const read = (relativePath) => readFileSync(resolve(root, relativePath), "utf8");

const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message);
    }
};

const routeSource = read("src/config/routes.tsx");
const routePaths = [...routeSource.matchAll(/path:\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]);
const duplicateRoutes = routePaths.filter((path, index) => routePaths.indexOf(path) !== index);
const cascaderSource = [
    "src/pages/Tournaments/CreateTournaments/CreateTournaments.tsx",
    "src/pages/Tournaments/Component/TournamentList.tsx",
    "src/pages/User/Register/RegisterPage.tsx",
    "src/pages/User/UserProfile/UserProfile.tsx",
    "src/pages/Tournaments/ParticipantList/ParticipantListPage.tsx",
    "src/pages/Home/Home.tsx",
]
    .map(read)
    .join("\n");

assert(duplicateRoutes.length === 0, `Duplicate route declarations: ${duplicateRoutes.join(", ")}`);
assert(routePaths.length >= 30, `Expected at least 30 route declarations, found ${routePaths.length}`);

const globalStyles = read("src/global.scss");
assert(!globalStyles.includes("overflow-x: clip"), "Page-level overflow clipping is still enabled");
assert(!cascaderSource.includes('expandTrigger="hover"'), "Hover-only Cascader interaction remains in the source");
assert(!cascaderSource.includes('trigger={["click", "hover"]}'), "Hover-only dropdown interaction remains in the source");
assert(!cascaderSource.includes('showArrow="hover"'), "Hover-only carousel controls remain in the source");
assert(globalStyles.includes("--mobile-touch-target"), "Mobile touch target token is missing");
assert(
    globalStyles.includes(".responsive-overlay--mobile .responsive-overlay__body"),
    "Responsive overlay scroll body is missing",
);
assert(globalStyles.includes(".responsive-overlay--mobile {"), "Mobile overlay width scope is missing");
assert(globalStyles.includes("Swipe horizontally to see more"), "Table scroll affordance is missing");
assert(globalStyles.includes(".print-action-sheet"), "Print action sheet styling is missing");
assert(globalStyles.includes(".arco-modal.responsive-overlay"), "Responsive modal scope is missing");
assert(
    globalStyles.includes(".arco-modal-wrapper.arco-modal-wrapper-align-center .arco-modal") &&
        globalStyles.includes('.arco-modal > div[tabindex="-1"]') &&
        globalStyles.includes(".arco-modal .arco-modal-content"),
    "Global modal viewport and content scroll containment is missing",
);
assert(
    globalStyles.includes(".arco-modal.responsive-overlay .arco-modal-content") &&
        globalStyles.includes(".arco-modal.responsive-overlay .responsive-overlay__body"),
    "Desktop responsive overlay scroll containment is missing",
);
assert(
    !globalStyles.includes(".arco-modal,\n    .admin-responsive-modal,\n    .registrations-import-modal"),
    "All Arco modals are still being forced into the mobile full-screen shell",
);

const responsiveComponents = [
    "src/components/responsive/MobileFilterDrawer.tsx",
    "src/components/responsive/MobilePageHeader.tsx",
    "src/components/responsive/MobileStickyActions.tsx",
    "src/components/responsive/ResponsiveDataView.tsx",
    "src/components/responsive/ResponsiveOverlay.tsx",
    "src/components/responsive/ResponsiveTabs.tsx",
    "src/components/responsive/CountryFlag.tsx",
    "src/components/responsive/MobileRankingTable.tsx",
    "src/components/responsive/MobileFilterTrigger.tsx",
];
for (const component of responsiveComponents) {
    assert(read(component).length > 0, `Responsive component is empty: ${component}`);
}

const countryFlag = read("src/components/responsive/CountryFlag.tsx");
assert(countryFlag.includes("onError"), "CountryFlag CDN error fallback is missing");
assert(countryFlag.includes("onLoad"), "CountryFlag loading state is missing");
assert(countryFlag.includes("🌍"), "CountryFlag unknown-country fallback is missing");

const rankingPages = [
    "src/pages/Athletes/Athletes.tsx",
    "src/pages/Records/index.tsx",
    "src/pages/Tournaments/Component/TournamentView.tsx",
    "src/pages/Tournaments/PrelimResults/PrelimResultsPage.tsx",
    "src/pages/Tournaments/FinalResults/FinalResultsPage.tsx",
];
for (const page of rankingPages) {
    assert(read(page).includes("MobileRankingTable"), `Mobile ranking table is not wired into ${page}`);
    assert(!read(page).includes("results-mobile-cards"), `Legacy ranking cards remain in ${page}`);
}

const registrationSource = read("src/pages/Tournaments/RegistrationsList/RegistrationsList.tsx");
const overlaySource = read("src/components/responsive/ResponsiveOverlay.tsx");
assert(!overlaySource.includes("document.body.style.overflow"), "ResponsiveOverlay still overrides Arco body scroll locking");
assert(
    !registrationSource.includes("max-h-[76vh] overflow-y-auto registrations-import-body"),
    "Excel import modal still has a nested vertical scroll container",
);
assert(
    !read("src/components/common/TeamNameUpdatePreviewModal.tsx").includes(
        'className="flex max-h-[72vh] flex-col gap-4 overflow-y-auto pr-1"',
    ),
    "Direct team preview modal still has a nested vertical scroll container",
);
assert(
    read("src/pages/Tournaments/Scoring/ScoringPage.tsx").includes("<ResponsiveOverlay"),
    "Scoring modal no longer uses the shared responsive overlay",
);
assert(
    !registrationSource.includes("(record.events_registered ?? []).join"),
    "Raw Event IDs are still rendered on registration cards",
);
for (const profilePage of ["src/pages/Athletes/AthleteProfile.tsx", "src/pages/User/UserProfile/UserProfile.tsx"]) {
    const source = read(profilePage);
    assert(source.includes("tournamentName"), `Resolved tournament names are missing from ${profilePage}`);
    assert(
        !source.includes("<strong className=\"break-words\">{record.tournamentId}</strong>"),
        `Raw tournament ID is rendered in ${profilePage}`,
    );
}
assert(read("src/global.scss").includes(".mobile-ranking-table"), "Mobile ranking table styles are missing");

const mobileRankingTable = read("src/components/responsive/MobileRankingTable.tsx");
assert(mobileRankingTable.includes("onClick={onClick}"), "Mobile ranking expand icon no longer forwards Arco onClick");
assert(mobileRankingTable.includes("expandRowByClick: true"), "Mobile ranking rows are not expandable by row click");
assert(mobileRankingTable.includes('rowKey="key"'), "Mobile ranking rows do not use stable normalized keys");

const mobileFilterTrigger = read("src/components/responsive/MobileFilterTrigger.tsx");
assert(mobileFilterTrigger.includes("mobile-filter-trigger__count"), "Mobile filter count badge is missing");
assert(!mobileFilterTrigger.includes("{activeCount}") || mobileFilterTrigger.includes("aria-hidden"), "Filter count is rendered as button content");
for (const page of [
    "src/pages/Athletes/Athletes.tsx",
    "src/pages/Records/index.tsx",
    "src/pages/Tournaments/Component/TournamentList.tsx",
]) {
    assert(read(page).includes("MobileFilterTrigger"), `Shared mobile filter trigger is not wired into ${page}`);
    assert(read(page).includes("mobile-search-filter-row"), `Search/filter row is missing from ${page}`);
}

console.info(`Responsive smoke checks passed (${routePaths.length} routes, ${responsiveComponents.length} shared components).`);
