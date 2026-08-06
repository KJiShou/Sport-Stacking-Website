import {AvatarUploader} from "@/components/common/AvatarUploader";
import {MobilePageHeader, MobileStickyActions, ResponsiveTabs} from "@/components/responsive";
import {useAuthContext} from "@/context/AuthContext";
import type {AllTimeStat, FirestoreUser, FirestoreUserSchema, OnlineBest, RecordItem} from "@/schema";
import {countries} from "@/schema/Country";
import {
    changeUserPassword,
    deleteAccount,
    fetchUserByID,
    releaseOwnedProfile,
    updateUserProfile,
} from "@/services/firebase/authService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {deriveBirthdateFromMykad, formatBirthdateForDisplay, isBirthdateMatchingMykad, parseBirthdate} from "@/utils/birthdate";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {Avatar, Spin} from "@arco-design/web-react";
import {
    Button,
    Cascader,
    DatePicker,
    Descriptions,
    Empty,
    Form,
    Grid,
    Input,
    Message,
    Modal,
    Select,
    Statistic,
    Switch,
    Table,
    type TableColumnProps,
    Typography,
} from "@arco-design/web-react";
import TabPane from "@arco-design/web-react/es/Tabs/tab-pane";
import {IconPhone, IconUser} from "@arco-design/web-react/icon";
// AvatarWithLoading copied from Navbar for consistent avatar UX
const AvatarWithLoading = ({src, size = 192}: {src: string; size?: number}) => {
    const [loading, setLoading] = useState(true);
    return (
        <div className="relative inline-block">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center z-10 bg-white/80 rounded-full">
                    <Spin size={24} />
                </div>
            )}
            <Avatar size={size} className="rounded-full overflow-hidden" style={{visibility: loading ? "hidden" : "visible"}}>
                <img
                    src={src}
                    alt="avatar"
                    onLoad={() => setLoading(false)}
                    onError={() => setLoading(false)}
                    className="w-full h-full object-cover rounded-full"
                />
            </Avatar>
        </div>
    );
};
import dayjs from "dayjs";
import {EmailAuthProvider, linkWithCredential} from "firebase/auth";
import type {Timestamp} from "firebase/firestore";
import {type ReactNode, useEffect, useState} from "react";
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import type {z} from "zod";

const {Title, Text} = Typography;

const toNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const toDate = (value: Date | Timestamp | null | undefined): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if ("toDate" in value && typeof value.toDate === "function") {
        return value.toDate();
    }
    return null;
};

const resolvePrimaryProfile = (profiles: FirestoreUser[], firebaseUid?: string | null): FirestoreUser | null => {
    if (profiles.length === 0) {
        return null;
    }

    return (
        profiles.find((profile) => profile.id === firebaseUid) ??
        [...profiles].sort((left, right) => {
            const leftKey = left.global_id?.trim() || left.id;
            const rightKey = right.global_id?.trim() || right.id;
            return leftKey.localeCompare(rightKey) || left.id.localeCompare(right.id);
        })[0]
    );
};

type UserBestTimeRecord = {
    event: "3-3-3" | "3-6-3" | "Cycle";
    time: number;
    season: string | null;
    updatedAt: Date | null;
};

type UserTournamentRecord = {
    tournamentId: string;
    tournamentName: string | null;
    events: string[];
    registrationDate: Date | null;
    prelimRank: number | null;
    finalRank: number | null;
    prelimOverall: number | null;
    finalOverall: number | null;
};

const buildUserBestTimes = (user: FirestoreUser | null): UserBestTimeRecord[] => {
    const events: UserBestTimeRecord["event"][] = ["3-3-3", "3-6-3", "Cycle"];
    return events.flatMap((event) => {
        const record = user?.best_times?.[event];
        if (!record || !("time" in record) || !record.time) return [];

        let updatedAt: Date | null = null;
        if (record.updated_at) {
            if (record.updated_at instanceof Date) {
                updatedAt = record.updated_at;
            } else if ("toDate" in record.updated_at && typeof record.updated_at.toDate === "function") {
                updatedAt = record.updated_at.toDate();
            }
        }

        return [
            {
                event,
                time: record.time,
                season: record.season ?? null,
                updatedAt,
            },
        ];
    });
};

