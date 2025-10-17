// @ts-nocheck
import {useAuthContext} from "@/context/AuthContext";
import type {AgeBracket, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import type {EventResults, PrelimResultData} from "@/schema";
import type {TournamentRecord, TournamentTeamRecord} from "@/schema/RecordSchema";
import {getTournamentFinalRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, updateTournamentStatus} from "@/services/firebase/tournamentsService";
import {exportAllPrelimResultsToPDF} from "@/utils/PDF/pdfExport";
import {getEventLabel, sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import {Button, Message, Modal, Table, Tabs, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconPrinter, IconUndo} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const {TabPane} = Tabs;

type FinalResultRow = PrelimResultData & {
    eventCode?: string;
    expandedRecords?: Record<string, AnyTournamentRecord>;
    team?: Team;
};

type AnyTournamentRecord = TournamentRecord | TournamentTeamRecord;

const normalizeCodeKey = (code: string): string => code.toLowerCase().replace(/[^a-z0-9]/g, "");

const getRawEventCodes = (event: TournamentEvent): string[] => {
    if (event.codes && event.codes.length > 0) return [...event.codes];
    if (event.code) return [event.code];
    return [];
};

const getEventCodes = (event: TournamentEvent): string[] => sanitizeEventCodes(getRawEventCodes(event));

const getPrimaryEventCode = (event: TournamentEvent): string => {
    if (event.code && event.code.trim().length > 0) {
        return event.code;
    }
    const sanitized = getEventCodes(event);
    if (sanitized.length > 0) {
        return sanitized[0];
    }
    const raw = getRawEventCodes(event);
    if (raw.length > 0) {
        return raw[0];
    }
    return event.type;
};

const buildEventTabKey = (event: TournamentEvent): string => `${getPrimaryEventCode(event)}-${event.type}`;

const matchesRecordCode = (record: AnyTournamentRecord, code: string, event: TournamentEvent): boolean => {
    const recordEvent = record.event?.trim().toLowerCase();
    if (!recordEvent) return false;

    const normalizedRecord = recordEvent.replace(/\s+/g, "");
    const normalizedCode = code.toLowerCase().replace(/\s+/g, "");
    const normalizedType = event.type.toLowerCase().replace(/\s+/g, "");

    if (normalizedRecord === `${normalizedCode}-${normalizedType}`) return true;
    if (normalizedRecord === `${normalizedCode}${normalizedType}`) return true;
    if (normalizedRecord === `${normalizedCode}-individual` && normalizedType === "individual") return true;
    if (normalizedRecord === `${normalizedCode}-teamrelay` && normalizedType === "teamrelay") return true;
    if (normalizedRecord === normalizedCode) return true;

    return normalizedRecord.includes(normalizedCode) && normalizedRecord.includes(normalizedType);
};

const recordMatchesEvent = (record: AnyTournamentRecord, event: TournamentEvent): boolean => {
    const codes = getEventCodes(event);
    if (codes.length === 0) {
        const fallback = getPrimaryEventCode(event);
        return matchesRecordCode(record, fallback, event);
    }
    return codes.some((code) => matchesRecordCode(record, code, event));
};

const findEventByTabKey = (events: TournamentEvent[] | undefined, key: string): TournamentEvent | undefined =>
    events?.find((event) => buildEventTabKey(event) === key);

const getRecordEventCode = (record: AnyTournamentRecord, event?: TournamentEvent): string | undefined => {
    if (event?.code === "Overall") {
        return "Overall";
    }
    if (event) {
        const codes = getEventCodes(event);
        for (const code of codes) {
            if (matchesRecordCode(record, code, event)) {
                return code;
            }
        }
        if (event.code) {
            return event.code;
        }
        return getPrimaryEventCode(event);
    }

    if (record.event) {
        const parts = record.event.split("-");
        if (parts.length > 0 && parts[0]) {
            return parts[0];
        }
    }
    return undefined;
};

const buildIndividualColumns = (event: TournamentEvent): TableColumnProps<FinalResultRow>[] => {
    const columns: TableColumnProps<FinalResultRow>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
    ];

    const codes = getEventCodes(event);
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${normalizeCodeKey(code)}Best`;
            columns.push({
                title: code,
                dataIndex: key,
                width: 120,
                render: (_value, record) => {
                    const data = record as unknown as Record<string, unknown>;
                    const value = data[key];
                    return typeof value === "number" ? (value as number).toFixed(3) : "N/A";
                },
            });
        }
        columns.push({
            title: "Total Time",
            dataIndex: "bestTime",
            width: 140,
            render: (value) => (typeof value === "number" ? value.toFixed(3) : "N/A"),
        });
    } else {
        columns.push(
            {title: "Event Code", dataIndex: "eventCode", width: 140, render: (code) => code ?? "N/A"},
            {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Best Time", dataIndex: "bestTime", width: 120, render: (value) => value.toFixed(3)},
        );
    }

    return columns;
};

const buildTeamColumns = (event: TournamentEvent): TableColumnProps<FinalResultRow>[] => {
    const columns: TableColumnProps<FinalResultRow>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "Team Name", dataIndex: "name", width: 200},
        {
            title: "Leader ID",
            width: 160,
            render: (_value, record) => record.team?.leader_id ?? record.id ?? "N/A",
        },
    ];

    const codes = getEventCodes(event);
    if (codes.length > 1) {
        for (const code of codes) {
            const key = `${normalizeCodeKey(code)}Best`;
            columns.push({
                title: code,
                dataIndex: key,
                width: 120,
                render: (_value, record) => {
                    const data = record as unknown as Record<string, unknown>;
                    const value = data[key];
                    return typeof value === "number" ? (value as number).toFixed(3) : "N/A";
                },
            });
        }
        columns.push({
            title: "Total Time",
            dataIndex: "bestTime",
            width: 140,
            render: (value) => (typeof value === "number" ? value.toFixed(3) : "N/A"),
        });
    } else {
        columns.push(
            {title: "Event Code", dataIndex: "eventCode", width: 140, render: (code) => code ?? "N/A"},
            {title: "Try 1", dataIndex: "try1", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 2", dataIndex: "try2", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Try 3", dataIndex: "try3", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
            {title: "Best Time", dataIndex: "bestTime", width: 120, render: (value) => value.toFixed(3)},
        );
    }

    return columns;
};

interface BaseAggregateParams {
    event: TournamentEvent;
    codes: string[];
    records: AnyTournamentRecord[];
    bracket?: AgeBracket;
    classification?: string;
}

interface IndividualAggregateParams extends BaseAggregateParams {
    ageMap: Record<string, number>;
    nameMap: Record<string, string>;
}

interface TeamAggregateParams extends BaseAggregateParams {
    teamMap: Record<string, Team>;
    teamNameMap: Record<string, string>;
}

const aggregateIndividualMultiCodeResults = ({
    event,
    codes,
    records,
    ageMap,
    nameMap,
    bracket,
    classification,
}: IndividualAggregateParams): FinalResultRow[] => {
    const resultsByParticipant = new Map<string, FinalResultRow>();
    const normalizedLookup = codes.map((code) => ({display: code, normalized: code.toLowerCase()}));

    for (const record of records) {
        if (!recordMatchesEvent(record, event)) {
            continue;
        }

        const participantId = typeof record.participantId === "string" ? record.participantId : undefined;
        if (!participantId) {
            continue;
        }

        if (classification && record.classification !== classification) {
            continue;
        }

        if (bracket) {
            const age = ageMap[participantId];
            if (typeof age !== "number" || age < bracket.min_age || age > bracket.max_age) {
                continue;
            }
        }

        const recordCode = getRecordEventCode(record, event);
        if (!recordCode) {
            continue;
        }

        const matched = normalizedLookup.find((entry) => entry.normalized === recordCode.toLowerCase());
        const displayCode = matched?.display ?? normalizedLookup[0]?.display;
        if (!displayCode) {
            continue;
        }

        let aggregate = resultsByParticipant.get(participantId);
        if (!aggregate) {
            aggregate = {
                ...(record as FinalResultRow),
                participantId,
                id: participantId,
                name: nameMap[participantId] || "N/A",
                rank: 0,
                bestTime: 0,
                try1: undefined,
                try2: undefined,
                try3: undefined,
                expandedRecords: {},
                event: `${getPrimaryEventCode(event)}-${event.type}`,
            };
            resultsByParticipant.set(participantId, aggregate);
        }

        aggregate.expandedRecords = aggregate.expandedRecords ?? {};
        aggregate.expandedRecords[displayCode] = record;
        aggregate.classification = record.classification;

        const key = `${normalizeCodeKey(displayCode)}Best`;
        (aggregate as unknown as Record<string, unknown>)[key] = record.bestTime;
    }

    const aggregated = Array.from(resultsByParticipant.values()).filter((row) =>
        codes.every((code) => typeof (row as unknown as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`] === "number"),
    );

    for (const row of aggregated) {
        const total = codes.reduce((sum, code) => {
            const value = (row as unknown as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`];
            return sum + (typeof value === "number" ? (value as number) : 0);
        }, 0);
        row.bestTime = total;
    }

    aggregated.sort((a, b) => a.bestTime - b.bestTime);
    for (let index = 0; index < aggregated.length; index += 1) {
        const row = aggregated[index];
        row.rank = index + 1;
    }

    return aggregated;
};

const aggregateTeamMultiCodeResults = ({
    event,
    codes,
    records,
    teamMap,
    teamNameMap,
    bracket,
    classification,
}: TeamAggregateParams): FinalResultRow[] => {
    const resultsByTeam = new Map<string, FinalResultRow>();
    const normalizedLookup = codes.map((code) => ({display: code, normalized: code.toLowerCase()}));

    for (const record of records) {
        if (!recordMatchesEvent(record, event)) {
            continue;
        }

        const teamId = typeof record.participantId === "string" ? record.participantId : undefined;
        if (!teamId) {
            continue;
        }

        if (classification && record.classification !== classification) {
            continue;
        }

        const team = teamMap[teamId];
        if (!team) {
            continue;
        }

        if (bracket) {
            const largestAge = team.largest_age;
            if (typeof largestAge !== "number" || largestAge < bracket.min_age || largestAge > bracket.max_age) {
                continue;
            }
        }

        const recordCode = getRecordEventCode(record, event);
        if (!recordCode) {
            continue;
        }

        const matched = normalizedLookup.find((entry) => entry.normalized === recordCode.toLowerCase());
        const displayCode = matched?.display ?? normalizedLookup[0]?.display;
        if (!displayCode) {
            continue;
        }

        let aggregate = resultsByTeam.get(teamId);
        if (!aggregate) {
            aggregate = {
                ...(record as FinalResultRow),
                participantId: teamId,
                id: team.leader_id ?? teamId,
                name: teamNameMap[teamId] || team.name || "N/A",
                rank: 0,
                bestTime: 0,
                try1: undefined,
                try2: undefined,
                try3: undefined,
                expandedRecords: {},
                team,
                event: `${getPrimaryEventCode(event)}-${event.type}`,
            };
            resultsByTeam.set(teamId, aggregate);
        }

        aggregate.expandedRecords = aggregate.expandedRecords ?? {};
        aggregate.expandedRecords[displayCode] = record;
        aggregate.classification = record.classification;

        const key = `${normalizeCodeKey(displayCode)}Best`;
        (aggregate as unknown as Record<string, unknown>)[key] = record.bestTime;
    }

    const aggregated = Array.from(resultsByTeam.values()).filter((row) =>
        codes.every((code) => typeof (row as unknown as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`] === "number"),
    );

    for (const row of aggregated) {
        const total = codes.reduce((sum, code) => {
            const value = (row as unknown as Record<string, unknown>)[`${normalizeCodeKey(code)}Best`];
            return sum + (typeof value === "number" ? (value as number) : 0);
        }, 0);
        row.bestTime = total;
    }

    aggregated.sort((a, b) => a.bestTime - b.bestTime);
    for (let index = 0; index < aggregated.length; index += 1) {
        const row = aggregated[index];
        row.rank = index + 1;
    }

    return aggregated;
};

