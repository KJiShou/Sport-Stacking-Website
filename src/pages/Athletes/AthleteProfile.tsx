import {useEffect, useMemo, useState} from "react";
import {useParams} from "react-router-dom";

import {
    Avatar,
    Button,
    Divider,
    Empty,
    Result,
    Space,
    Spin,
    Table,
    type TableColumnProps,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconUndo} from "@arco-design/web-react/icon";
import type {Timestamp} from "firebase/firestore";

import type {FirestoreUser} from "@/schema/UserSchema";
import {type EventType, getTopAthletesByEvent} from "@/services/firebase/athleteRankingsService";
import {getUserByGlobalId} from "@/services/firebase/authService";
import {formatDateSafe, formatStackingTime} from "@/utils/time";

const {Title, Text} = Typography;

interface BestTimeRecord {
    event: EventType;
    time: number;
    season: string | null;
    updatedAt: Date | null;
    rank: number | null;
}

interface TournamentRecord {
    tournamentId: string;
    tournamentName?: string;
    events: string[];
    registrationDate: Date | null;
    status: string;
    prelimRank: number | null;
    finalRank: number | null;
    prelimOverall: number | null;
    finalOverall: number | null;
}

const STATUS_COLORS: Record<string, string> = {
    verified: "green",
    submitted: "orange",
    registered: "purple",
    pending: "orange",
    approved: "green",
    rejected: "red",
};

const toDate = (value: Date | Timestamp | null | undefined): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if ("toDate" in value && typeof value.toDate === "function") {
        return value.toDate();
    }
    return null;
};

