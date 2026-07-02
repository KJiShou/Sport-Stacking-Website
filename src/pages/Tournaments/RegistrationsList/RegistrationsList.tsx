import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Registration, Team, Tournament, TournamentEvent} from "@/schema";
import {countries} from "@/schema/Country";
import {fetchUsersByIds} from "@/services/firebase/authService";
import {type ImportWorkbookResult, importTournamentWorkbook} from "@/services/firebase/importService";
import {deleteRegistrationById, fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {stripTeamLeaderPrefix} from "@/utils/teamLeaderId";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {findDuplicateEventSelections, getTeamEvents, groupEventSelections} from "@/utils/tournament/eventUtils";
import {downloadTournamentImportTemplate} from "@/utils/tournament/importTemplate";
import {
    Button,
    Form,
    Input,
    Message,
    Modal,
    Popconfirm,
    Select,
    Spin,
    type TableColumnProps,
    Tabs,
    Tag,
    Upload,
} from "@arco-design/web-react";
import Table from "@arco-design/web-react/es/Table/table";
import Title from "@arco-design/web-react/es/Typography/title";
import type {UploadItem} from "@arco-design/web-react/es/Upload";
import {IconDelete, IconDownload, IconImport, IconUndo} from "@arco-design/web-react/icon";
import type {Timestamp} from "firebase/firestore";
import {useEffect, useMemo, useRef, useState} from "react";
import {Link, useLocation, useNavigate, useParams, useSearchParams} from "react-router-dom";
import {useMount} from "react-use";

const PAGE_SIZE = 10;
type ImportResultView = "errors" | "warnings" | "athletes" | "registrations" | "teams";

const parsePositivePage = (value: string | null): number => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

const normalizeParticipantId = (value?: string | null): string => value?.trim().toLowerCase() ?? "";

const getFallbackTeamEventType = (team: Team): string => {
    const references = [
        ...(Array.isArray(team.event) ? team.event : []),
        typeof team.event_id === "string" ? team.event_id : "",
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

    if (references.includes("team relay")) {
        return "Team Relay";
    }
    if (references.includes("double")) {
        return "Double";
    }

    return "Team";
};

const getTeamVerificationLabel = (team: Team, events: TournamentEvent[], verified: boolean): string => {
    const eventType = getTeamEvents(team, events)[0]?.type ?? getFallbackTeamEventType(team);
    const label =
        eventType.toLowerCase().includes("team relay") || eventType.toLowerCase().includes("double")
            ? eventType
            : "Team";

    return `${label} ${verified ? "Verified" : "Not Verified"}`;
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
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [tournamentTitle, setTournamentTitle] = useState<string>();
    const [searchTerm, setSearchTerm] = useState<string>(() => searchParams.get("search") ?? "");
    const [currentPage, setCurrentPage] = useState<number>(() => parsePositivePage(searchParams.get("page")));
    const [sortField, setSortField] = useState<string>(() => searchParams.get("sortField") ?? "");
    const [sortDirection, setSortDirection] = useState<"ascend" | "descend" | undefined>(() => {
        const direction = searchParams.get("sortDirection");
        return direction === "ascend" || direction === "descend" ? direction : undefined;
    });
    const [importForm] = Form.useForm();
    const [importModalVisible, setImportModalVisible] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [templateLoading, setTemplateLoading] = useState(false);
    const [importFile, setImportFile] = useState<File | null>(null);
    const [importFileList, setImportFileList] = useState<UploadItem[]>([]);
    const [importResult, setImportResult] = useState<ImportWorkbookResult | null>(null);
    const [importResultView, setImportResultView] = useState<ImportResultView>("registrations");

    const teamVerificationByRegistration = useMemo(() => {
        return registrations.reduce(
            (acc, registration) => {
                const registrationId = registration.id ?? "";
                if (!registrationId) {
                    return acc;
                }

                const registrationGlobalId = normalizeParticipantId(registration.user_global_id);
                const matchedTeams = new Map<string, Team>();

                for (const team of teams) {
                    const directRegistrationMatch = team.registration_id === registrationId;
                    const leaderMatch =
                        registrationGlobalId.length > 0 &&
                        normalizeParticipantId(stripTeamLeaderPrefix(team.leader_id)) === registrationGlobalId;
                    const memberMatch =
                        registrationGlobalId.length > 0 &&
                        (team.members ?? []).some(
                            (member) => normalizeParticipantId(member.global_id) === registrationGlobalId,
                        );

                    if (directRegistrationMatch || leaderMatch || memberMatch) {
                        matchedTeams.set(team.id, team);
                    }
                }

                acc[registrationId] = Array.from(matchedTeams.values());
                return acc;
            },
            {} as Record<string, Team[]>,
        );
    }, [registrations, teams]);

    const refreshRegistrationsList = async () => {
        if (!tournamentId) return;

        setLoading(true);
        try {
            const [tempRegistrations, fetchedTeams, fetchedEvents, fetchedTournament] = await Promise.all([
                fetchRegistrations(tournamentId),
                fetchTeamsByTournament(tournamentId),
                fetchTournamentEvents(tournamentId),
                fetchTournamentById(tournamentId),
            ]);
            setRegistrations(tempRegistrations);
            setTeams(fetchedTeams);
            setEvents(fetchedEvents);
            setTournament(fetchedTournament ?? null);
            setTournamentTitle(fetchedTournament?.name ?? "");
            const userIds = tempRegistrations.map((registration) => registration.user_id).filter(Boolean);
            const usersById = await fetchUsersByIds(userIds);
            setUserMap(usersById);
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

    const fileToBase64 = (file: File): Promise<string> =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
            reader.readAsDataURL(file);
        });

    const getWorkbookImportErrorMessage = (error: unknown): string => {
        const firebaseError = error as {code?: string; message?: string};
        if (firebaseError.code === "functions/deadline-exceeded" || firebaseError.message?.includes("deadline-exceeded")) {
            return "Workbook import is taking too long. Please retry after the latest backend deploy, or reduce the workbook rows if it still fails.";
        }
        return error instanceof Error ? error.message : "Failed to import workbook.";
    };

    const handleWorkbookImport = async (mode: "preview" | "commit") => {
        if (!tournamentId || !importFile) {
            Message.warning("Please choose an Excel workbook first.");
            return;
        }
        try {
            const values = await importForm.validate();
            setImportLoading(true);
            const result = await importTournamentWorkbook({
                tournamentId,
                fileBase64: await fileToBase64(importFile),
                fileName: importFile.name,
                mode,
                defaultCountry: values.defaultCountry || "Malaysia",
                defaultState: "-",
            });
            setImportResult(result);
            setImportResultView("registrations");
            if (mode === "commit" && result.committed) {
                Message.success("Workbook imported.");
                await refreshRegistrationsList();
            } else if (result.summary.errors > 0) {
                Message.error("Import has errors. Fix the workbook before committing.");
            } else {
                Message.success("Workbook preview completed.");
            }
        } catch (error) {
            console.error("Failed to import workbook:", error);
            Message.error(getWorkbookImportErrorMessage(error));
        } finally {
            setImportLoading(false);
        }
    };

    const handleDownloadTemplate = async () => {
        if (events.length === 0) {
            Message.warning("Tournament events are still loading.");
            return;
        }

        setTemplateLoading(true);
        try {
            await downloadTournamentImportTemplate({tournament, events});
            Message.success("Import template downloaded.");
        } catch (error) {
            console.error("Failed to download import template:", error);
            Message.error(error instanceof Error ? error.message : "Failed to download import template.");
        } finally {
            setTemplateLoading(false);
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
                return (
                    <div className="flex flex-wrap gap-2">
                        <Tag color={color}>{status}</Tag>
                        {teamsForRegistration.map((team) => {
                            const teamVerified = isTeamFullyVerified(team);
                            return (
                                <Tag key={team.id} color={teamVerified ? "green" : "red"}>
                                    {getTeamVerificationLabel(team, events, teamVerified)}
                                </Tag>
                            );
                        })}
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
    const canImportWorkbook =
        user?.roles?.modify_admin === true ||
        user?.roles?.edit_tournament === true ||
        user?.global_id === tournament?.editor ||
        user?.global_id === tournament?.recorder;
    const importResultRows = useMemo(() => {
        if (!importResult) {
            return [];
        }
        return importResult.rows.filter((row) => {
            const category = row.category ?? "errors";
            return category === importResultView;
        });
    }, [importResult, importResultView]);

    useEffect(() => {
        if (loading) {
            return;
        }

        const totalPages = Math.max(1, Math.ceil(filteredRegistrations.length / PAGE_SIZE));
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, filteredRegistrations.length, loading]);

    if (!isMounted) {
        return (
            <div className="flex flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch min-h-[320px]">
                <Spin loading tip="Loading tournament detail..." className="w-full">
                    <div className="min-h-[240px]" />
                </Spin>
            </div>
        );
    }

    return (
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className="w-full flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <Title heading={4}>{tournamentTitle}</Title>
                    <div className="flex flex-col md:flex-row gap-2 md:items-center">
                        {canImportWorkbook && (
                            <>
                                <Button icon={<IconDownload />} loading={templateLoading} onClick={handleDownloadTemplate}>
                                    Template
                                </Button>
                                <Button type="primary" icon={<IconImport />} onClick={() => setImportModalVisible(true)}>
                                    Import Excel
                                </Button>
                            </>
                        )}
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
            <Modal
                title="Import Tournament Excel"
                visible={importModalVisible}
                onCancel={() => {
                    setImportModalVisible(false);
                    setImportResult(null);
                    setImportResultView("registrations");
                }}
                footer={
                    <div className="flex justify-between w-full gap-2">
                        <Button onClick={() => setImportModalVisible(false)}>Close</Button>
                        <div className="flex gap-2">
                            <Button
                                loading={importLoading}
                                disabled={!importFile}
                                onClick={() => handleWorkbookImport("preview")}
                            >
                                Preview
                            </Button>
                            <Button
                                type="primary"
                                loading={importLoading}
                                disabled={!importFile || (importResult?.summary.errors ?? 0) > 0}
                                onClick={() => handleWorkbookImport("commit")}
                            >
                                Commit Import
                            </Button>
                        </div>
                    </div>
                }
                style={{width: "min(96vw, 1100px)", top: "4vh"}}
            >
                <div className="flex flex-col gap-6 py-4 md:px-3 max-h-[76vh] overflow-y-auto">
                    <Form form={importForm} layout="vertical" initialValues={{defaultCountry: "Malaysia"}}>
                        <Form.Item label="Workbook" required>
                            <Upload
                                accept=".xlsx"
                                autoUpload={false}
                                limit={1}
                                fileList={importFileList}
                                onChange={(nextFileList, currentFile) => {
                                    const nextFile = nextFileList[nextFileList.length - 1];
                                    const file = nextFile?.originFile as File | undefined;
                                    setImportFile(file ?? null);
                                    setImportResult(null);
                                    setImportResultView("registrations");
                                    setImportFileList(
                                        file && nextFile
                                            ? [
                                                  {
                                                      uid: nextFile.uid,
                                                      name: nextFile.name,
                                                      status: "done",
                                                      originFile: file,
                                                  },
                                              ]
                                            : [],
                                    );
                                }}
                                onRemove={() => {
                                    setImportFile(null);
                                    setImportFileList([]);
                                    setImportResult(null);
                                    setImportResultView("registrations");
                                    return true;
                                }}
                            />
                        </Form.Item>
                        <Form.Item
                            label="Default Country"
                            field="defaultCountry"
                            rules={[{required: true, message: "Select default country"}]}
                        >
                            <Select
                                showSearch
                                options={countries.map((country) => ({label: country.label, value: country.value}))}
                                filterOption={(inputValue, option) =>
                                    String(option.props.children).toLowerCase().includes(inputValue.toLowerCase())
                                }
                            />
                        </Form.Item>
                    </Form>

                    {importResult && (
                        <div className="flex flex-col gap-3">
                            {importResult.committed && <Tag color="green">Committed</Tag>}
                            <Tabs
                                type="capsule"
                                activeTab={importResultView}
                                onChange={(key) => setImportResultView(key as ImportResultView)}
                            >
                                <Tabs.TabPane
                                    key="registrations"
                                    title={`Registrations (${importResult.summary.registrations})`}
                                />
                                <Tabs.TabPane key="athletes" title={`Athletes (${importResult.summary.athletes})`} />
                                <Tabs.TabPane key="teams" title={`Teams (${importResult.summary.teams})`} />
                                <Tabs.TabPane key="warnings" title={`Warnings (${importResult.summary.warnings})`} />
                                <Tabs.TabPane key="errors" title={`Errors (${importResult.summary.errors})`} />
                            </Tabs>
                            <Table
                                size="small"
                                pagination={{pageSize: 6}}
                                rowKey={(record) => `${record.sheet}-${record.row}-${record.level}-${record.message}`}
                                columns={[
                                    {title: "Level", dataIndex: "level", width: 100},
                                    {title: "Sheet", dataIndex: "sheet", width: 180},
                                    {title: "Row", dataIndex: "row", width: 80},
                                    {title: "Message", dataIndex: "message"},
                                ]}
                                data={importResultRows}
                            />
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
}