const buildUserTournamentRecords = (
    user: FirestoreUser | null,
    tournamentNames: Record<string, string | null>,
    tournamentStartDates: Record<string, Date | null>,
): UserTournamentRecord[] =>
    (user?.registration_records ?? [])
        .filter((reg) => reg.status === "approved")
        .map((reg) => {
            const registrationDate = toDate(reg.registration_date);
            return {
                tournamentId: reg.tournament_id,
                tournamentName: tournamentNames[reg.tournament_id] ?? null,
                events: reg.events ?? [],
                registrationDate: tournamentStartDates[reg.tournament_id] ?? registrationDate,
                prelimRank: toNumber(reg.prelim_rank),
                finalRank: toNumber(reg.final_rank),
                prelimOverall: toNumber(reg.prelim_overall_result),
                finalOverall: toNumber(reg.final_overall_result),
            };
        });

const USER_BEST_TIME_COLUMNS: TableColumnProps<UserBestTimeRecord>[] = [
    {title: "Event", dataIndex: "event", width: 120},
    {
        title: "Best Time",
        dataIndex: "time",
        width: 150,
        render: (time: number) => (
            <span className="font-semibold text-lg">{typeof time === "number" ? time.toFixed(3) : "-"}</span>
        ),
    },
    {title: "Season", dataIndex: "season", width: 120, render: (season: string | null) => season ?? "—"},
    {
        title: "Last Updated",
        dataIndex: "updatedAt",
        width: 150,
        render: (date: Date | null) => (date ? dayjs(date).format("DD/MM/YYYY") : "—"),
    },
];

const USER_TOURNAMENT_COLUMNS: TableColumnProps<UserTournamentRecord>[] = [
    {
        title: "Date",
        dataIndex: "registrationDate",
        width: 150,
        render: (date: Date | null) => (date ? dayjs(date).format("DD/MM/YYYY") : "—"),
    },
    {title: "Tournament", dataIndex: "tournamentName", width: 260, render: (name: string | null) => name ?? "Unknown tournament"},
    {title: "Events", dataIndex: "events", width: 220, render: (events: string[]) => events.join(", ") || "—"},
    {title: "Prelim Rank", dataIndex: "prelimRank", width: 120, render: (rank: number | null) => (rank ? `#${rank}` : "—")},
    {
        title: "Prelim Overall",
        dataIndex: "prelimOverall",
        width: 150,
        render: (time: number | null) => (time ? time.toFixed(3) : "—"),
    },
    {title: "Final Rank", dataIndex: "finalRank", width: 120, render: (rank: number | null) => (rank ? `#${rank}` : "—")},
    {
        title: "Final Overall",
        dataIndex: "finalOverall",
        width: 150,
        render: (time: number | null) => (time ? time.toFixed(3) : "—"),
    },
];

