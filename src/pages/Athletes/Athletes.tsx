import type * as React from "react";

import {useEffect, useMemo, useState} from "react";

import {
    Button,
    Card,
    Empty,
    Input,
    Link,
    Message,
    Select,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconRefresh} from "@arco-design/web-react/icon";

import type {GlobalResult, GlobalTeamResult} from "@/schema/RecordSchema";
import {formatStackingTime} from "@/utils/time";

const {Title, Text} = Typography;
const Option = Select.Option;

type Category = "individual" | "double" | "parent_&_child" | "team_relay" | "special_need";
type EventTypeUnion = "Overall" | "3-3-3" | "3-6-3" | "Cycle";

type AgeGroup = "Overall" | "6U" | "8U" | "10U" | "12U" | "14U" | "17U" | "Open";
type AgeFilter = "All" | AgeGroup;

type GenderOption = "Male" | "Female" | "Mixed";
type GenderFilter = "All" | GenderOption;

type SeasonValue = `${number}-${number}`;
type SeasonFilter = "All" | SeasonValue;

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
    {value: "Mixed", label: "Mixed"},
];

const AGE_FILTER_OPTIONS: {value: AgeFilter; label: string}[] = [
    {value: "All", label: "All Divisions"},
    {value: "6U", label: "6 & Under"},
    {value: "8U", label: "8 & Under"},
    {value: "10U", label: "10 & Under"},
    {value: "12U", label: "12 & Under"},
    {value: "14U", label: "14 & Under"},
    {value: "17U", label: "17 & Under"},
    {value: "Open", label: "Open"},
];

const EVENT_OPTIONS: EventOption[] = [
    {
        key: "individual:Overall",
        label: "Individual Overall",
        category: "individual",
        event: "Overall",
    },
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
        key: "team_relay:Cycle",
        label: "Team Relay Cycle",
        category: "team_relay",
        event: "Cycle",
    },
    {
        key: "team_relay:3-6-3",
        label: "Team Relay 3-6-3",
        category: "team_relay",
        event: "3-6-3",
    },
];

const DEFAULT_EVENT = EVENT_OPTIONS[0];

const COUNTRY_FLAG_MAP: Record<string, string> = {
    "United States": "🇺🇸",
    Malaysia: "🇲🇾",
    Korea: "🇰🇷",
    "Chinese Taipei": "🇹🇼",
    China: "🇨🇳",
    Japan: "🇯🇵",
    Singapore: "🇸🇬",
    Thailand: "🇹🇭",
    Vietnam: "🇻🇳",
    Indonesia: "🇮🇩",
    Philippines: "🇵🇭",
};

function getCountryFlag(country?: string): string {
    if (!country) {
        return "🌍";
    }
    return COUNTRY_FLAG_MAP[country] ?? "🌍";
}

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

function deriveOverallFromEvents(events: Record<string, EventStats>): EventStats | null {
    const three = events["individual:3-3-3"];
    const six = events["individual:3-6-3"];
    const cycle = events["individual:Cycle"];
    if (!three || !six || !cycle) {
        return null;
    }
    const time = three.time + six.time + cycle.time;
    if (!Number.isFinite(time) || time <= 0) {
        return null;
    }
    const seasons = [three.season, six.season, cycle.season].filter((season): season is SeasonValue => !!season);
    const season = seasons.length === 0 ? null : seasons.sort((a, b) => seasonLabelToStartYear(b) - seasonLabelToStartYear(a))[0];
    const timestamps = [three.updatedAt, six.updatedAt, cycle.updatedAt, three.createdAt, six.createdAt, cycle.createdAt]
        .map((value) => parseDate(value))
        .filter((value): value is Date => !!value)
        .sort((a, b) => b.getTime() - a.getTime());
    const updatedAt = timestamps[0] ?? null;
    return {
        time,
        season,
        createdAt: null,
        updatedAt,
        source: "derived",
    };
}