const buildMultiCodeExpandedRows = (
    record: FinalResultRow,
    event: TournamentEvent,
    codes: string[],
    isTeamEvent: boolean,
    allRecords: AnyTournamentRecord[],
) => {
    if (codes.length <= 1) {
        return undefined;
    }

    const rows = codes.map((code) => {
        const normalizedKey = `${normalizeCodeKey(code)}Best`;
        const participantId = typeof record.participantId === "string" ? record.participantId : record.id;

        const baseMatch = record.expandedRecords?.[code]
            ? record.expandedRecords[code]
            : allRecords.find((candidate) => {
                  if (isTeamEvent) {
                      const teamId = record.team?.id ?? record.participantId;
                      return typeof candidate.participantId === "string" && candidate.participantId === teamId
                          ? matchesRecordCode(candidate, code, event)
                          : false;
                  }
                  return (
                      typeof candidate.participantId === "string" &&
                      candidate.participantId === participantId &&
                      matchesRecordCode(candidate, code, event)
                  );
              });

        const storedValue = (record as unknown as Record<string, unknown>)[normalizedKey];
        const bestTime = typeof storedValue === "number" ? (storedValue as number) : baseMatch?.bestTime;

        return {
            code,
            try1: formatTime(baseMatch?.try1),
            try2: formatTime(baseMatch?.try2),
            try3: formatTime(baseMatch?.try3),
            best: formatTime(bestTime),
        };
    });

    const columns: TableColumnProps<{code: string; try1: string; try2: string; try3: string; best: string}>[] = [
        {title: "Event Code", dataIndex: "code", width: 120},
        {title: "Try 1", dataIndex: "try1", width: 100},
        {title: "Try 2", dataIndex: "try2", width: 100},
        {title: "Try 3", dataIndex: "try3", width: 100},
        {title: "Best Time", dataIndex: "best", width: 120},
    ];

    return (
        <div style={{padding: "16px", backgroundColor: "#f9f9f9"}}>
            <Table columns={columns} data={rows} pagination={false} size="small" showHeader={true} />
        </div>
    );
};