const AthleteProfilePage = () => {
    const {athleteId} = useParams<{athleteId: string}>();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [rankings, setRankings] = useState<Record<EventType, number | null>>({
        "3-3-3": null,
        "3-6-3": null,
        Cycle: null,
        Overall: null,
    });

    useEffect(() => {
        if (!athleteId) {
            setError("Missing athlete identifier.");
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        Promise.all([
            getUserByGlobalId(athleteId),
            getTopAthletesByEvent("3-3-3", 1000),
            getTopAthletesByEvent("3-6-3", 1000),
            getTopAthletesByEvent("Cycle", 1000),
            getTopAthletesByEvent("Overall", 1000),
        ])
            .then(([userData, rankings333, rankings363, rankingsCycle, rankingsOverall]) => {
                if (!cancelled) {
                    setUser(userData ?? null);
                    if (!userData) {
                        setError("No athlete data found.");
                    } else {
                        // Calculate rankings
                        const rank333 = rankings333.findIndex((u) => u.global_id === athleteId || u.id === athleteId);
                        const rank363 = rankings363.findIndex((u) => u.global_id === athleteId || u.id === athleteId);
                        const rankCycle = rankingsCycle.findIndex((u) => u.global_id === athleteId || u.id === athleteId);
                        const rankOverall = rankingsOverall.findIndex(
                            (u) => u.global_id === athleteId || u.id === athleteId,
                        );

                        setRankings({
                            "3-3-3": rank333 >= 0 ? rank333 + 1 : null,
                            "3-6-3": rank363 >= 0 ? rank363 + 1 : null,
                            Cycle: rankCycle >= 0 ? rankCycle + 1 : null,
                            Overall: rankOverall >= 0 ? rankOverall + 1 : null,
                        });
                    }
                }
            })
            .catch((err) => {
                console.error(err);
                if (!cancelled) {
                    setError("Failed to load athlete profile.");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [athleteId]);

    const bestTimes = useMemo<BestTimeRecord[]>(() => {
        if (!user?.best_times) return [];

        const events: EventType[] = ["3-3-3", "3-6-3", "Cycle", "Overall"];
        return events
            .map((event) => {
                const record = user.best_times?.[event];
                if (!record || !record.time) return null;

                return {
                    event,
                    time: record.time,
                    season: record.season ?? null,
                    updatedAt: toDate(record.updated_at),
                    rank: rankings[event],
                };
            })
            .filter((record): record is BestTimeRecord => record !== null);
    }, [user, rankings]);

    const tournaments = useMemo<TournamentRecord[]>(() => {
        if (!user?.registration_records) return [];

        // Only show approved registrations
        return user.registration_records
            .filter((reg) => reg.status === "approved")
            .map((reg) => ({
                tournamentId: reg.tournament_id,
                events: reg.events ?? [],
                registrationDate: toDate(reg.updated_at) ?? toDate(reg.registration_date),
                status: reg.status ?? "pending",
                prelimRank: reg.prelim_rank ?? null,
                finalRank: reg.final_rank ?? null,
                prelimOverall: reg.prelim_overall_result ?? null,
                finalOverall: reg.final_overall_result ?? null,
            }));
    }, [user]);

    const bestTimeColumns: TableColumnProps<BestTimeRecord>[] = useMemo(
        () => [
            {
                title: "Event",
                dataIndex: "event",
                width: 120,
            },
            {
                title: "Best Time",
                dataIndex: "time",
                width: 150,
                render: (time: number) => <span className="font-semibold text-lg">{formatStackingTime(time)}</span>,
            },
            {
                title: "Ranking",
                dataIndex: "rank",
                width: 120,
                render: (rank: number | null) =>
                    rank ? (
                        <Tag color="green" className="text-base font-semibold">
                            #{rank}
                        </Tag>
                    ) : (
                        <Tag color="gray">N/A</Tag>
                    ),
            },
            {
                title: "Season",
                dataIndex: "season",
                width: 120,
                render: (season: string | null) => season ?? "—",
            },
            {
                title: "Last Updated",
                dataIndex: "updatedAt",
                width: 150,
                render: (date: Date | null) => formatDateSafe(date),
            },
        ],
        [],
    );

    const tournamentColumns: TableColumnProps<TournamentRecord>[] = useMemo(
        () => [
            {
                title: "Date",
                dataIndex: "registrationDate",
                width: 150,
                render: (date: Date | null) => formatDateSafe(date),
            },
            {
                title: "Prelim Rank",
                dataIndex: "prelimRank",
                width: 120,
                render: (rank: number | null) => (rank ? `#${rank}` : "—"),
            },
            {
                title: "Prelim Overall",
                dataIndex: "prelimOverall",
                width: 150,
                render: (time: number | null) => (time ? formatStackingTime(time) : "—"),
            },
            {
                title: "Final Rank",
                dataIndex: "finalRank",
                width: 120,
                render: (rank: number | null) => (rank ? `#${rank}` : "—"),
            },
            {
                title: "Final Overall",
                dataIndex: "finalOverall",
                width: 150,
                render: (time: number | null) => (time ? formatStackingTime(time) : "—"),
            },
        ],
        [],
    );

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <Spin size={32} tip="Loading athlete profile..." />
            </div>
        );
    }

    if (error || !user) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen p-6">
                <Result status="error" title="Unable to load athlete" subTitle={error ?? "Something went wrong."}>
                    <Button icon={<IconUndo />} type="outline" onClick={() => window.history.back()}>
                        Go Back
                    </Button>
                </Result>
            </div>
        );
    }

    const age = user.birthdate
        ? (() => {
              const birthDate = toDate(user.birthdate);
              if (!birthDate) return null;
              const now = new Date();
              let calculatedAge = now.getFullYear() - birthDate.getFullYear();
              const hasHadBirthdayThisYear =
                  now.getMonth() > birthDate.getMonth() ||
                  (now.getMonth() === birthDate.getMonth() && now.getDate() >= birthDate.getDate());
              if (!hasHadBirthdayThisYear) {
                  calculatedAge -= 1;
              }
              return calculatedAge;
          })()
        : null;

    const country = Array.isArray(user.country) && user.country.length > 0 ? user.country[0] : (user.country ?? "—");

    return (
        <div className="flex flex-col bg-ghostwhite p-0 md:p-6 xl:p-10 gap-6">
            <Button type="outline" onClick={() => window.history.back()} className="w-fit pt-2 pb-2">
                <IconUndo /> Go Back
            </Button>

            <div className="bg-white flex flex-col w-full h-fit gap-6 items-start p-6 md:p-10 shadow-lg rounded-lg">
                <div className="flex items-start gap-8 w-full">
                    <Avatar size={120} shape="circle" className="flex-shrink-0">
                        {user.image_url ? <img src={user.image_url} alt={user.name} /> : user.name.charAt(0)}
                    </Avatar>
                    <div className="flex flex-col gap-4 flex-1">
                        <div className="flex items-center gap-3">
                            <Title heading={2} className="flex items-center gap-3">
                                {user.name}
                                <Tag color="arcoblue" className="">
                                    ID: {user.global_id ?? user.id}
                                </Tag>
                            </Title>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-base">
                            <div className="flex flex-col gap-1">
                                <Text type="secondary" className="text-sm">
                                    Country
                                </Text>
                                <Text className="font-semibold text-lg">{country}</Text>
                            </div>
                            <div className="flex flex-col gap-1">
                                <Text type="secondary" className="text-sm">
                                    Gender
                                </Text>
                                <Text className="font-semibold text-lg">{user.gender ?? "—"}</Text>
                            </div>
                            <div className="flex flex-col gap-1">
                                <Text type="secondary" className="text-sm">
                                    Age
                                </Text>
                                <Text className="font-semibold text-lg">{age ?? "—"}</Text>
                            </div>
                            <div className="flex flex-col gap-1">
                                <Text type="secondary" className="text-sm">
                                    Email
                                </Text>
                                <Text className="font-semibold text-base">{user.email}</Text>
                            </div>
                        </div>
                    </div>
                </div>

                <Divider style={{margin: 0}} />

                <div className="w-full">
                    <Title heading={4} className="!mb-4">
                        Best Performances
                    </Title>
                    {bestTimes.length === 0 ? (
                        <Empty description="No best times recorded yet." />
                    ) : (
                        <Table
                            rowKey="event"
                            columns={bestTimeColumns}
                            data={bestTimes}
                            pagination={false}
                            scroll={{x: true}}
                            border={false}
                        />
                    )}
                </div>

                <Divider style={{margin: 0}} />

                <div className="w-full">
                    <Title heading={4} className="!mb-4">
                        Tournament Participation
                    </Title>
                    {tournaments.length === 0 ? (
                        <Empty description="No tournament participation records found." />
                    ) : (
                        <Table
                            rowKey="tournamentId"
                            columns={tournamentColumns}
                            data={tournaments}
                            pagination={{pageSize: 10}}
                            scroll={{x: true}}
                            border={false}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default AthleteProfilePage;
