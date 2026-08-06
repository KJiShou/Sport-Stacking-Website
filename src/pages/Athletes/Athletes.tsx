import type * as React from "react";

import {useEffect, useMemo, useRef, useState} from "react";

import {
    Button,
    Input,
    Link,
    Message,
    Pagination,
    Select,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
} from "@arco-design/web-react";
import {IconFilter, IconRefresh} from "@arco-design/web-react/icon";

import type {FirestoreUser} from "@/schema/UserSchema";
// import type {GlobalResult, GlobalTeamResult} from "@/schema/RecordSchema";
import {type EventType as RankingEventType, getTopAthletesByEvent} from "@/services/firebase/athleteRankingsService";
import {
    CountryFlag,
    MobileFilterDrawer,
    MobileFilterTrigger,
    MobilePageHeader,
    MobileRankingTable,
} from "@/components/responsive";
import {formatGenderLabel} from "@/utils/genderLabel";
import {formatStackingTime} from "@/utils/time";

const Option = Select.Option;

type Category = "individual" | "double" | "parent_&_child" | "team_relay" | "special_need";
type EventTypeUnion = "3-3-3" | "3-6-3" | "Cycle" | "Overall";

type AgeGroup =
    | "Overall"
    | "Age 5 & Under"
    | "Age 6"
    | "Age 7"
    | "Age 8"
    | "Age 9"
    | "Age 10"
    | "Age 11"
    | "Age 12"
    | "Age 13"
    | "Age 14 & 15"
    | "Age 16-20"
    | "Age 21-30"
    | "Age 31-40"
    | "Age 41-49"
    | "Age 50-59"
    | "Age 60-69"
    | "Age 70++";
type AgeFilter = "All" | AgeGroup;

type GenderOption = "Male" | "Female" | "Mixed";
type GenderFilter = "All" | GenderOption;

type SeasonValue = `${number}-${number}`;
type SeasonFilter = "All" | SeasonValue;

interface RankingFilterValues {
    selectedEventKey: string;
    ageFilter: AgeFilter;
    genderFilter: GenderFilter;
    locationFilter: string;
    seasonFilter: SeasonFilter;
}

interface EventOption {
    key: string;
    label: string;
    category: Category;
    event: EventTypeUnion;
}

function seasonLabelToStartYear(season: SeasonValue): number {
    const [start] = season.split("-");
    return Number.parseInt(start, 10);
}

function formatSeasonLabel(season: SeasonValue): string {
    const [start, end] = season.split("-");
    return `${start} - ${end}`;
}

interface EventStats {
    time: number;
    season: SeasonValue | null;
    createdAt: string | Date | null;
    updatedAt: string | Date | null;
    source: "record" | "derived";
}

interface AthleteRankingEntry {
    key: string;
    category: Category;
    isTeam: boolean;
    participantId?: string;
    teamId?: string;
    name: string;
    gender: GenderOption;
    age: number | null;
    ageGroup: AgeGroup;
    country: string;
    events: Record<string, EventStats>;
    members: string[];
    memberNames: string[];
}

interface AthleteTableRow extends AthleteRankingEntry {
    rank: number;
    eventTime: number;
    season: SeasonValue | null;
    source: "record" | "derived";
}

const GENDER_FILTER_OPTIONS: {value: GenderFilter; label: string}[] = [
    {value: "All", label: "All Genders"},
    {value: "Male", label: "Male"},
    {value: "Female", label: "Female"},
];