export default function FinalResultsPage() {
    const {tournamentId} = useParams<{tournamentId: string}>();
    const navigate = useNavigate();
    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [allRecords, setAllRecords] = useState<AnyTournamentRecord[]>([]);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [teams, setTeams] = useState<Team[]>([]);
    const [currentEventTab, setCurrentEventTab] = useState<string>("");
    const [currentBracketTab, setCurrentBracketTab] = useState<string>("");
    const [currentClassificationTab, setCurrentClassificationTab] = useState<string>("beginner");
    const [availableClassifications, setAvailableClassifications] = useState<string[]>([]);

    useEffect(() => {
        if (!tournamentId) return;

        const fetchData = async () => {
            setLoading(true);
            try {
                const t = await fetchTournamentById(tournamentId);
                if (t?.events) {
                    const individualEvents = ["3-3-3", "3-6-3", "Cycle"];
                    const hasAllIndividualEvents = t.events
                        ? individualEvents.every((eventCode) => t.events?.some((e) => e.code === eventCode))
                        : false;

                    if (hasAllIndividualEvents) {
                        const threeEvent = t.events.find((e) => e.code === "3-3-3");
                        if (threeEvent) {
                            t.events.unshift({
                                ...threeEvent,
                                code: "Overall",
                                type: "Individual",
                            });
                        }
                    }
                    setTournament(t);

                    const firstEvent = t.events?.[0];
                    if (firstEvent) {
                        setCurrentEventTab(buildEventTabKey(firstEvent));
                        const firstBracket = firstEvent.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                        } else {
                            setCurrentBracketTab("");
                        }
                        setCurrentClassificationTab("beginner");
                    }
                } else {
                    setTournament(t);
                }

                const records = await getTournamentFinalRecords(tournamentId);
                setAllRecords(records);

                const regs = await fetchRegistrations(tournamentId);
                setRegistrations(regs);

                const teamData = await fetchTeamsByTournament(tournamentId);
                setTeams(teamData);
            } catch (error) {
                Message.error("Failed to fetch final results.");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [tournamentId]);

    const nameMap = useMemo(
        () =>
            registrations.reduce(
                (acc, r) => {
                    acc[r.user_id] = r.user_name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [registrations],
    );

    const ageMap = useMemo(
        () =>
            registrations.reduce(
                (acc, r) => {
                    acc[r.user_id] = r.age;
                    return acc;
                },
                {} as Record<string, number>,
            ),
        [registrations],
    );

    const teamNameMap = useMemo(
        () =>
            teams.reduce(
                (acc, t) => {
                    acc[t.id] = t.name;
                    return acc;
                },
                {} as Record<string, string>,
            ),
        [teams],
    );

    const teamMap = useMemo(
        () =>
            teams.reduce(
                (acc, team) => {
                    acc[team.id] = team;
                    return acc;
                },
                {} as Record<string, Team>,
            ),
        [teams],
    );

    const overallResults = useMemo<FinalResultRow[]>(() => {
        if (!allRecords.length || !registrations.length) return [];

        const rows = registrations
            .map((reg) => {
                const threeRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("3-3-3"),
                );
                const threeSixThreeRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("3-6-3"),
                );
                const cycleRecord = allRecords.find(
                    (r) => r.participantId === reg.user_id && r.event?.toLowerCase().includes("cycle"),
                );

                if (!threeRecord || !threeSixThreeRecord || !cycleRecord) return null;

                const threeTime = Number.parseFloat(String(threeRecord.bestTime));
                const threeSixThreeTime = Number.parseFloat(String(threeSixThreeRecord.bestTime));
                const cycleTime = Number.parseFloat(String(cycleRecord.bestTime));

                if (
                    Number.isNaN(threeTime) ||
                    Number.isNaN(threeSixThreeTime) ||
                    Number.isNaN(cycleTime) ||
                    threeTime <= 0 ||
                    threeSixThreeTime <= 0 ||
                    cycleTime <= 0
                ) {
                    return null;
                }

                const sum = threeTime + threeSixThreeTime + cycleTime;

                return {
                    ...threeRecord,
                    id: reg.user_id,
                    name: reg.user_name,
                    three: threeTime,
                    threeSixThree: threeSixThreeTime,
                    cycle: cycleTime,
                    bestTime: sum,
                    rank: 0,
                    event: "Overall",
                    eventCode: "Overall",
                };
            })
            .filter((r) => r !== null) as FinalResultRow[];

        const classifiedResults: Record<string, FinalResultRow[]> = {};
        for (const row of rows) {
            const classification = row.classification ?? "beginner";
            if (!classifiedResults[classification]) {
                classifiedResults[classification] = [];
            }
            classifiedResults[classification].push(row);
        }

        const rankedResults: FinalResultRow[] = [];
        for (const classification in classifiedResults) {
            const group = classifiedResults[classification];
            group.sort((a, b) => a.bestTime - b.bestTime);
            group.forEach((r, i) => {
                r.rank = i + 1;
            });
            rankedResults.push(...group);
        }

        return rankedResults;
    }, [allRecords, registrations]);

    const handlePrint = async () => {
        if (!tournament) return;

        setLoading(true);
        try {
            const resultsData: EventResults[] = (tournament.events ?? []).map((event) => {
                const brackets = (event.age_brackets ?? []).flatMap((bracket) => {
                    const classifications = ["beginner", "intermediate", "advance"];
                    return classifications
                        .map((classification) => {
                            const isTeamEvent = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                            const matchesEvent = (record: AnyTournamentRecord) => recordMatchesEvent(record, event);
                            const eventCodes = getEventCodes(event);

                            let records: FinalResultRow[];

                            if (event.code === "Overall") {
                                records = overallResults.filter((r) => {
                                    if (!r.participantId) return false;
                                    const age = ageMap[r.participantId];
                                    return (
                                        age >= bracket.min_age && age <= bracket.max_age && r.classification === classification
                                    );
                                });
                            } else if (eventCodes.length > 1) {
                                records = isTeamEvent
                                    ? aggregateTeamMultiCodeResults({
                                          event,
                                          codes: eventCodes,
                                          records: allRecords,
                                          teamMap,
                                          teamNameMap,
                                          bracket,
                                          classification,
                                      })
                                    : aggregateIndividualMultiCodeResults({
                                          event,
                                          codes: eventCodes,
                                          records: allRecords,
                                          ageMap,
                                          nameMap,
                                          bracket,
                                          classification,
                                      });
                            } else if (isTeamEvent) {
                                records = allRecords
                                    .filter((r) => matchesEvent(r) && r.participantId && r.classification === classification)
                                    .filter((r) => {
                                        const teamId = typeof r.participantId === "string" ? r.participantId : undefined;
                                        if (!teamId) {
                                            return false;
                                        }
                                        const team = teamMap[teamId];
                                        return (
                                            team?.largest_age !== undefined &&
                                            team.largest_age >= bracket.min_age &&
                                            team.largest_age <= bracket.max_age
                                        );
                                    })
                                    .sort((a, b) => a.bestTime - b.bestTime)
                                    .map((record, index) => {
                                        const teamId: string =
                                            typeof record.participantId === "string" ? record.participantId : "";
                                        const team = teamId ? teamMap[teamId] : undefined;
                                        const eventCode = getRecordEventCode(record, event);
                                        return {
                                            ...record,
                                            rank: index + 1,
                                            name: teamNameMap[teamId] || team?.name || "N/A",
                                            id: team?.leader_id ?? teamId ?? "unknown",
                                            eventCode,
                                            team,
                                            expandedRecords: eventCode ? {[eventCode]: record} : undefined,
                                        };
                                    });
                            } else {
                                records = allRecords
                                    .filter((r) => {
                                        if (!matchesEvent(r) || r.classification !== classification) {
                                            return false;
                                        }
                                        const participantId = typeof r.participantId === "string" ? r.participantId : undefined;
                                        if (!participantId) {
                                            return false;
                                        }
                                        const age = ageMap[participantId];
                                        return age >= bracket.min_age && age <= bracket.max_age;
                                    })
                                    .sort((a, b) => a.bestTime - b.bestTime)
                                    .map((record, index) => {
                                        const participantId =
                                            typeof record.participantId === "string" ? record.participantId : "";
                                        const eventCode = getRecordEventCode(record, event);
                                        return {
                                            ...record,
                                            rank: index + 1,
                                            name: nameMap[participantId] || "N/A",
                                            id: participantId,
                                            eventCode,
                                            expandedRecords: eventCode ? {[eventCode]: record} : undefined,
                                        };
                                    });
                            }
                            if (records.length === 0) {
                                return null;
                            }
                            return {
                                bracket,
                                records,
                                classification: classification as "beginner" | "intermediate" | "advance",
                            };
                        })
                        .filter((b) => b !== null);
                });
                return {event, brackets};
            }) as EventResults[];

            await exportAllPrelimResultsToPDF({
                tournament,
                resultsData,
                round: "Final",
            });
            Message.success("PDF preview opened in new tab!");
        } catch (error) {
            Message.error("Failed to generate PDF");
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    const overallColumns: TableColumnProps<FinalResultRow>[] = [
        {title: "Rank", dataIndex: "rank", width: 80},
        {title: "ID", dataIndex: "id", width: 150},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "3-3-3", dataIndex: "three", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "3-6-3", dataIndex: "threeSixThree", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Cycle", dataIndex: "cycle", width: 120, render: (t) => t?.toFixed(3) || "N/A"},
        {title: "Best Time", dataIndex: "bestTime", width: 120, render: (t) => t.toFixed(3)},
    ];

    const currentEvent = useMemo(
        () => findEventByTabKey(tournament?.events ?? [], currentEventTab),
        [tournament?.events, currentEventTab],
    );

    const currentBracket = useMemo(
        () => currentEvent?.age_brackets?.find((b) => b.name === currentBracketTab),
        [currentEvent, currentBracketTab],
    );

    const isOverallEvent = currentEvent?.code === "Overall";
    const isPureIndividualEvent = currentEvent?.type === "Individual" && currentEvent.code !== "Overall";
    const isTeamEvent = currentEvent
        ? ["double", "team relay", "parent & child"].includes(currentEvent.type.toLowerCase())
        : false;

    const getCurrentResults = (): FinalResultRow[] => {
        if (!currentEvent) return [];

        const hasBrackets = (currentEvent.age_brackets?.length ?? 0) > 0;
        const bracket = hasBrackets ? currentBracket : undefined;

        if (hasBrackets && !bracket) {
            return [];
        }

        const eventCodes = getEventCodes(currentEvent);
        const classification = currentClassificationTab;

        if (currentEvent.code === "Overall") {
            return overallResults.filter((r) => {
                if (!r.participantId || !bracket) {
                    return false;
                }
                const age = ageMap[r.participantId];
                return age >= bracket.min_age && age <= bracket.max_age && r.classification === classification;
            });
        }

        const matchesEvent = (record: AnyTournamentRecord) => recordMatchesEvent(record, currentEvent);

        if (eventCodes.length > 1) {
            return isTeamEvent
                ? aggregateTeamMultiCodeResults({
                      event: currentEvent,
                      codes: eventCodes,
                      records: allRecords,
                      teamMap,
                      teamNameMap,
                      bracket,
                      classification,
                  })
                : aggregateIndividualMultiCodeResults({
                      event: currentEvent,
                      codes: eventCodes,
                      records: allRecords,
                      ageMap,
                      nameMap,
                      bracket,
                      classification,
                  });
        }

        if (isTeamEvent) {
            return allRecords
                .filter((r) => matchesEvent(r) && r.participantId && r.classification === classification)
                .filter((r) => {
                    if (!bracket) {
                        return true;
                    }
                    const teamId = typeof r.participantId === "string" ? r.participantId : undefined;
                    if (!teamId) {
                        return false;
                    }
                    const team = teamMap[teamId];
                    if (!team) {
                        return false;
                    }
                    const largestAge = team.largest_age;
                    return typeof largestAge === "number" && largestAge >= bracket.min_age && largestAge <= bracket.max_age;
                })
                .sort((a, b) => a.bestTime - b.bestTime)
                .map((record, index) => {
                    const teamId = typeof record.participantId === "string" ? record.participantId : "";
                    const team = teamId ? teamMap[teamId] : undefined;
                    const eventCode = getRecordEventCode(record, currentEvent);
                    return {
                        ...record,
                        rank: index + 1,
                        name: teamNameMap[teamId] || team?.name || "N/A",
                        id: team?.leader_id ?? teamId ?? "unknown",
                        eventCode,
                        team,
                        expandedRecords: eventCode ? {[eventCode]: record} : undefined,
                    };
                });
        }

        return allRecords
            .filter((r) => {
                if (!matchesEvent(r) || r.classification !== classification) {
                    return false;
                }
                const participantId = typeof r.participantId === "string" ? r.participantId : undefined;
                if (!participantId) {
                    return false;
                }
                if (!bracket) {
                    return true;
                }
                const age = ageMap[participantId];
                return typeof age === "number" && age >= bracket.min_age && age <= bracket.max_age;
            })
            .sort((a, b) => a.bestTime - b.bestTime)
            .map((record, index) => {
                const participantId = typeof record.participantId === "string" ? record.participantId : "";
                const eventCode = getRecordEventCode(record, currentEvent);
                return {
                    ...record,
                    rank: index + 1,
                    name: nameMap[participantId] || "N/A",
                    id: participantId,
                    eventCode,
                    expandedRecords: eventCode ? {[eventCode]: record} : undefined,
                };
            });
    };

    const currentResults = getCurrentResults();

    const getRowKey = (result: FinalResultRow): string => {
        const participantKey =
            typeof result.participantId === "string" && result.participantId.length > 0
                ? result.participantId
                : (result.id ?? result.name ?? "unknown");
        const eventKey = currentEvent ? buildEventTabKey(currentEvent) : "final";
        const codeKey = result.eventCode
            ? result.eventCode
            : result.expandedRecords
              ? Object.keys(result.expandedRecords)
                    .sort((a, b) => a.localeCompare(b))
                    .join("|")
              : (result.event ?? "single");
        return `${eventKey}-${participantKey}-${codeKey}`;
    };

    const buildExpandedRowRenderer = (event: TournamentEvent, codes: string[]) => (record: FinalResultRow) => {
        const getCandidateRecord = (code?: string): AnyTournamentRecord | undefined => {
            if (!code) {
                return undefined;
            }
            if (record.expandedRecords?.[code]) {
                return record.expandedRecords[code];
            }

            const participantId = typeof record.participantId === "string" ? record.participantId : record.id;
            if (!participantId) {
                return undefined;
            }

            return allRecords.find((candidate) => {
                if (typeof candidate.participantId !== "string" || candidate.participantId !== participantId) {
                    return false;
                }
                return matchesRecordCode(candidate, code, event);
            });
        };

        const resolvedCodes =
            codes.length > 0
                ? codes
                : [record.eventCode ?? getRecordEventCode(record as AnyTournamentRecord, event)].filter((item): item is string =>
                      Boolean(item),
                  );

        if (resolvedCodes.length > 1) {
            const teamEventType = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
            return buildMultiCodeExpandedRows(record, event, resolvedCodes, teamEventType, allRecords);
        }

        const singleCode = resolvedCodes[0];
        const eventCode = singleCode ?? record.eventCode ?? getRecordEventCode(record as AnyTournamentRecord, event);
        const sourceRecord = getCandidateRecord(eventCode);
        const eventKey = sourceRecord?.event ?? record.event ?? `${eventCode ?? ""}-${event.type}`;

        return (
            <div style={{padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8}}>
                <div>
                    <strong>Event code:</strong> {eventCode ?? "N/A"}
                </div>
                <div>
                    <strong>Event key:</strong> {eventKey}
                </div>
                <div
                    style={{
                        display: "grid",
                        gap: 8,
                        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                    }}
                >
                    <div>
                        <strong>Try 1:</strong> {formatTime(sourceRecord?.try1 ?? record.try1)}
                    </div>
                    <div>
                        <strong>Try 2:</strong> {formatTime(sourceRecord?.try2 ?? record.try2)}
                    </div>
                    <div>
                        <strong>Try 3:</strong> {formatTime(sourceRecord?.try3 ?? record.try3)}
                    </div>
                    <div>
                        <strong>Best Time:</strong> {formatTime(sourceRecord?.bestTime ?? record.bestTime)}
                    </div>
                </div>
            </div>
        );
    };

    useEffect(() => {
        if (!currentEvent) return;

        const hasBrackets = (currentEvent.age_brackets?.length ?? 0) > 0;
        const bracket = hasBrackets ? currentBracket : undefined;
        if (hasBrackets && !bracket) {
            return;
        }

        const eventCodes = currentEvent ? getEventCodes(currentEvent) : [];
        const classificationsWithData = ["beginner", "intermediate", "advance"].filter((classification) => {
            if (isOverallEvent) {
                if (!bracket) {
                    return false;
                }
                return overallResults.some(
                    (r) =>
                        r.classification === classification &&
                        r.participantId &&
                        ageMap[r.participantId] >= bracket.min_age &&
                        ageMap[r.participantId] <= bracket.max_age,
                );
            }

            const matchesEvent = (record: AnyTournamentRecord) => recordMatchesEvent(record, currentEvent);

            if (eventCodes.length > 1) {
                const aggregated = isTeamEvent
                    ? aggregateTeamMultiCodeResults({
                          event: currentEvent,
                          codes: eventCodes,
                          records: allRecords,
                          teamMap,
                          teamNameMap,
                          bracket,
                          classification,
                      })
                    : aggregateIndividualMultiCodeResults({
                          event: currentEvent,
                          codes: eventCodes,
                          records: allRecords,
                          ageMap,
                          nameMap,
                          bracket,
                          classification,
                      });
                return aggregated.length > 0;
            }

            if (isTeamEvent) {
                return allRecords.some(
                    (r) =>
                        matchesEvent(r) &&
                        r.participantId &&
                        r.classification === classification &&
                        (!bracket ||
                            teams.some(
                                (t) =>
                                    t.id === r.participantId &&
                                    t.largest_age >= bracket.min_age &&
                                    t.largest_age <= bracket.max_age,
                            )),
                );
            }

            return allRecords.some((r) => {
                if (!matchesEvent(r) || r.classification !== classification) {
                    return false;
                }
                const participantId = typeof r.participantId === "string" ? r.participantId : undefined;
                if (!participantId || !bracket) {
                    return false;
                }
                const age = ageMap[participantId];
                return age >= bracket.min_age && age <= bracket.max_age;
            });
        });

        setAvailableClassifications(classificationsWithData);
        if (classificationsWithData.length > 0 && !classificationsWithData.includes(currentClassificationTab)) {
            setCurrentClassificationTab(classificationsWithData[0]);
        }
    }, [
        currentEvent,
        currentBracket,
        allRecords,
        overallResults,
        teams,
        ageMap,
        isOverallEvent,
        isTeamEvent,
        currentClassificationTab,
    ]);

    const handleEndCompetition = async () => {
        if (!tournamentId || !user) return;

        Modal.confirm({
            title: "Confirm End of Competition",
            content: "Are you sure you want to mark this tournament as ended? This action cannot be undone.",
            onOk: async () => {
                setLoading(true);
                try {
                    await updateTournamentStatus(user, tournamentId, "End");
                    Message.success("Tournament status updated to End.");
                    const t = await fetchTournamentById(tournamentId);
                    if (t) {
                        if (t.events) {
                            const individualEvents = ["3-3-3", "3-6-3", "Cycle"];
                            const hasAllIndividualEvents = individualEvents.every((eventCode) =>
                                t.events?.some((e) => e.code === eventCode),
                            );

                            if (hasAllIndividualEvents) {
                                const threeEvent = t.events.find((e) => e.code === "3-3-3");
                                if (threeEvent && !t.events.some((e) => e.code === "Overall")) {
                                    t.events.unshift({
                                        ...threeEvent,
                                        code: "Overall",
                                        type: "Individual",
                                    });
                                }
                            }
                        }
                        setTournament(t);
                    }
                    navigate(`/tournaments`);
                } catch (error: unknown) {
                    if (error instanceof Error) {
                        Message.error(error.message || "Failed to update tournament status.");
                    } else {
                        Message.error("An unknown error occurred while updating tournament status.");
                    }
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button
                type="outline"
                onClick={() => navigate(`/tournaments/${tournamentId}/scoring/final`)}
                className="w-fit pt-2 pb-2"
            >
                <IconUndo /> Go Back
            </Button>
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full flex justify-between items-center">
                    <Title heading={3}>Final Results</Title>
                    <div className="flex items-center gap-2">
                        <Button type="primary" icon={<IconPrinter />} onClick={handlePrint} loading={loading}>
                            Print All Brackets
                        </Button>
                        {user?.roles?.edit_tournament && tournament?.status !== "End" && (
                            <Button type="primary" status="success" onClick={handleEndCompetition} loading={loading}>
                                End Competition
                            </Button>
                        )}
                    </div>
                </div>
                <Tabs
                    type="line"
                    className="w-full"
                    activeTab={currentEventTab}
                    onChange={(key) => {
                        setCurrentEventTab(key);
                        const event = findEventByTabKey(tournament?.events ?? [], key);
                        const firstBracket = event?.age_brackets?.[0];
                        if (firstBracket) {
                            setCurrentBracketTab(firstBracket.name);
                        } else {
                            setCurrentBracketTab("");
                        }
                        setCurrentClassificationTab("beginner");
                    }}
                >
                    {tournament?.events?.map((event) => {
                        const eventKey = buildEventTabKey(event);
                        const eventLabel = getEventLabel(event) || `${getPrimaryEventCode(event)} (${event.type})`;
                        const eventIsOverall = event.code === "Overall";
                        const eventIsTeam = ["double", "team relay", "parent & child"].includes(event.type.toLowerCase());
                        const eventIsPureIndividual = event.type === "Individual" && event.code !== "Overall";
                        const eventCodes = getEventCodes(event);
                        const expandedRowRender = (record: FinalResultRow) => {
                            buildMultiCodeExpandedRows(record, event, eventCodes, eventIsTeam, allRecords);
                        };
                        const isActiveEvent = eventKey === currentEventTab;
                        const eventHasBrackets = (event.age_brackets?.length ?? 0) > 0;
                        const tableColumns = eventIsOverall
                            ? overallColumns
                            : eventIsTeam
                              ? buildTeamColumns(event)
                              : buildIndividualColumns(event);

                        return (
                            <TabPane key={eventKey} title={eventLabel}>
                                {eventHasBrackets ? (
                                    <Tabs
                                        type="capsule"
                                        className="w-full"
                                        activeTab={currentBracketTab}
                                        onChange={setCurrentBracketTab}
                                    >
                                        {event.age_brackets?.map((bracket) => {
                                            const isActiveBracket = isActiveEvent && bracket.name === currentBracketTab;
                                            const bracketData = isActiveBracket ? currentResults : [];

                                            return (
                                                <TabPane key={bracket.name} title={bracket.name}>
                                                    {eventIsPureIndividual ? (
                                                        <Table
                                                            style={{width: "100%"}}
                                                            columns={tableColumns}
                                                            data={bracketData}
                                                            pagination={false}
                                                            loading={loading}
                                                            rowKey={getRowKey}
                                                            expandedRowRender={eventCodes.length > 1 ? expandedRowRender : null}
                                                        />
                                                    ) : isActiveBracket && availableClassifications.length > 0 ? (
                                                        <Tabs
                                                            type="rounded"
                                                            activeTab={currentClassificationTab}
                                                            onChange={setCurrentClassificationTab}
                                                        >
                                                            {availableClassifications.map((classification) => {
                                                                const isActiveClassification =
                                                                    classification === currentClassificationTab &&
                                                                    isActiveBracket;
                                                                const classificationData = isActiveClassification
                                                                    ? currentResults
                                                                    : [];
                                                                return (
                                                                    <TabPane key={classification} title={classification}>
                                                                        <Table
                                                                            style={{width: "100%"}}
                                                                            columns={tableColumns}
                                                                            data={classificationData}
                                                                            pagination={false}
                                                                            loading={loading}
                                                                            rowKey={getRowKey}
                                                                            expandedRowRender={
                                                                                eventCodes.length > 1 ? expandedRowRender : null
                                                                            }
                                                                        />
                                                                    </TabPane>
                                                                );
                                                            })}
                                                        </Tabs>
                                                    ) : eventIsOverall ? (
                                                        <Table
                                                            style={{width: "100%"}}
                                                            columns={overallColumns}
                                                            data={[]}
                                                            pagination={false}
                                                            loading={loading}
                                                            rowKey={getRowKey}
                                                        />
                                                    ) : (
                                                        <Table
                                                            style={{width: "100%"}}
                                                            columns={tableColumns}
                                                            data={[]}
                                                            pagination={false}
                                                            loading={loading}
                                                            rowKey={getRowKey}
                                                            expandedRowRender={eventCodes.length > 1 ? expandedRowRender : null}
                                                        />
                                                    )}
                                                </TabPane>
                                            );
                                        })}
                                    </Tabs>
                                ) : (
                                    <Table
                                        style={{width: "100%"}}
                                        columns={tableColumns}
                                        data={isActiveEvent ? currentResults : []}
                                        pagination={false}
                                        loading={loading}
                                        rowKey={getRowKey}
                                        expandedRowRender={eventCodes.length > 1 ? expandedRowRender : null}
                                    />
                                )}
                            </TabPane>
                        );
                    })}
                </Tabs>
            </div>
        </div>
    );
}

/**
 * Formats a time value (number or undefined) to a string with 3 decimal places, or "N/A" if invalid.
 */
export function formatTime(time?: number): string {
    if (typeof time !== "number" || Number.isNaN(time) || time <= 0) {
        return "N/A";
    }
    return time.toFixed(3);
}
