import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import {fetchUsersByIds} from "@/services/firebase/authService";
import {deleteRegistrationById, fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {findDuplicateEventSelections, groupEventSelections} from "@/utils/tournament/eventUtils";
import {Button, Dropdown, Input, Message, Popconfirm, type TableColumnProps, Tag} from "@arco-design/web-react";
import Table from "@arco-design/web-react/es/Table/table";
import Title from "@arco-design/web-react/es/Typography/title";
import {IconDelete, IconEye, IconEyeInvisible, IconUndo} from "@arco-design/web-react/icon";
import type {Timestamp} from "firebase/firestore";
import {useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useNavigate, useParams, useSearchParams} from "react-router-dom";
import {useMount} from "react-use";

const PAGE_SIZE = 10;

const parsePositivePage = (value: string | null): number => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

export default function RegistrationsListPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();
    const deviceBreakpoint = useDeviceBreakpoint();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();

    const [loading, setLoading] = useState<boolean>(true);
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const mountedRef = useRef(false);
    const [registrations, setRegistrations] = useState<Registration[]>([]); // Replace 'any' with your actual registration type
    const [teams, setTeams] = useState<Team[]>([]);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [userMap, setUserMap] = useState<Record<string, FirestoreUser>>({});
    const [tournamentTitle, setTournamentTitle] = useState<string>();
    const [searchTerm, setSearchTerm] = useState<string>(() => searchParams.get("search") ?? "");
    const [currentPage, setCurrentPage] = useState<number>(() => parsePositivePage(searchParams.get("page")));
    const [sortField, setSortField] = useState<string>(() => searchParams.get("sortField") ?? "");
    const [sortDirection, setSortDirection] = useState<"ascend" | "descend" | undefined>(() => {
        const direction = searchParams.get("sortDirection");
        return direction === "ascend" || direction === "descend" ? direction : undefined;
    });

    const teamVerificationByRegistration = useMemo(() => {
        return teams.reduce(
            (acc, team) => {
                const registrationId = team.registration_id ?? "";
                if (!registrationId) {
                    return acc;
                }
                if (!acc[registrationId]) {
                    acc[registrationId] = [];
                }
                acc[registrationId].push(team);
                return acc;
            },
            {} as Record<string, Team[]>,
        );
    }, [teams]);

    const refreshRegistrationsList = async () => {
        if (!tournamentId) return;

        setLoading(true);
        try {
            const [tempRegistrations, fetchedTeams, fetchedEvents] = await Promise.all([
                fetchRegistrations(tournamentId),
                fetchTeamsByTournament(tournamentId),
                fetchTournamentEvents(tournamentId),
            ]);
            setRegistrations(tempRegistrations);
            setTeams(fetchedTeams);
            setEvents(fetchedEvents);
            const userIds = tempRegistrations.map((registration) => registration.user_id).filter(Boolean);
            const usersById = await fetchUsersByIds(userIds);
            setUserMap(usersById);

            const tournament = await fetchTournamentById(tournamentId);
            setTournamentTitle(tournament?.name ?? "");
        } catch (error) {
            console.error("Failed to refresh registrations:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRegistration = async (registrationId: string) => {
        if (!tournamentId) return;

        setLoading(true);
        try {
            // Here you would call your delete service function
            await deleteRegistrationById(tournamentId, registrationId, {adminDelete: true});
            Message.success("Registration deleted successfully.");
            await refreshRegistrationsList();
        } catch (error) {
            console.error("Failed to delete registration:", error);
            Message.error("Failed to delete registration.");
        } finally {
            setLoading(false);
        }
    };

    const handleMount = async () => {
        setLoading(true);
        try {
            await refreshRegistrationsList();
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;

        handleMount().finally(() => setIsMounted(true));
    });

    useEffect(() => {
        const nextParams = new URLSearchParams(searchParams);

        if (searchTerm.trim()) {
            nextParams.set("search", searchTerm.trim());
        } else {
            nextParams.delete("search");
        }

        if (currentPage > 1) {
            nextParams.set("page", `${currentPage}`);
        } else {
            nextParams.delete("page");
        }

        if (sortField && sortDirection) {
            nextParams.set("sortField", sortField);
            nextParams.set("sortDirection", sortDirection);
        } else {
            nextParams.delete("sortField");
            nextParams.delete("sortDirection");
        }

        if (searchParams.toString() !== nextParams.toString()) {
            setSearchParams(nextParams, {replace: true});
        }
    }, [currentPage, searchParams, searchTerm, setSearchParams, sortDirection, sortField]);

    const registrationEventDebugMap = useMemo(() => {
        return registrations.reduce(
            (acc, registration) => {
                const groups = groupEventSelections(registration.events_registered, events);
                acc[registration.id ?? ""] = {
                    groups,
                    duplicates: findDuplicateEventSelections(registration.events_registered, events),
                };
                return acc;
            },
            {} as Record<
                string,
                {
                    groups: ReturnType<typeof groupEventSelections>;
                    duplicates: ReturnType<typeof findDuplicateEventSelections>;
                }
            >,
        );
    }, [events, registrations]);

    const columns: (TableColumnProps<(typeof registrations)[number]> | false)[] = [
        {
            title: "ID",
            dataIndex: "user_global_id",
            width: 200,
        },
        {
            title: "Name",
            dataIndex: "user_name",
            width: 300,
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "IC",
            width: 200,
            render: (_: string, record: Registration) => <span>{userMap[record.user_id]?.IC ?? "-"}</span>,
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Created At",
            dataIndex: "created_at",
            width: 200,
            sortOrder: sortField === "created_at" ? sortDirection : undefined,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString("en-GB") ?? "-",
            sorter: (a: Registration, b: Registration) => {
                const aTime = a.created_at?.toDate?.()?.getTime?.() ?? 0;
                const bTime = b.created_at?.toDate?.()?.getTime?.() ?? 0;
                return aTime - bTime;
            },
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Status",
            dataIndex: "registration_status",
            width: 200,
            sortOrder: sortField === "registration_status" ? sortDirection : undefined,
            sorter: (a: Registration, b: Registration) => {
                const statusOrder = ["pending", "approved", "rejected"];
                const getSortRank = (record: Registration) => {
                    const teamsForRegistration = record.id ? (teamVerificationByRegistration[record.id] ?? []) : [];
                    const hasTeams = teamsForRegistration.length > 0;
                    const teamVerified = hasTeams && teamsForRegistration.every((team) => isTeamFullyVerified(team));
                    const statusValue = record.registration_status?.toLowerCase?.() ?? "";
                    const statusIndex = statusOrder.indexOf(statusValue);
                    const normalizedStatusIndex = statusIndex === -1 ? statusOrder.length : statusIndex;
                    const teamBucket = hasTeams ? (teamVerified ? 1 : 0) : 2;
                    return normalizedStatusIndex * 10 + teamBucket;
                };
                const rankDiff = getSortRank(a) - getSortRank(b);
                if (rankDiff !== 0) {
                    return rankDiff;
                }
                const nameA = a.user_name?.toLowerCase?.() ?? "";
                const nameB = b.user_name?.toLowerCase?.() ?? "";
                if (nameA && nameB && nameA !== nameB) {
                    return nameA.localeCompare(nameB);
                }
                const idA = a.user_global_id?.toLowerCase?.() ?? "";
                const idB = b.user_global_id?.toLowerCase?.() ?? "";
                return idA.localeCompare(idB);
            },
            render: (status: string, record: Registration) => {
                let color: string | undefined;
                if (status === "pending") {
                    color = "blue";
                } else if (status === "approved") {
                    color = "green";
                } else if (status === "rejected") {
                    color = "red";
                } else {
                    color = undefined;
                }
                const teamsForRegistration = record.id ? (teamVerificationByRegistration[record.id] ?? []) : [];
                const teamVerified =
                    teamsForRegistration.length > 0 && teamsForRegistration.every((team) => isTeamFullyVerified(team));
                return (
                    <div className="flex flex-wrap gap-2">
                        <Tag color={color}>{status}</Tag>
                        {teamsForRegistration.length > 0 &&
                            (teamVerified ? <Tag color="green">Team Verified</Tag> : <Tag color="red">Team Not Verified</Tag>)}
                    </div>
                );
            },
        },
        {
            title: "Events",
            width: 360,
            sortOrder: sortField === "events" ? sortDirection : undefined,
            sorter: (a: Registration, b: Registration) => {
                const debugA = a.id ? registrationEventDebugMap[a.id] : undefined;
                const debugB = b.id ? registrationEventDebugMap[b.id] : undefined;
                const duplicateCountA = debugA?.duplicates.length ?? 0;
                const duplicateCountB = debugB?.duplicates.length ?? 0;

                if (duplicateCountA !== duplicateCountB) {
                    return duplicateCountB - duplicateCountA;
                }

                const labelA = (debugA?.groups ?? [])
                    .map((group) => group.label)
                    .join(", ")
                    .toLowerCase();
                const labelB = (debugB?.groups ?? [])
                    .map((group) => group.label)
                    .join(", ")
                    .toLowerCase();

                if (labelA !== labelB) {
                    return labelA.localeCompare(labelB);
                }

                return (a.user_name ?? "").localeCompare(b.user_name ?? "", undefined, {sensitivity: "base"});
            },
            render: (_: string, record: Registration) => {
                const debugInfo = record.id ? registrationEventDebugMap[record.id] : undefined;
                const groups = debugInfo?.groups ?? [];
                const duplicates = debugInfo?.duplicates ?? [];

                return (
                    <div className="flex flex-wrap gap-2">
                        {groups.length > 0 ? (
                            groups.map((group) => <Tag key={`${record.id}-${group.canonicalKey}`}>{group.label}</Tag>)
                        ) : (
                            <span>-</span>
                        )}
                        {duplicates.map((group) => (
                            <Tag key={`${record.id}-${group.canonicalKey}-duplicate`} color="red">
                                Duplicate: {group.label} ({group.values.join(" / ")})
                            </Tag>
                        ))}
                    </div>
                );
            },
        },
        {
            title: "Action",
            dataIndex: "action",
            width: 120,
            render: (_: string, registration: Registration) => {
                return (
                    <Popconfirm
                        focusLock
                        title={"Delete tournament registration"}
                        content={
                            <div className={`flex flex-col`}>
                                <div>Are you sure want to delete this registration?</div>
                            </div>
                        }
                        onOk={(e) => {
                            handleDeleteRegistration(registration?.id ?? "");
                            e.stopPropagation();
                        }}
                        okText="Yes"
                        cancelText="No"
                        onCancel={(e) => {
                            e.stopPropagation();
                        }}
                        okButtonProps={{status: "danger"}}
                    >
                        <Button
                            title={"Delete this registration"}
                            type="secondary"
                            status="danger"
                            loading={loading}
                            icon={<IconDelete />}
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        />
                    </Popconfirm>
                );
            },
        },
    ];

    const filteredRegistrations = registrations.filter((registration) => {
        const query = searchTerm.trim().toLowerCase();
        if (!query) return true;
        const globalId = registration.user_global_id?.toLowerCase() ?? "";
        const name = registration.user_name?.toLowerCase() ?? "";
        const ic = userMap[registration.user_id]?.IC?.toLowerCase() ?? "";
        return globalId.includes(query) || name.includes(query) || ic.includes(query);
    });

    useEffect(() => {
        if (loading) {
            return;
        }

        const totalPages = Math.max(1, Math.ceil(filteredRegistrations.length / PAGE_SIZE));
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, filteredRegistrations.length, loading]);

    return (
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className="w-full flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <Title heading={4}>{tournamentTitle}</Title>
                    <Input
                        placeholder="Search by name or ID"
                        allowClear
                        value={searchTerm}
                        onChange={(value) => {
                            setSearchTerm(value);
                            setCurrentPage(1);
                        }}
                        className="md:max-w-[320px]"
                    />
                </div>
                <Table
                    columns={columns.filter((e): e is TableColumnProps<(typeof registrations)[number]> => !!e)}
                    data={filteredRegistrations}
                    pagination={{pageSize: PAGE_SIZE, current: currentPage}}
                    className="my-4"
                    rowKey={(record) => record.id ?? ""}
                    rowClassName={() => "cursor-pointer hover:bg-gray-50"}
                    onChange={(pagination, sorter) => {
                        setCurrentPage(pagination.current ?? 1);

                        if (!Array.isArray(sorter) && sorter.field && sorter.direction) {
                            setSortField(String(sorter.field));
                            setSortDirection(sorter.direction);
                            return;
                        }

                        setSortField("");
                        setSortDirection(undefined);
                    }}
                    onRow={(record) => ({
                        onClick: () => {
                            navigate(`/tournaments/${tournamentId}/registrations/${record.id}/edit${location.search}`);
                        },
                    })}
                />
            </div>
        </div>
    );
}