const AGE_FILTER_OPTIONS: {value: AgeFilter; label: string}[] = [
    {value: "All", label: "All Ages"},
    {value: "Age 5 & Under", label: "Age 5 & Under"},
    {value: "Age 6", label: "Age 6"},
    {value: "Age 7", label: "Age 7"},
    {value: "Age 8", label: "Age 8"},
    {value: "Age 9", label: "Age 9"},
    {value: "Age 10", label: "Age 10"},
    {value: "Age 11", label: "Age 11"},
    {value: "Age 12", label: "Age 12"},
    {value: "Age 13", label: "Age 13"},
    {value: "Age 14 & 15", label: "Age 14 & 15"},
    {value: "Age 16-20", label: "Age 16-20"},
    {value: "Age 21-30", label: "Age 21-30"},
    {value: "Age 31-40", label: "Age 31-40"},
    {value: "Age 41-49", label: "Age 41-49"},
    {value: "Age 50-59", label: "Age 50-59"},
    {value: "Age 60-69", label: "Age 60-69"},
    {value: "Age 70++", label: "Age 70++"},
];

const EVENT_OPTIONS: EventOption[] = [
    {
        key: "individual:3-3-3",
        label: "Individual 3-3-3",
        category: "individual",
        event: "3-3-3",
    },
    {
        key: "individual:3-6-3",
        label: "Individual 3-6-3",
        category: "individual",
        event: "3-6-3",
    },
    {
        key: "individual:Cycle",
        label: "Individual Cycle",
        category: "individual",
        event: "Cycle",
    },
    {
        key: "individual:Overall",
        label: "Individual Overall",
        category: "individual",
        event: "Overall",
    },
];
const DEFAULT_EVENT = EVENT_OPTIONS[0];