const UserBestPerformances = ({records, isMobile}: {records: UserBestTimeRecord[]; isMobile: boolean}) => {
    let content: ReactNode;
    if (records.length === 0) {
        content = <Empty description="No best times recorded yet." />;
    } else if (isMobile) {
        content = (
            <div className="user-profile-mobile-cards">
                {records.map((record) => (
                    <div key={record.event} className="user-profile-mobile-card">
                        <div className="user-profile-mobile-card__header">
                            <strong>{record.event}</strong>
                            <span className="user-profile-mobile-card__value">{record.time.toFixed(3)}</span>
                        </div>
                        <div className="user-profile-mobile-card__details">
                            <span>
                                <small>Season</small>
                                {record.season ?? "—"}
                            </span>
                            <span>
                                <small>Last updated</small>
                                {record.updatedAt ? dayjs(record.updatedAt).format("DD/MM/YYYY") : "—"}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        );
    } else {
        content = (
            <div className="mobile-table-scroll">
                <Table
                    rowKey="event"
                    columns={USER_BEST_TIME_COLUMNS}
                    data={records}
                    pagination={false}
                    scroll={{x: true}}
                    border={false}
                />
            </div>
        );
    }

    return <>{content}</>;
};

const UserTournamentParticipation = ({records, isMobile}: {records: UserTournamentRecord[]; isMobile: boolean}) => {
    let content: ReactNode;
    if (records.length === 0) {
        content = <Empty description="No tournament participation records found." />;
    } else if (isMobile) {
        content = (
            <div className="user-profile-mobile-cards">
                {records.map((record) => (
                    <div key={record.tournamentId} className="user-profile-mobile-card">
                        <div className="user-profile-mobile-card__header">
                            <strong className="break-words">{record.tournamentName ?? "Unknown tournament"}</strong>
                            <span>{record.registrationDate ? dayjs(record.registrationDate).format("DD/MM/YYYY") : "—"}</span>
                        </div>
                        <div className="user-profile-mobile-card__details">
                            <span>
                                <small>Prelim rank / time</small>
                                {record.prelimRank ? `#${record.prelimRank}` : "—"} /{" "}
                                {record.prelimOverall ? record.prelimOverall.toFixed(3) : "—"}
                            </span>
                            <span>
                                <small>Final rank / time</small>
                                {record.finalRank ? `#${record.finalRank}` : "—"} /{" "}
                                {record.finalOverall ? record.finalOverall.toFixed(3) : "—"}
                            </span>
                        </div>
                        <div className="user-profile-mobile-card__events">{record.events.join(", ") || "No events"}</div>
                    </div>
                ))}
            </div>
        );
    } else {
        content = (
            <div className="w-full overflow-x-auto">
                <Table
                    rowKey="tournamentId"
                    columns={USER_TOURNAMENT_COLUMNS}
                    data={records}
                    pagination={{pageSize: 10}}
                    scroll={{x: "max-content"}}
                    border={false}
                />
            </div>
        );
    }

    return <>{content}</>;
};

export default function RegisterPage() {
    const {Row, Col} = Grid;
    const deviceBreakpoint = useDeviceBreakpoint();
    const isMobile = deviceBreakpoint < DeviceBreakpoint.md;
    const isSmallScreen = deviceBreakpoint <= DeviceBreakpoint.sm;
    const {id} = useParams<{id: string}>();
    const {activeProfileId, firebaseUser, profiles, refreshProfiles, user: authUser} = useAuthContext();
    const navigate = useNavigate();
    const [form] = Form.useForm();
    const [secForm] = Form.useForm();
    const [addPasswordForm] = Form.useForm();
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(true);
    const [secLoading, setSecLoading] = useState(false);
    const [addPasswordLoading, setAddPasswordLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [removeLoading, setRemoveLoading] = useState(false);
    const [tournamentStartDates, setTournamentStartDates] = useState<Record<string, Date | null>>({});
    const [tournamentNames, setTournamentNames] = useState<Record<string, string | null>>({});
    const [searchParams, setSearchParams] = useSearchParams();
    const hasPasswordProvider = Boolean(firebaseUser?.providerData?.some((provider) => provider.providerId === "password"));
    const selectedOwnedProfile = profiles.find((profile) => profile.id === id) ?? null;
    const primaryProfile = resolvePrimaryProfile(profiles, firebaseUser?.uid);
    const isPrimaryProfile = primaryProfile?.id === id;
    const activeId = activeProfileId ?? authUser?.id ?? null;

    const navigateToProfile = (nextProfileId: string) => {
        if (nextProfileId === id) {
            return;
        }

        const navigateWithoutUnsavedChanges = () => {
            setIsEditMode(false);
            navigate(`/users/${nextProfileId}`);
        };

        if (isEditMode && form.getTouchedFields().length > 0) {
            Modal.confirm({
                title: "Discard unsaved changes?",
                content: "Switching profiles will discard the changes you have not saved.",
                okText: "Discard and switch",
                cancelText: "Stay here",
                onOk: navigateWithoutUnsavedChanges,
            });
            return;
        }

        navigateWithoutUnsavedChanges();
    };

    const profileSelector =
        profiles.length > 1 ? (
            <div className="flex min-w-0 items-center gap-2">
                <Text type="secondary" className="whitespace-nowrap">
                    Profile
                </Text>
                <Select
                    value={id}
                    onChange={(value) => navigateToProfile(value)}
                    style={{minWidth: isMobile ? 180 : 260, maxWidth: "100%"}}
                    aria-label="Select profile to view or edit"
                >
                    {profiles.map((profile) => (
                        <Select.Option key={profile.id} value={profile.id}>
                            {profile.global_id || profile.id} - {profile.name}
                            {profile.id === activeId ? " (Current)" : ""}
                        </Select.Option>
                    ))}
                </Select>
            </div>
        ) : null;

    function confirm() {
        if (!isPrimaryProfile || profiles.length > 1) {
            return;
        }

        Modal.confirm({
            title: "Delete Account",
            content: "Are you sure you want to delete this account? This action cannot be undone.",
            okButtonProps: {
                status: "danger",
            },
            confirmLoading: deleteLoading,
            onOk: async () => {
                try {
                    setDeleteLoading(true);
                    if (!user?.id) throw new Error("User ID is not available");
                    await deleteAccount(user.id);
                    Message.success({
                        content: "Account deleted successfully!",
                    });
                    navigate("/");
                } catch (error) {
                    console.error("Failed to delete account:", error);
                    Message.error({
                        content: "Failed to delete account. Please try again later.",
                    });
                }
                setDeleteLoading(false);
            },
        });
    }

    function confirmRemoveProfile() {
        if (!id || isPrimaryProfile) {
            return;
        }

        Modal.confirm({
            title: "Remove Profile",
            content:
                "This will unlink the profile from your account while keeping its Global ID, personal bests, and tournament history.",
            okText: "Remove Profile",
            cancelText: "Keep Profile",
            okButtonProps: {status: "danger"},
            confirmLoading: removeLoading,
            onOk: async () => {
                setRemoveLoading(true);
                try {
                    const fallbackProfile = primaryProfile ?? profiles.find((profile) => profile.id !== id) ?? null;
                    const preferredProfileId = activeId === id ? fallbackProfile?.id : (activeId ?? undefined);
                    await releaseOwnedProfile(id);
                    await refreshProfiles(preferredProfileId);
                    Message.success("Profile removed from your account");

                    const destinationProfileId = preferredProfileId ?? fallbackProfile?.id;
                    if (destinationProfileId) {
                        navigate(`/users/${destinationProfileId}`, {replace: true});
                    } else {
                        navigate("/", {replace: true});
                    }
                } catch (error) {
                    console.error("Failed to remove profile:", error);
                    Message.error(error instanceof Error ? error.message : "Failed to remove profile");
                } finally {
                    setRemoveLoading(false);
                }
            },
        });
    }

    let descData = [
        {label: "Email", value: user?.email ?? "-"},
        {label: "Member ID", value: user?.memberId ?? "-"},
        {label: "IC", value: user?.IC ?? "-"},
        {label: "Country / State", value: `${user?.country[0]} / ${user?.country[1]}`},
        {label: "Phone Number", value: user?.phone_number ?? "-"},
        {label: "School/University/College", value: user?.school ?? "-"},
        {
            label: "Birthdate",
            value: formatBirthdateForDisplay(user?.birthdate, user?.IC),
            span: 2,
        },
    ];
    type RoleKey = keyof NonNullable<z.infer<typeof FirestoreUserSchema>["roles"]>;

    const permissionList: {key: RoleKey; label: string}[] = [
        {key: "edit_tournament", label: "Edit Tournament"},
        {key: "record_tournament", label: "Record Tournament"},
        {key: "modify_admin", label: "Modify Admin"},
        {key: "verify_record", label: "Verify Record"},
    ];

    useEffect(() => {
        if (!selectedOwnedProfile) {
            const fallbackProfileId = authUser?.id ?? profiles[0]?.id;
            navigate(fallbackProfileId ? `/users/${fallbackProfileId}` : "/", {replace: true});
            return;
        }

        setIsEditMode(searchParams.get("isEditMode") === "true");
    }, [authUser?.id, id, navigate, profiles, searchParams, selectedOwnedProfile]);

    useEffect(() => {
        if (!id || !selectedOwnedProfile) {
            setUser(null);
            setLoading(false);
            setTournamentStartDates({});
            setTournamentNames({});
            return;
        }

        let cancelled = false;
        setLoading(true);
        setUser(null);
        form.resetFields();

        (async () => {
            try {
                const data = await fetchUserByID(id);
                if (cancelled) return;
                setUser(data ?? null);

                const approvedTournamentIds = Array.from(
                    new Set(
                        (data?.registration_records ?? [])
                            .filter((record) => record.status === "approved")
                            .map((record) => record.tournament_id)
                            .filter((tournamentId): tournamentId is string => Boolean(tournamentId)),
                    ),
                );
                const tournamentEntries = await Promise.all(
                    approvedTournamentIds.map(async (tournamentId) => {
                        try {
                            const tournament = await fetchTournamentById(tournamentId);
                            return {
                                tournamentId,
                                startDate: toDate(tournament?.start_date),
                                name: tournament?.name?.trim() || null,
                            };
                        } catch (error) {
                            console.warn(`Failed to fetch tournament ${tournamentId} for user profile`, error);
                            return {tournamentId, startDate: null, name: null};
                        }
                    }),
                );
                setTournamentStartDates(
                    Object.fromEntries(tournamentEntries.map(({tournamentId, startDate}) => [tournamentId, startDate])),
                );
                setTournamentNames(Object.fromEntries(tournamentEntries.map(({tournamentId, name}) => [tournamentId, name])));

                if (cancelled) return;

                const birthdate = parseBirthdate(data?.birthdate) ?? deriveBirthdateFromMykad(data?.IC);
                form.setFieldsValue({
                    email: data?.email,
                    IC: data?.IC,
                    name: data?.name,
                    country: data?.country,
                    school: data?.school ?? "",
                    gender: data?.gender,
                    birthdate,
                    phone_number: data?.phone_number ?? "-",
                    memberId: data?.memberId,
                });
                descData = [
                    {label: "Email", value: data?.email ?? "-"},
                    {label: "Member ID", value: data?.memberId ?? "-"},
                    {label: "IC", value: data?.IC ?? "-"},
                    {label: "Country / State", value: `${data?.country[0]} / ${data?.country[1]}`},
                    {label: "Phone Number", value: data?.phone_number ?? "-"},
                    {label: "School/University/College", value: data?.school ?? "-"},
                    {
                        label: "Birthdate",
                        value: formatBirthdateForDisplay(data?.birthdate, data?.IC),
                        span: 2,
                    },
                ];
            } catch (err) {
                console.error(err);
                if (!cancelled) {
                    setUser(null);
                    setTournamentStartDates({});
                    setTournamentNames({});
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [form, id, selectedOwnedProfile]);

    // 构建统计数据示例
    const allTimeStats: AllTimeStat[] = [
        {event: "3-3-3", time: (user?.best_times?.["3-3-3"] as {time?: number} | undefined)?.time ?? 0, rank: "-"},
        {event: "3-6-3", time: (user?.best_times?.["3-6-3"] as {time?: number} | undefined)?.time ?? 0, rank: "-"},
        {event: "Cycle", time: (user?.best_times?.Cycle as {time?: number} | undefined)?.time ?? 0, rank: "-"},
    ];
    const onlineBest: OnlineBest[] = [];
    const records: RecordItem[] = [];

    const handleSubmit = async (values: {
        name: string;
        country: [country: string, state: string];
        school: string;
        phone_number: string;
        gender: "Male" | "Female";
        birthdate: unknown;
    }) => {
        if (!id) return;
        const birthdate = parseBirthdate(values.birthdate);
        if (!birthdate) {
            Message.error("Select a valid birthdate");
            return;
        }
        if (/^\d{12}$/.test(user?.IC ?? "") && !isBirthdateMatchingMykad(user?.IC, birthdate)) {
            Message.error("Birthdate must match the IC number");
            return;
        }

        setLoading(true);
        try {
            await updateUserProfile(id, {
                name: values.name,
                country: values.country,
                school: values.school,
                phone_number: values.phone_number,
                gender: values.gender,
                birthdate,
            });
            await refreshProfiles(activeId ?? undefined);
            setUser((prev) =>
                prev
                    ? {
                          ...prev,
                          name: values.name,
                          country: values.country,
                          school: values.school,
                          phone_number: values.phone_number,
                          gender: values.gender,
                          birthdate,
                      }
                    : prev,
            );
            Message.success("Profile updated successfully");
            setIsEditMode(false);
            setSearchParams({});
        } catch (err) {
            console.error(err);
            Message.error("Failed to update profile");
        } finally {
            setLoading(false);
        }
    };

    const handleSecuritySubmit = async (values: {currentPassword: string; newPassword: string; confirmPassword: string}) => {
        setSecLoading(true);
        if (values.newPassword !== values.confirmPassword) {
            Message.error("New passwords do not match");
            setSecLoading(false);
            return;
        }
        try {
            await changeUserPassword(values.currentPassword, values.newPassword);
            Message.success("Password changed successfully");
            secForm.resetFields();
        } catch (err: unknown) {
            if (err instanceof Error) {
                Message.error(err.message);
            } else {
                Message.error("Failed to change password");
            }
        } finally {
            setSecLoading(false);
        }
    };

    const handleAddPasswordSubmit = async (values: {newPassword: string; confirmPassword: string}) => {
        setAddPasswordLoading(true);
        if (values.newPassword !== values.confirmPassword) {
            Message.error("Passwords do not match");
            setAddPasswordLoading(false);
            return;
        }
        try {
            if (!firebaseUser?.email) {
                throw new Error("Missing email for this account.");
            }
            const credential = EmailAuthProvider.credential(firebaseUser.email, values.newPassword);
            await linkWithCredential(firebaseUser, credential);
            Message.success("Password added successfully");
            addPasswordForm.resetFields();
        } catch (err: unknown) {
            if (err instanceof Error) {
                Message.error(err.message);
            } else {
                Message.error("Failed to add password");
            }
        } finally {
            setAddPasswordLoading(false);
        }
    };

    const userBestTimes = buildUserBestTimes(user);
    const userTournamentRecords = buildUserTournamentRecords(user, tournamentNames, tournamentStartDates);
    let accountAction: ReactNode;
    if (isPrimaryProfile && profiles.length > 1) {
        accountAction = (
            <div className="w-full">
                <Button className="w-full" type="outline" status="danger" disabled>
                    Delete Account
                </Button>
                <Text type="secondary" className="mt-2 block text-center text-xs">
                    Multi-profile accounts must contact an administrator to delete the account.
                </Text>
            </div>
        );
    } else if (isPrimaryProfile) {
        accountAction = (
            <Button className="w-full" type="outline" status="danger" onClick={confirm}>
                Delete Account
            </Button>
        );
    } else {
        accountAction = (
            <Button className="w-full" type="outline" status="danger" onClick={confirmRemoveProfile} loading={removeLoading}>
                Remove Profile
            </Button>
        );
    }

    return (
        <div className="w-full">
            <MobilePageHeader title="User Profile" actions={profileSelector} className="p-0 md:p-6 xl:p-10" />
            <Spin tip="Loading..." size={40} loading={loading} className="w-full">
                {isEditMode ? (
                    <div className={`user-profile-edit-page flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10`}>
                        <div
                            className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                        >
                            <div className={`w-full `}>
                                {user && <AvatarUploader user={user} setUser={setUser} />}
                                <div>
                                    <Title heading={4}>{user?.name}</Title>
                                    <Text type="secondary">Account ID: {user?.global_id}</Text>
                                </div>

                                <ResponsiveTabs defaultActiveTab="basic" className="mt-6">
                                    <TabPane title="Basic Information" key="basic">
                                        <Form
                                            requiredSymbol={false}
                                            className={`user-profile-edit-form flex flex-col items-start`}
                                            layout="horizontal"
                                            labelAlign="left"
                                            form={form}
                                            onSubmit={handleSubmit}
                                            autoComplete="off"
                                        >
                                            <Form.Item label="Email" field="email">
                                                <Input disabled />
                                            </Form.Item>

                                            <Form.Item label="Member ID" field="memberId">
                                                <Input disabled />
                                            </Form.Item>

                                            <Form.Item label="IC" field="IC">
                                                <Input disabled />
                                            </Form.Item>

                                            <Form.Item
                                                label="Name"
                                                field="name"
                                                rules={[{required: true, message: "Please enter your name"}]}
                                            >
                                                <Input placeholder="Please enter your name" />
                                            </Form.Item>

                                            <Form.Item
                                                field="birthdate"
                                                label="Birthdate"
                                                rules={[{required: true, message: "Select your birthdate"}]}
                                            >
                                                <DatePicker
                                                    format="DD/MM/YYYY"
                                                    style={{width: "100%"}}
                                                    disabledDate={(current) => current.isAfter(dayjs())}
                                                />
                                            </Form.Item>

                                            <Form.Item
                                                field="gender"
                                                label="Gender"
                                                rules={[{required: true, message: "Select gender"}]}
                                            >
                                                <Select placeholder="Select gender" options={["Male", "Female"]} />
                                            </Form.Item>

                                            <Form.Item
                                                label="Phone Number"
                                                field="phone_number"
                                                rules={[{required: true, message: "Please enter your phone number"}]}
                                            >
                                                <Input prefix={<IconPhone />} placeholder="Please enter your phone number" />
                                            </Form.Item>

                                            <Form.Item
                                                label="Country / State"
                                                field="country"
                                                rules={[{required: true, message: "Please select a country/region"}]}
                                            >
                                                <Cascader
                                                    showSearch
                                                    changeOnSelect
                                                    allowClear
                                                    filterOption={(input, node) => {
                                                        return node.label.toLowerCase().includes(input.toLowerCase());
                                                    }}
                                                    options={countries}
                                                    placeholder="Please select location"
                                                    expandTrigger="click"
                                                    value={user?.country}
                                                />
                                            </Form.Item>

                                            <Form.Item
                                                label="School"
                                                field="school"
                                                rules={[{required: false, message: "Please enter your school"}]}
                                            >
                                                <Input placeholder="Please enter your school" />
                                            </Form.Item>

                                            <MobileStickyActions>
                                                <div className="w-full mx-auto flex flex-col items-center">
                                                    <Button
                                                        type="primary"
                                                        long
                                                        onClick={() => {
                                                            form.submit();
                                                        }}
                                                    >
                                                        Save
                                                    </Button>
                                                    <Button
                                                        long
                                                        className="mt-4"
                                                        onClick={async () => {
                                                            try {
                                                                setLoading(true);
                                                                const data = await fetchUserByID(id ?? "");
                                                                setUser(data ?? null);
                                                                const birthdate =
                                                                    parseBirthdate(data?.birthdate) ??
                                                                    deriveBirthdateFromMykad(data?.IC);
                                                                form.setFieldsValue({
                                                                    email: data?.email,
                                                                    IC: data?.IC,
                                                                    name: data?.name,
                                                                    country: data?.country,
                                                                    memberId: data?.memberId,
                                                                    school: data?.school ?? "",
                                                                    gender: data?.gender,
                                                                    birthdate,
                                                                    phone_number: data?.phone_number,
                                                                });
                                                            } catch (err) {
                                                                console.error(err);
                                                                setUser(null);
                                                            } finally {
                                                                setLoading(false);
                                                            }
                                                        }}
                                                    >
                                                        Reset
                                                    </Button>
                                                </div>
                                            </MobileStickyActions>
                                        </Form>
                                    </TabPane>

                                    {isPrimaryProfile &&
                                        (hasPasswordProvider ? (
                                            <TabPane title="Security Settings" key="security">
                                                <Form
                                                    form={secForm}
                                                    layout="vertical"
                                                    onSubmit={handleSecuritySubmit}
                                                    autoComplete="off"
                                                    requiredSymbol={false}
                                                >
                                                    <Form.Item
                                                        label="Current Password"
                                                        field="currentPassword"
                                                        rules={[{required: true, message: "Enter current password"}]}
                                                    >
                                                        <Input.Password placeholder="Current Password" />
                                                    </Form.Item>
                                                    <Form.Item
                                                        label="New Password"
                                                        field="newPassword"
                                                        rules={[{required: true, message: "Enter new password"}]}
                                                    >
                                                        <Input.Password placeholder="New Password" />
                                                    </Form.Item>
                                                    <Form.Item
                                                        label="Confirm Password"
                                                        field="confirmPassword"
                                                        rules={[{required: true, message: "Confirm new password"}]}
                                                    >
                                                        <Input.Password placeholder="Confirm Password" />
                                                    </Form.Item>
                                                    <div className="w-full mx-auto flex flex-col items-center">
                                                        <Button type="primary" long htmlType="submit" loading={secLoading}>
                                                            Change Password
                                                        </Button>
                                                    </div>
                                                </Form>
                                            </TabPane>
                                        ) : (
                                            <TabPane title="Add Password" key="add-password">
                                                <Form
                                                    form={addPasswordForm}
                                                    layout="vertical"
                                                    onSubmit={handleAddPasswordSubmit}
                                                    autoComplete="off"
                                                    requiredSymbol={false}
                                                >
                                                    <Form.Item
                                                        label="New Password"
                                                        field="newPassword"
                                                        rules={[{required: true, message: "Enter a password"}]}
                                                    >
                                                        <Input.Password placeholder="Create a password" />
                                                    </Form.Item>
                                                    <Form.Item
                                                        label="Confirm Password"
                                                        field="confirmPassword"
                                                        rules={[{required: true, message: "Confirm your password"}]}
                                                    >
                                                        <Input.Password placeholder="Repeat password" />
                                                    </Form.Item>
                                                    <div className="w-full mx-auto flex flex-col items-center">
                                                        <Button
                                                            type="primary"
                                                            long
                                                            htmlType="submit"
                                                            loading={addPasswordLoading}
                                                        >
                                                            Add Password
                                                        </Button>
                                                    </div>
                                                </Form>
                                            </TabPane>
                                        ))}
                                </ResponsiveTabs>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="user-profile-view flex flex-col md:flex-row bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
                        {/* 左边：基本信息卡片 */}
                        <div className="bg-white flex flex-col w-full md:w-1/3 gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                            {user?.image_url ? (
                                <AvatarWithLoading src={user.image_url} size={isMobile ? 120 : 192} />
                            ) : (
                                <div className="relative inline-block">
                                    <Avatar
                                        size={isMobile ? 120 : 192}
                                        style={{backgroundColor: "#3370ff"}}
                                        className={`rounded-full overflow-hidden`}
                                    >
                                        <IconUser className="w-full h-full object-cover rounded-full" />
                                    </Avatar>
                                </div>
                            )}
                            <Text className="flex items-center justify-center gap-1 text-4xl font-bold mt-2">{user?.name}</Text>
                            <Text className="flex items-center justify-center gap-1">
                                <IconUser /> {user?.global_id}
                            </Text>
                            <Descriptions
                                className={"w-full h-full py-8 px-4"}
                                border
                                column={1}
                                layout={isSmallScreen ? "vertical" : "horizontal"}
                                data={descData}
                                labelStyle={{
                                    textAlign: isSmallScreen ? "left" : "right",
                                    paddingRight: isSmallScreen ? 0 : 24,
                                    width: isSmallScreen ? "100%" : 140,
                                }}
                                valueStyle={{
                                    textAlign: "left",
                                    width: "100%",
                                    wordBreak: "break-word",
                                    overflowWrap: "anywhere",
                                }}
                            />
                            <Button
                                className="w-full"
                                type="primary"
                                onClick={() => {
                                    setIsEditMode(true);
                                    setSearchParams({isEditMode: "true"});
                                }}
                            >
                                Edit Profile
                            </Button>
                            {accountAction}
                        </div>

                        {/* 右边：包一层，让它整体高度统一 */}
                        <div className="flex flex-col w-full md:w-2/3 h-full gap-6">
                            <div className="flex flex-col h-full gap-6">
                                {/* Best Record Section (like AthleteProfile) */}
                                <div className="bg-white flex flex-col w-full gap-6 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                    <Title heading={4} className="!mb-4">
                                        Best Performances
                                    </Title>
                                    <UserBestPerformances records={userBestTimes} isMobile={isMobile} />
                                </div>
                                {/* Tournament Participation Section (like AthleteProfile) */}
                                <div className="bg-white flex flex-col w-full gap-6 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                    <Title heading={4} className="!mb-4">
                                        Tournament Participation
                                    </Title>
                                    <UserTournamentParticipation records={userTournamentRecords} isMobile={isMobile} />
                                </div>
                                {user?.roles && (
                                    <div className="bg-white flex flex-col w-full gap-4 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                        <Title heading={4} className="!mb-4">
                                            Admin Permissions
                                        </Title>
                                        <Row gutter={[16, 16]} className="w-full">
                                            {permissionList.map(({key, label}) => (
                                                <Col xs={24} sm={12} key={key}>
                                                    <div className="flex items-center justify-between px-4 py-2 border rounded">
                                                        <span>{label}</span>
                                                        <Switch checked={user.roles?.[key] ?? false} disabled />
                                                    </div>
                                                </Col>
                                            ))}
                                        </Row>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </Spin>
        </div>
    );
}