function getAgeGroup(age: number | null): AgeGroup {
    if (age === null || Number.isNaN(age)) {
        return "Open";
    }
    if (age <= 6) return "6U";
    if (age <= 8) return "8U";
    if (age <= 10) return "10U";
    if (age <= 12) return "12U";
    if (age <= 14) return "14U";
    if (age <= 17) return "17U";
    return "Open";
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
            ageGroup: base.ageGroup ?? "Open",
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

// async function loadRankingData(): Promise<AthleteRankingEntry[]> {
//     const map = new Map<string, AthleteRankingEntry>();

//     // await Promise.all(
//     //     EVENT_OPTIONS.map(async (option) => {
//     //         try {
//     //             const rows = await getEventRankings(option.category, option.event as "3-3-3" | "3-6-3" | "Cycle" | "Overall");
//     //             if (option.category === "individual") {
//     //                 for (const record of rows as (GlobalResult & {id: string})[]) {
//     //                     const stats = buildEventStats(record);
//     //                     if (!stats) {
//     //                         continue;
//     //                     }
//     //                     const participantKey = record.participantId || record.participantName || record.id;
//     //                     const key = `${option.category}:${participantKey}`;
//     //                     const age = typeof record.age === "number" && Number.isFinite(record.age) ? record.age : null;
//     //                     const entry = ensureEntry(map, key, {
//     //                         category: option.category,
//     //                         isTeam: false,
//     //                         participantId: record.participantId ?? undefined,
//     //                         name: record.participantName ?? "Unknown",
//     //                         gender: (record.gender as GenderOption | undefined) ?? "Mixed",
//     //                         age,
//     //                         ageGroup: getAgeGroup(age),
//     //                         country: record.country ?? "Unknown",
//     //                     });
//     //                     const existingStats = entry.events[option.key];
//     //                     if (!existingStats || stats.time < existingStats.time) {
//     //                         entry.events[option.key] = stats;
//     //                     }
//     //                 }
//     //             } else {
//     //                 for (const record of rows as (GlobalTeamResult & {id: string})[]) {
//     //                     const stats = buildEventStats(record);
//     //                     if (!stats) {
//     //                         continue;
//     //                     }
//     //                     const teamIdentifier = record.leaderId || record.teamName || record.id;
//     //                     const key = `${option.category}:${teamIdentifier}`;
//     //                     const age = typeof record.age === "number" && Number.isFinite(record.age) ? record.age : null;
//     //                     const entry = ensureEntry(map, key, {
//     //                         category: option.category,
//     //                         isTeam: true,
//     //                         teamId: record.leaderId ?? undefined,
//     //                         name: record.teamName ?? "Team",
//     //                         gender: "Mixed",
//     //                         age,
//     //                         ageGroup: getAgeGroup(age),
//     //                         country: record.country ?? "Unknown",
//     //                         members: record.members ?? [],
//     //                         memberNames: Array.isArray((record as {memberNames?: string[]}).memberNames)
//     //                             ? ((record as {memberNames?: string[]}).memberNames ?? [])
//     //                             : [],
//     //                     });
//     //                     const existingStats = entry.events[option.key];
//     //                     if (!existingStats || stats.time < existingStats.time) {
//     //                         entry.events[option.key] = stats;
//     //                     }
//     //                 }
//     //             }
//     //         } catch (error) {
//     //             console.warn(`Failed to fetch rankings for ${option.label}`, error);
//     //         }
//     //     }),
//     // );

//     // for (const entry of map.values()) {
//     //     if (!entry.events["individual:Overall"]) {
//     //         const derived = deriveOverallFromEvents(entry.events);
//     //         if (derived) {
//     //             entry.events["individual:Overall"] = derived;
//     //         }
//     //     }
//     // }
//     // return Array.from(map.values());
// }

const Athletes: React.FC = () => {
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

    const selectedEvent = useMemo(() => {
        return EVENT_OPTIONS.find((option) => option.key === selectedEventKey) ?? DEFAULT_EVENT;
    }, [selectedEventKey]);

    useEffect(() => {
        let mounted = true;
        setLoading(true);

        // loadRankingData()
        //     .then((data) => {
        //         if (!mounted) {
        //             return;
        //         }
        //         setRankings(data);
        //         const countries = Array.from(
        //             new Set(
        //                 data
        //                     .map((entry) => entry.country)
        //                     .filter((country): country is string => !!country && country !== "Unknown"),
        //             ),
        //         ).sort((a, b) => a.localeCompare(b));
        //         setLocationOptions(countries);

        //         const seasonStartYears = new Set<number>();
        //         for (const entry of data) {
        //             for (const stats of Object.values(entry.events)) {
        //                 if (stats?.season) {
        //                     seasonStartYears.add(seasonLabelToStartYear(stats.season));
        //                 }
        //             }
        //         }
        //         if (seasonStartYears.size > 0) {
        //             const minYear = Math.min(...seasonStartYears);
        //             const maxYear = Math.max(...seasonStartYears);
        //             const generatedSeasons: SeasonValue[] = [];
        //             for (let year = maxYear; year >= minYear; year -= 1) {
        //                 generatedSeasons.push(`${year}-${year + 1}` as SeasonValue);
        //             }
        //             setSeasonOptions(generatedSeasons);
        //         } else {
        //             setSeasonOptions([]);
        //         }
        //     })
        //     .catch((error) => {
        //         console.error(error);
        //         if (mounted) {
        //             Message.error("Failed to load athlete rankings.");
        //         }
        //     })
        //     .finally(() => {
        //         if (mounted) {
        //             setLoading(false);
        //         }
        //     });

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

    const hasTeamMembers = useMemo(
        () => filteredRows.some((row) => row.isTeam && (row.memberNames.length > 0 || row.members.length > 0)),
        [filteredRows],
    );

    const columns = useMemo<TableColumnProps<AthleteTableRow>[]>(() => {
        const base: TableColumnProps<AthleteTableRow>[] = [
            {
                title: "Rank",
                dataIndex: "rank",
                width: 60,
                render: (rank: number) => <span className="font-semibold text-sm md:text-base">{rank}</span>,
            },
            {
                title: selectedEvent.category === "team_relay" ? "Team" : "Athlete",
                dataIndex: "name",
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
        ];

        if (hasTeamMembers) {
            base.push({
                title: "Members",
                dataIndex: "members",
                width: 240,
                render: (_: string[], row) => {
                    if (!row.isTeam) {
                        return "—";
                    }
                    const ids = Array.isArray(row.members) ? row.members : [];
                    const labels = row.memberNames.length > 0 ? row.memberNames : ids;
                    if (!labels || labels.length === 0) {
                        return "—";
                    }
                    return (
                        <Space size={6} wrap>
                            {labels.map((label, index) => {
                                const memberLabel = label || ids[index] || "Unknown";
                                const memberId = ids[index];
                                const key = `${row.key}-member-${index}-${memberId ?? memberLabel}`;
                                if (typeof memberId === "string" && memberId.length > 0) {
                                    return (
                                        <Link key={key} href={`/athletes/${memberId}`}>
                                            {memberLabel}
                                        </Link>
                                    );
                                }
                                return <span key={key}>{memberLabel}</span>;
                            })}
                        </Space>
                    );
                },
            });
        }

        base.push(
            {
                title: "Country",
                dataIndex: "country",
                width: 160,
                render: (country: string) => (
                    <Space size={6} align="center">
                        <span>{getCountryFlag(country)}</span>
                        <span>{country || "Unknown"}</span>
                    </Space>
                ),
            },
            {
                title: "Division",
                dataIndex: "ageGroup",
                width: 120,
                render: (ageGroup: AgeGroup, row) => (
                    <Space size={4} align="center">
                        <Tag color="arcoblue">{ageGroup}</Tag>
                        {!row.isTeam && typeof row.age === "number" ? (
                            <span className="text-xs text-neutral-500">({row.age})</span>
                        ) : null}
                    </Space>
                ),
            },
            {
                title: "Gender",
                dataIndex: "gender",
                width: 120,
            },
            {
                title: `${selectedEvent.label} Time`,
                dataIndex: "eventTime",
                render: (time: number) => <span className="font-semibold">{formatStackingTime(time)}</span>,
            },
            {
                title: "Season",
                dataIndex: "season",
                width: 160,
                render: (season: SeasonValue | null) =>
                    season ? <Tag color="green">{season}</Tag> : <Tag color="gray">N/A</Tag>,
            },
            {
                title: "Source",
                dataIndex: "source",
                width: 140,
                render: (source: "record" | "derived") => (
                    <Tag color={source === "record" ? "blue" : "orange"}>{source === "record" ? "Recorded" : "Derived"}</Tag>
                ),
            },
        );

        return base;
    }, [selectedEvent, hasTeamMembers]);

    const handleResetFilters = () => {
        setSearchTerm("");
        setAgeFilter("All");
        setGenderFilter("All");
        setLocationFilter("All");
        setSeasonFilter("All");
        setSelectedEventKey(DEFAULT_EVENT.key);
    };

    return (
        <div className="flex flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-left p-6 shadow-lg rounded-lg">
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                        <div className="space-y-1">
                            <Title heading={3} className="!mb-0">
                                Athlete Rankings
                            </Title>
                        </div>
                        <Button type="outline" icon={<IconRefresh />} onClick={handleResetFilters}>
                            Reset filters
                        </Button>
                    </div>
                    <Space wrap size="large">
                        <Input.Search
                            allowClear
                            placeholder="Search athlete or team"
                            style={{width: 260}}
                            value={searchTerm}
                            onChange={(value) => setSearchTerm(value)}
                            onSearch={(value) => setSearchTerm(value)}
                        />
                        <Select value={selectedEventKey} style={{width: 220}} onChange={(value) => setSelectedEventKey(value)}>
                            {EVENT_OPTIONS.map((option) => (
                                <Option key={option.key} value={option.key}>
                                    {option.label}
                                </Option>
                            ))}
                        </Select>
                        <Select value={ageFilter} style={{width: 180}} onChange={(value) => setAgeFilter(value as AgeFilter)}>
                            {AGE_FILTER_OPTIONS.map((option) => (
                                <Option key={option.value} value={option.value}>
                                    {option.label}
                                </Option>
                            ))}
                        </Select>
                        <Select
                            value={genderFilter}
                            style={{width: 150}}
                            onChange={(value) => setGenderFilter(value as GenderFilter)}
                        >
                            {GENDER_FILTER_OPTIONS.map((option) => (
                                <Option key={option.value} value={option.value}>
                                    {option.label}
                                </Option>
                            ))}
                        </Select>
                        <Select value={locationFilter} style={{width: 200}} onChange={(value) => setLocationFilter(value)}>
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
                            value={seasonFilter}
                            style={{width: 180}}
                            onChange={(value) => setSeasonFilter(value as SeasonFilter)}
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
                    </Space>
                </div>

                <Spin loading={loading} tip="Loading rankings...">
                    <Table
                        rowKey="key"
                        data={filteredRows}
                        columns={columns}
                        pagination={{pageSize: 25, hideOnSinglePage: true}}
                        scroll={{x: true}}
                    />
                </Spin>
            </div>
        </div>
    );
};

export default Athletes;