function parseDate(value: unknown): Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "string") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "object") {
        const maybeTimestamp = value as {toDate?: () => Date; seconds?: number; nanoseconds?: number};
        if (typeof maybeTimestamp.toDate === "function") {
            const parsed = maybeTimestamp.toDate();
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof maybeTimestamp.seconds === "number") {
            const millis = maybeTimestamp.seconds * 1000 + (maybeTimestamp.nanoseconds ?? 0) / 1_000_000;
            const parsed = new Date(millis);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    return null;
}

function normalizeTimestamp(value: unknown): string | Date | null {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return value;
        }
        return null;
    }

    if (typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === "object") {
        const maybeTimestamp = value as {toDate?: () => Date; seconds?: number; nanoseconds?: number};
        if (typeof maybeTimestamp.toDate === "function") {
            const parsed = maybeTimestamp.toDate();
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        if (typeof maybeTimestamp.seconds === "number") {
            const millis = maybeTimestamp.seconds * 1000 + (maybeTimestamp.nanoseconds ?? 0) / 1_000_000;
            const parsed = new Date(millis);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    return null;
}

function determineSeason(date: Date): SeasonValue | null {
    if (!Number.isFinite(date.getTime())) {
        return null;
    }
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const seasonStartYear = month >= 6 ? year : year - 1;
    return `${seasonStartYear}-${seasonStartYear + 1}` as SeasonValue;
}

function extractBestTime(record: {
    bestTime?: unknown;
    time?: unknown;
    try1?: unknown;
    try2?: unknown;
    try3?: unknown;
}): number | null {
    const candidates = [record.bestTime, record.time, record.try1, record.try2, record.try3]
        .map((value) => {
            if (typeof value === "number") {
                return value;
            }
            if (typeof value === "string" && value.trim().length > 0) {
                const numeric = Number.parseFloat(value);
                return Number.isFinite(numeric) ? numeric : Number.NaN;
            }
            return Number.NaN;
        })
        .filter((value) => Number.isFinite(value) && value > 0);
    if (candidates.length === 0) {
        return null;
    }
    return Math.min(...candidates);
}

function buildEventStats(record: {
    time?: unknown;
    bestTime?: unknown;
    try1?: unknown;
    try2?: unknown;
    try3?: unknown;
    created_at?: unknown;
    updated_at?: unknown;
}): EventStats | null {
    const time = extractBestTime(record);
    if (time === null) {
        return null;
    }
    const createdAt = normalizeTimestamp(record.created_at);
    const updatedAt = normalizeTimestamp(record.updated_at);
    const eventDate = parseDate(createdAt) ?? parseDate(updatedAt);
    const season = eventDate ? determineSeason(eventDate) : null;
    return {
        time,
        season,
        createdAt,
        updatedAt,
        source: "record",
    };
}

function getAgeGroup(age: number | null): AgeGroup {
    if (age === null || Number.isNaN(age)) {
        return "Overall";
    }
    if (age <= 5) return "Age 5 & Under";
    if (age === 6) return "Age 6";
    if (age === 7) return "Age 7";
    if (age === 8) return "Age 8";
    if (age === 9) return "Age 9";
    if (age === 10) return "Age 10";
    if (age === 11) return "Age 11";
    if (age === 12) return "Age 12";
    if (age === 13) return "Age 13";
    if (age <= 15) return "Age 14 & 15";
    if (age <= 20) return "Age 16-20";
    if (age <= 30) return "Age 21-30";
    if (age <= 40) return "Age 31-40";
    if (age <= 49) return "Age 41-49";
    if (age <= 59) return "Age 50-59";
    if (age <= 69) return "Age 60-69";
    return "Age 70++";
}

function ensureEntry(
    map: Map<string, AthleteRankingEntry>,
    key: string,
    base: Partial<AthleteRankingEntry>,
): AthleteRankingEntry {
    let entry = map.get(key);
    if (!entry) {
        entry = {
            key,
            category: base.category ?? "individual",
            isTeam: base.isTeam ?? false,
            participantId: base.participantId,
            teamId: base.teamId,
            name: base.name ?? "Unknown",
            gender: base.gender ?? "Mixed",
            age: base.age ?? null,
            ageGroup: base.ageGroup ?? "Overall",
            country: base.country ?? "Unknown",
            events: {},
            members: base.members ?? [],
            memberNames: base.memberNames ?? [],
        };
        map.set(key, entry);
        return entry;
    }
    if (base.isTeam !== undefined) {
        entry.isTeam = base.isTeam;
    }
    if (base.participantId && !entry.participantId) {
        entry.participantId = base.participantId;
    }
    if (base.teamId && !entry.teamId) {
        entry.teamId = base.teamId;
    }
    if (base.name && entry.name === "Unknown") {
        entry.name = base.name;
    }
    if (base.gender && entry.gender === "Mixed") {
        entry.gender = base.gender;
    }
    if (typeof base.age === "number" && !Number.isNaN(base.age)) {
        entry.age = base.age;
        entry.ageGroup = base.ageGroup ?? entry.ageGroup;
    }
    if (base.country && entry.country === "Unknown") {
        entry.country = base.country;
    }
    if (base.members && base.members.length > 0) {
        entry.members = base.members;
    }
    if (base.memberNames && base.memberNames.length > 0) {
        entry.memberNames = base.memberNames;
    }
    return entry;
}

function isTimestampLike(value: unknown): value is {toDate: () => Date} {
    return !!value && typeof (value as {toDate?: unknown}).toDate === "function";
}

function toSafeDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (isTimestampLike(value)) {
        const d = value.toDate();
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

function extractCountry(value: unknown): string {
    if (typeof value === "string") return value.trim() || "Unknown";
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
        return (value[0] as string).trim() || "Unknown";
    }
    return "Unknown";
}

async function loadRankingData(): Promise<AthleteRankingEntry[]> {
    // Build rankings from users' best_times via athleteRankingsService for individual events only
    const map = new Map<string, AthleteRankingEntry>();

    // Events we care about for individual rankings
    const individualEvents: RankingEventType[] = ["3-3-3", "3-6-3", "Cycle", "Overall"];

    // Fetch top athletes for each event and upsert into the map
    await Promise.all(
        individualEvents.map(async (evt) => {
            try {
                const users = await getTopAthletesByEvent(evt, 500);
                const eventKey = `individual:${evt}`;

                for (const user of users as FirestoreUser[]) {
                    const participantId = (user.global_id as string | undefined) ?? (user.id as string);
                    const key = `individual:${participantId}`;
                    const name = (user.name as string) ?? "Unknown";
                    const gender = (user.gender as GenderOption | undefined) ?? "Mixed";

                    // Derive country (handle array or string)
                    const country = extractCountry((user as unknown as {country?: unknown})?.country);

                    const bestObj = user.best_times?.[evt as keyof NonNullable<FirestoreUser["best_times"]>] as
                        | {time?: number; updated_at?: Date | {toDate?: () => Date} | null; season?: string | null}
                        | undefined;
                    const time = bestObj?.time;
                    const updatedAt = parseDate(bestObj?.updated_at ?? null);
                    const season = ((): SeasonValue | null => {
                        const s = bestObj?.season;
                        if (typeof s === "string" && /^(\d{4})-(\d{4})$/.test(s)) {
                            return s as SeasonValue;
                        }
                        return updatedAt ? determineSeason(updatedAt) : null;
                    })();

                    // Derive age from birthdate at the time of record (updated_at)
                    const birth = user.birthdate as unknown;
                    const age = (() => {
                        if (!birth) return null;
                        const birthdate = toSafeDate(birth);
                        if (!birthdate || Number.isNaN(birthdate.getTime())) return null;
                        // Use updated_at if available, otherwise current date
                        const referenceDate = updatedAt ?? new Date();
                        let years = referenceDate.getFullYear() - birthdate.getFullYear();
                        const hadBirthday =
                            referenceDate.getMonth() > birthdate.getMonth() ||
                            (referenceDate.getMonth() === birthdate.getMonth() && referenceDate.getDate() >= birthdate.getDate());
                        if (!hadBirthday) years -= 1;
                        return Number.isFinite(years) ? years : null;
                    })();
                    const ageGroup = getAgeGroup(age);

                    const entry = ensureEntry(map, key, {
                        category: "individual",
                        isTeam: false,
                        participantId,
                        name,
                        gender,
                        age,
                        ageGroup,
                        country,
                    });

                    if (typeof time === "number" && Number.isFinite(time) && time > 0) {
                        const stats: EventStats = {
                            time,
                            season,
                            createdAt: null,
                            updatedAt,
                            source: "record",
                        };
                        const existingStats = entry.events[eventKey];
                        if (!existingStats || stats.time < existingStats.time) {
                            entry.events[eventKey] = stats;
                        }
                    }
                }
            } catch (error) {
                console.warn(`Failed to fetch top athletes for ${evt}`, error);
            }
        }),
    );

    return Array.from(map.values());
}

const Athletes: React.FC = () => {
    const PAGE_SIZE = 25;
    const [rankings, setRankings] = useState<AthleteRankingEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedEventKey, setSelectedEventKey] = useState<string>(DEFAULT_EVENT.key);
    const [searchTerm, setSearchTerm] = useState("");
    const [ageFilter, setAgeFilter] = useState<AgeFilter>("All");
    const [genderFilter, setGenderFilter] = useState<GenderFilter>("All");
    const [locationFilter, setLocationFilter] = useState<string>("All");
    const [seasonFilter, setSeasonFilter] = useState<SeasonFilter>("All");
    const [locationOptions, setLocationOptions] = useState<string[]>([]);
    const [seasonOptions, setSeasonOptions] = useState<SeasonValue[]>([]);
    const [rankingPage, setRankingPage] = useState(1);
    const [mobileFiltersVisible, setMobileFiltersVisible] = useState(false);
    const mobileFilterTriggerRef = useRef<HTMLButtonElement>(null);
    const [expandedTabletRows, setExpandedTabletRows] = useState<(string | number)[]>([]);
    const [filterDraft, setFilterDraft] = useState<RankingFilterValues>({
        selectedEventKey: DEFAULT_EVENT.key,
        ageFilter: "All",
        genderFilter: "All",
        locationFilter: "All",
        seasonFilter: "All",
    });

    const selectedEvent = useMemo(() => {
        return EVENT_OPTIONS.find((option) => option.key === selectedEventKey) ?? DEFAULT_EVENT;
    }, [selectedEventKey]);

    useEffect(() => {
        let mounted = true;
        setLoading(true);

        loadRankingData()
            .then((data) => {
                if (!mounted) {
                    return;
                }
                setRankings(data);
                const countries = Array.from(
                    new Set(
                        data
                            .map((entry) => entry.country)
                            .filter((country): country is string => !!country && country !== "Unknown"),
                    ),
                ).sort((a, b) => a.localeCompare(b));
                setLocationOptions(countries);

                const seasonStartYears = new Set<number>();
                for (const entry of data) {
                    for (const stats of Object.values(entry.events)) {
                        if (stats?.season) {
                            seasonStartYears.add(seasonLabelToStartYear(stats.season));
                        }
                    }
                }
                if (seasonStartYears.size > 0) {
                    const minYear = Math.min(...seasonStartYears);
                    const maxYear = Math.max(...seasonStartYears);
                    const generatedSeasons: SeasonValue[] = [];
                    for (let year = maxYear; year >= minYear; year -= 1) {
                        generatedSeasons.push(`${year}-${year + 1}` as SeasonValue);
                    }
                    setSeasonOptions(generatedSeasons);
                } else {
                    setSeasonOptions([]);
                }
            })
            .catch((error) => {
                console.error(error);
                if (mounted) {
                    Message.error("Failed to load athlete rankings.");
                }
            })
            .finally(() => {
                if (mounted) {
                    setLoading(false);
                }
            });

        return () => {
            mounted = false;
        };
    }, []);

    const rankedRows = useMemo<AthleteTableRow[]>(() => {
        const eventKey = selectedEvent.key;
        return rankings
            .map((entry) => {
                const stats = entry.events[eventKey];
                if (!stats || !stats.time || stats.time <= 0) {
                    return null;
                }

                if (ageFilter !== "All" && entry.ageGroup !== ageFilter) {
                    return null;
                }

                if (genderFilter !== "All" && entry.gender !== genderFilter) {
                    return null;
                }

                if (locationFilter !== "All" && entry.country !== locationFilter) {
                    return null;
                }

                if (seasonFilter !== "All" && stats.season !== seasonFilter) {
                    return null;
                }

                return {
                    ...entry,
                    rank: 0,
                    eventTime: stats.time,
                    season: stats.season ?? null,
                    source: stats.source,
                } as AthleteTableRow;
            })
            .filter((entry): entry is AthleteTableRow => !!entry)
            .sort((a, b) => a.eventTime - b.eventTime)
            .map((entry, index) => ({
                ...entry,
                rank: index + 1,
            }));
    }, [rankings, selectedEvent, ageFilter, genderFilter, locationFilter, seasonFilter]);

    const filteredRows = useMemo<AthleteTableRow[]>(() => {
        const normalizedSearch = searchTerm.trim().toLowerCase();
        if (!normalizedSearch) {
            return rankedRows;
        }
        return rankedRows.filter((entry) => {
            const haystacks = [entry.name, ...entry.memberNames, ...entry.members]
                .filter(Boolean)
                .map((value) => value.toLowerCase());
            return haystacks.some((value) => value.includes(normalizedSearch));
        });
    }, [rankedRows, searchTerm]);

    useEffect(() => {
        setRankingPage(1);
        setExpandedTabletRows([]);
    }, [selectedEventKey, searchTerm, ageFilter, genderFilter, locationFilter, seasonFilter]);

    const paginatedRows = useMemo(() => {
        const start = (rankingPage - 1) * PAGE_SIZE;
        return filteredRows.slice(start, start + PAGE_SIZE);
    }, [filteredRows, rankingPage]);

    const columns: TableColumnProps<AthleteTableRow>[] = [
        {
            title: "Rank",
            dataIndex: "rank",
            width: 64,
            render: (rank: number) => <span className="font-semibold text-sm md:text-base">{rank}</span>,
        },
        {
            title: selectedEvent.category === "team_relay" ? "Team" : "Athlete",
            dataIndex: "name",
            width: 240,
            render: (name: string, row) => {
                if (!row.isTeam && row.participantId) {
                    return (
                        <Link href={`/athletes/${row.participantId}`} hoverable={false}>
                            {name}
                        </Link>
                    );
                }
                return <span>{name}</span>;
            },
        },
        {
            title: "Country",
            dataIndex: "country",
            width: 160,
            render: (country: string) => (
                <span className="country-cell">
                    <CountryFlag country={country} size="sm" />
                    <span>{country?.trim() || "Unknown"}</span>
                </span>
            ),
        },
        {
            title: "Age",
            dataIndex: "age",
            width: 100,
            render: (_: unknown, row) => (!row.isTeam && typeof row.age === "number" ? row.age : "—"),
        },
        {
            title: "Gender",
            dataIndex: "gender",
            width: 120,
            render: (gender: GenderOption) => formatGenderLabel(gender),
        },
        {
            title: `${selectedEvent.label} Time`,
            dataIndex: "eventTime",
            width: 160,
            render: (time: number) => <span className="font-semibold">{formatStackingTime(time)}</span>,
        },
        {
            title: "Season",
            dataIndex: "season",
            width: 140,
            render: (season: SeasonValue | null) => (season ? <Tag color="green">{season}</Tag> : <Tag color="gray">N/A</Tag>),
        },
    ];

    const tabletColumns: TableColumnProps<AthleteTableRow>[] = [columns[0], columns[1], columns[5]];

    const renderRankingDetails = (row: AthleteTableRow) => (
        <div className="ranking-row-details">
            <div className="ranking-detail-item">
                <span className="ranking-detail-label">Country</span>
                <span className="country-cell">
                    <CountryFlag country={row.country} size="sm" />
                    <span>{row.country?.trim() || "Unknown"}</span>
                </span>
            </div>
            <div className="ranking-detail-item">
                <span className="ranking-detail-label">Age</span>
                <span>{!row.isTeam && typeof row.age === "number" ? row.age : "—"}</span>
            </div>
            <div className="ranking-detail-item">
                <span className="ranking-detail-label">Gender</span>
                <span>{formatGenderLabel(row.gender)}</span>
            </div>
            <div className="ranking-detail-item">
                <span className="ranking-detail-label">Event</span>
                <span>{selectedEvent.label}</span>
            </div>
            <div className="ranking-detail-item">
                <span className="ranking-detail-label">Season</span>
                <span>{row.season ?? "N/A"}</span>
            </div>
            {row.isTeam && row.memberNames.length > 0 ? (
                <div className="ranking-detail-item ranking-detail-item--wide">
                    <span className="ranking-detail-label">Team Members</span>
                    <span>{row.memberNames.join(", ")}</span>
                </div>
            ) : null}
        </div>
    );

    const handleResetFilters = () => {
        setSearchTerm("");
        setAgeFilter("All");
        setGenderFilter("All");
        setLocationFilter("All");
        setSeasonFilter("All");
        setSelectedEventKey(DEFAULT_EVENT.key);
        setFilterDraft({
            selectedEventKey: DEFAULT_EVENT.key,
            ageFilter: "All",
            genderFilter: "All",
            locationFilter: "All",
            seasonFilter: "All",
        });
    };

    const activeFilterCount = [
        selectedEventKey !== DEFAULT_EVENT.key,
        ageFilter !== "All",
        genderFilter !== "All",
        locationFilter !== "All",
        seasonFilter !== "All",
    ].filter(Boolean).length;
    const draftFilterCount = [
        filterDraft.selectedEventKey !== DEFAULT_EVENT.key,
        filterDraft.ageFilter !== "All",
        filterDraft.genderFilter !== "All",
        filterDraft.locationFilter !== "All",
        filterDraft.seasonFilter !== "All",
    ].filter(Boolean).length;

    const renderFilterSelects = (
        values: RankingFilterValues,
        onChange: <K extends keyof RankingFilterValues>(key: K, value: RankingFilterValues[K]) => void,
    ) => (
        <>
            <Select
                value={values.selectedEventKey}
                style={{width: 220}}
                onChange={(value) => onChange("selectedEventKey", value)}
            >
                {EVENT_OPTIONS.map((option) => (
                    <Option key={option.key} value={option.key}>
                        {option.label}
                    </Option>
                ))}
            </Select>
            <Select value={values.ageFilter} style={{width: 180}} onChange={(value) => onChange("ageFilter", value as AgeFilter)}>
                {AGE_FILTER_OPTIONS.map((option) => (
                    <Option key={option.value} value={option.value}>
                        {option.label}
                    </Option>
                ))}
            </Select>
            <Select
                value={values.genderFilter}
                style={{width: 150}}
                onChange={(value) => onChange("genderFilter", value as GenderFilter)}
            >
                {GENDER_FILTER_OPTIONS.map((option) => (
                    <Option key={option.value} value={option.value}>
                        {option.label}
                    </Option>
                ))}
            </Select>
            <Select value={values.locationFilter} style={{width: 200}} onChange={(value) => onChange("locationFilter", value)}>
                <Option key="All" value="All">
                    All Locations
                </Option>
                {locationOptions.map((country) => (
                    <Option key={country} value={country}>
                        {country}
                    </Option>
                ))}
            </Select>
            <Select
                value={values.seasonFilter}
                style={{width: 180}}
                onChange={(value) => onChange("seasonFilter", value as SeasonFilter)}
            >
                <Option key="All" value="All">
                    All Seasons
                </Option>
                {seasonOptions.map((season) => (
                    <Option key={season} value={season}>
                        {formatSeasonLabel(season)}
                    </Option>
                ))}
            </Select>
        </>
    );

    const appliedFilterValues: RankingFilterValues = {
        selectedEventKey,
        ageFilter,
        genderFilter,
        locationFilter,
        seasonFilter,
    };

    const setAppliedFilter = <K extends keyof RankingFilterValues>(key: K, value: RankingFilterValues[K]) => {
        if (key === "selectedEventKey") setSelectedEventKey(value as string);
        if (key === "ageFilter") setAgeFilter(value as AgeFilter);
        if (key === "genderFilter") setGenderFilter(value as GenderFilter);
        if (key === "locationFilter") setLocationFilter(value as string);
        if (key === "seasonFilter") setSeasonFilter(value as SeasonFilter);
    };

    const applyMobileFilters = () => {
        setAppliedFilter("selectedEventKey", filterDraft.selectedEventKey);
        setAppliedFilter("ageFilter", filterDraft.ageFilter);
        setAppliedFilter("genderFilter", filterDraft.genderFilter);
        setAppliedFilter("locationFilter", filterDraft.locationFilter);
        setAppliedFilter("seasonFilter", filterDraft.seasonFilter);
        setMobileFiltersVisible(false);
    };

    const openMobileFilters = () => {
        setFilterDraft(appliedFilterValues);
        setMobileFiltersVisible(true);
    };

    const resetMobileFilterDraft = () => {
        setFilterDraft({
            selectedEventKey: DEFAULT_EVENT.key,
            ageFilter: "All",
            genderFilter: "All",
            locationFilter: "All",
            seasonFilter: "All",
        });
    };

    return (
        <div className="flex flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-left p-6 shadow-lg rounded-lg">
                <div className="flex flex-col gap-4">
                    <MobilePageHeader
                        title="Athlete Rankings"
                        actions={
                            <Button
                                className="athlete-ranking-reset"
                                type="outline"
                                icon={<IconRefresh />}
                                onClick={handleResetFilters}
                            >
                                Reset filters
                            </Button>
                        }
                    />
                    <div className="athlete-ranking-filter-layout mobile-search-filter-row">
                        <Input.Search
                            allowClear
                            placeholder="Search athlete"
                            className="athlete-ranking-search"
                            value={searchTerm}
                            onChange={(value) => setSearchTerm(value)}
                            onSearch={(value) => setSearchTerm(value)}
                        />
                        <div className="athlete-filter-controls athlete-filter-controls--desktop">
                            {renderFilterSelects(appliedFilterValues, setAppliedFilter)}
                        </div>
                        <MobileFilterTrigger
                            icon={<IconFilter />}
                            ref={mobileFilterTriggerRef}
                            ariaExpanded={mobileFiltersVisible}
                            activeCount={activeFilterCount}
                            ariaLabel={`Open ranking filters${activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ""}`}
                            onClick={openMobileFilters}
                        />
                    </div>
                </div>

                <Spin loading={loading} className="w-full">
                    <div className="athlete-ranking-table athlete-ranking-table--desktop mobile-table-scroll">
                        <Table rowKey="key" data={paginatedRows} columns={columns} pagination={false} scroll={{x: 984}} />
                    </div>
                    <div className="athlete-ranking-table athlete-ranking-table--mobile">
                        <MobileRankingTable
                            data={paginatedRows}
                            loading={loading}
                            emptyDescription={
                                searchTerm || activeFilterCount > 0
                                    ? "No rankings match these filters"
                                    : "No rankings available"
                            }
                            rowKey={(row) => row.key}
                            rank={(row) => row.rank}
                            name={(row) =>
                                row.participantId ? (
                                    <Link href={`/athletes/${row.participantId}`} hoverable={false}>
                                        {row.name}
                                    </Link>
                                ) : (
                                    row.name
                                )
                            }
                            result={(row) => formatStackingTime(row.eventTime)}
                            details={(row) => renderRankingDetails(row)}
                        />
                    </div>
                </Spin>
                <div className="athlete-ranking-table athlete-ranking-table--tablet">
                    <Table
                        rowKey="key"
                        data={paginatedRows}
                        columns={tabletColumns}
                        pagination={false}
                        expandedRowKeys={expandedTabletRows}
                        onExpandedRowsChange={setExpandedTabletRows}
                        expandedRowRender={renderRankingDetails}
                        expandProps={{width: 44}}
                        scroll={{x: 520}}
                    />
                </div>
                {filteredRows.length > 0 ? (
                    <div className="ranking-results-footer">
                        <span className="ranking-results-count">
                            Showing {Math.min((rankingPage - 1) * PAGE_SIZE + 1, filteredRows.length)}–
                            {Math.min(rankingPage * PAGE_SIZE, filteredRows.length)} of {filteredRows.length}
                        </span>
                        <Pagination
                            current={rankingPage}
                            pageSize={PAGE_SIZE}
                            total={filteredRows.length}
                            hideOnSinglePage
                            onChange={setRankingPage}
                        />
                    </div>
                ) : null}
            </div>

            <MobileFilterDrawer
                title="Ranking Filters"
                visible={mobileFiltersVisible}
                activeCount={draftFilterCount}
                returnFocusRef={mobileFilterTriggerRef}
                onCancel={() => setMobileFiltersVisible(false)}
                onApply={applyMobileFilters}
                onReset={resetMobileFilterDraft}
            >
                <div className="athlete-filter-drawer-fields">
                    {renderFilterSelects(filterDraft, (key, value) => setFilterDraft((current) => ({...current, [key]: value})))}
                </div>
            </MobileFilterDrawer>

        </div>
    );
};

export default Athletes;
