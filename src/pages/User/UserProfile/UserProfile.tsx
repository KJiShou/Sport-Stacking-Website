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
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {deriveBirthdateFromMykad, formatBirthdateForDisplay, isBirthdateMatchingMykad, parseBirthdate} from "@/utils/birthdate";
import {Avatar, Spin} from "@arco-design/web-react";
import {
    Button,
    Cascader,
    DatePicker,
    Descriptions,
    Empty,
    Form,
    type FormInstance,
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
import {type Dispatch, type ReactNode, type SetStateAction, useEffect, useState} from "react";
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

type ProfileSelectorProps = Readonly<{
    profiles: FirestoreUser[];
    activeProfileId: string | null | undefined;
    selectedProfileId: string | undefined;
    isMobile: boolean;
    onChange: (profileId: string) => void;
}>;

const ProfileSelector = ({profiles, activeProfileId, selectedProfileId, isMobile, onChange}: ProfileSelectorProps) => {
    if (profiles.length <= 1) return null;
    return (
        <div className="flex min-w-0 items-center gap-2">
            <Text type="secondary" className="whitespace-nowrap">
                Profile
            </Text>
            <Select
                value={selectedProfileId}
                onChange={onChange}
                style={{minWidth: isMobile ? 180 : 260, maxWidth: "100%"}}
                aria-label="Select profile to view or edit"
            >
                {profiles.map((profile) => (
                    <Select.Option key={profile.id} value={profile.id}>
                        {profile.global_id || profile.id} - {profile.name}
                        {profile.id === activeProfileId ? " (Current)" : ""}
                    </Select.Option>
                ))}
            </Select>
        </div>
    );
};

type AccountActionProps = Readonly<{
    isPrimaryProfile: boolean;
    hasMultipleProfiles: boolean;
    removeLoading: boolean;
    onDeleteAccount: () => void;
    onRemoveProfile: () => void;
}>;

const AccountAction = ({
    isPrimaryProfile,
    hasMultipleProfiles,
    removeLoading,
    onDeleteAccount,
    onRemoveProfile,
}: AccountActionProps) => {
    if (isPrimaryProfile && hasMultipleProfiles) {
        return (
            <div className="w-full">
                <Button className="w-full" type="outline" status="danger" disabled>
                    Delete Account
                </Button>
                <Text type="secondary" className="mt-2 block text-center text-xs">
                    Multi-profile accounts must contact an administrator to delete the account.
                </Text>
            </div>
        );
    }
    if (isPrimaryProfile) {
        return (
            <Button className="w-full" type="outline" status="danger" onClick={onDeleteAccount}>
                Delete Account
            </Button>
        );
    }
    return (
        <Button className="w-full" type="outline" status="danger" onClick={onRemoveProfile} loading={removeLoading}>
            Remove Profile
        </Button>
    );
};

const showDeleteAccountConfirmation = (canDelete: boolean, confirmLoading: boolean, onConfirm: () => Promise<void>): void => {
    if (!canDelete) return;
    Modal.confirm({
        title: "Delete Account",
        content: "Are you sure you want to delete this account? This action cannot be undone.",
        okButtonProps: {status: "danger"},
        confirmLoading,
        onOk: onConfirm,
    });
};

const performDeleteAccount = async (
    userId: string | undefined,
    setDeleteLoading: (loading: boolean) => void,
    navigate: (path: string) => void,
): Promise<void> => {
    try {
        setDeleteLoading(true);
        if (!userId) throw new Error("User ID is not available");
        await deleteAccount(userId);
        Message.success({content: "Account deleted successfully!"});
        navigate("/");
    } catch (error) {
        console.error("Failed to delete account:", error);
        Message.error({content: "Failed to delete account. Please try again later."});
    } finally {
        setDeleteLoading(false);
    }
};

const showRemoveProfileConfirmation = (canRemove: boolean, confirmLoading: boolean, onConfirm: () => Promise<void>): void => {
    if (!canRemove) return;
    Modal.confirm({
        title: "Remove Profile",
        content:
            "This will unlink the profile from your account while keeping its Global ID, personal bests, and tournament history.",
        okText: "Remove Profile",
        cancelText: "Keep Profile",
        okButtonProps: {status: "danger"},
        confirmLoading,
        onOk: onConfirm,
    });
};

const performRemoveProfile = async (
    profileId: string,
    activeProfileId: string | null,
    primaryProfile: FirestoreUser | null,
    profiles: FirestoreUser[],
    releaseProfile: (profileId: string) => Promise<unknown>,
    refreshProfiles: (preferredProfileId?: string) => Promise<unknown>,
    navigate: (path: string, options?: {replace?: boolean}) => void,
    setRemoveLoading: (loading: boolean) => void,
): Promise<void> => {
    setRemoveLoading(true);
    try {
        const fallbackProfile = primaryProfile ?? profiles.find((profile) => profile.id !== profileId) ?? null;
        const preferredProfileId = activeProfileId === profileId ? fallbackProfile?.id : (activeProfileId ?? undefined);
        await releaseProfile(profileId);
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
};

type ProfileFormValues = {
    email?: string;
    memberId?: string;
    IC?: string;
    name: string;
    country: [country: string, state: string];
    school: string;
    phone_number: string;
    gender: "Male" | "Female";
    birthdate: unknown;
};

type SecurityFormValues = {currentPassword: string; newPassword: string; confirmPassword: string};
type AddPasswordFormValues = {newPassword: string; confirmPassword: string};

const mergeProfileFormValues = (
    currentUser: FirestoreUser | null,
    values: ProfileFormValues,
    birthdate: Date,
): FirestoreUser | null => {
    if (!currentUser) return currentUser;
    return {
        ...currentUser,
        name: values.name,
        country: values.country,
        school: values.school,
        phone_number: values.phone_number,
        gender: values.gender,
        birthdate,
    };
};

type ProfileSecurityTabProps = Readonly<{
    hasPasswordProvider: boolean;
    secForm: FormInstance<SecurityFormValues>;
    addPasswordForm: FormInstance<AddPasswordFormValues>;
    secLoading: boolean;
    addPasswordLoading: boolean;
    onSecuritySubmit: (values: SecurityFormValues) => void;
    onAddPasswordSubmit: (values: AddPasswordFormValues) => void;
}>;

const ProfileSecurityTab = ({
    hasPasswordProvider,
    secForm,
    addPasswordForm,
    secLoading,
    addPasswordLoading,
    onSecuritySubmit,
    onAddPasswordSubmit,
}: ProfileSecurityTabProps) => {
    if (hasPasswordProvider) {
        return (
            <TabPane title="Security Settings" key="security">
                <Form form={secForm} layout="vertical" onSubmit={onSecuritySubmit} autoComplete="off" requiredSymbol={false}>
                    <Form.Item
                        label="Current Password"
                        field="currentPassword"
                        rules={[{required: true, message: "Enter current password"}]}
                    >
                        <Input.Password placeholder="Current Password" />
                    </Form.Item>
                    <Form.Item label="New Password" field="newPassword" rules={[{required: true, message: "Enter new password"}]}>
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
        );
    }

    return (
        <TabPane title="Add Password" key="add-password">
            <Form
                form={addPasswordForm}
                layout="vertical"
                onSubmit={onAddPasswordSubmit}
                autoComplete="off"
                requiredSymbol={false}
            >
                <Form.Item label="New Password" field="newPassword" rules={[{required: true, message: "Enter a password"}]}>
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
                    <Button type="primary" long htmlType="submit" loading={addPasswordLoading}>
                        Add Password
                    </Button>
                </div>
            </Form>
        </TabPane>
    );
};

type ProfileEditPanelProps = Readonly<{
    user: FirestoreUser | null;
    setUser: Dispatch<SetStateAction<FirestoreUser | null>>;
    form: FormInstance<ProfileFormValues>;
    secForm: FormInstance<SecurityFormValues>;
    addPasswordForm: FormInstance<AddPasswordFormValues>;
    setLoading: (loading: boolean) => void;
    isPrimaryProfile: boolean;
    hasPasswordProvider: boolean;
    secLoading: boolean;
    addPasswordLoading: boolean;
    onSubmit: (values: ProfileFormValues) => void;
    onSecuritySubmit: (values: SecurityFormValues) => void;
    onAddPasswordSubmit: (values: AddPasswordFormValues) => void;
    profileId: string | undefined;
}>;

const resetProfileForm = async (
    profileId: string | undefined,
    setUser: Dispatch<SetStateAction<FirestoreUser | null>>,
    form: FormInstance<ProfileFormValues>,
    setLoading: (loading: boolean) => void,
): Promise<void> => {
    try {
        setLoading(true);
        const data = await fetchUserByID(profileId ?? "");
        setUser(data ?? null);
        const birthdate = parseBirthdate(data?.birthdate) ?? deriveBirthdateFromMykad(data?.IC);
        form.setFieldsValue({
            email: data?.email ?? undefined,
            IC: data?.IC ?? "",
            name: data?.name ?? "",
            country: data?.country as [country?: string, state?: string] | undefined,
            memberId: data?.memberId ?? undefined,
            school: data?.school ?? "",
            gender: data?.gender ?? undefined,
            birthdate,
            phone_number: data?.phone_number ?? "",
        });
    } catch (error) {
        console.error(error);
        setUser(null);
    } finally {
        setLoading(false);
    }
};

type UserProfileDataHookProps = Readonly<{
    profileId: string | undefined;
    selectedProfile: FirestoreUser | null;
    form: FormInstance<ProfileFormValues>;
}>;

const useUserProfileData = ({profileId, selectedProfile, form}: UserProfileDataHookProps) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [tournamentStartDates, setTournamentStartDates] = useState<Record<string, Date | null>>({});
    const [tournamentNames, setTournamentNames] = useState<Record<string, string | null>>({});

    useEffect(() => {
        if (!profileId || !selectedProfile) {
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

        const loadProfile = async (): Promise<void> => {
            try {
                const data = await fetchUserByID(profileId);
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
                    email: data?.email ?? undefined,
                    IC: data?.IC ?? "",
                    name: data?.name ?? "",
                    country: data?.country as [country?: string, state?: string] | undefined,
                    school: data?.school ?? "",
                    gender: data?.gender ?? undefined,
                    birthdate,
                    phone_number: data?.phone_number ?? "-",
                    memberId: data?.memberId ?? undefined,
                });
            } catch (error) {
                console.error(error);
                if (!cancelled) {
                    setUser(null);
                    setTournamentStartDates({});
                    setTournamentNames({});
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadProfile();
        return () => {
            cancelled = true;
        };
    }, [form, profileId, selectedProfile]);

    return {user, setUser, loading, setLoading, tournamentStartDates, tournamentNames};
};

type ProfileRouteSyncProps = Readonly<{
    selectedProfile: FirestoreUser | null;
    profileId: string | undefined;
    authProfileId: string | undefined;
    profiles: FirestoreUser[];
    searchParams: URLSearchParams;
    navigate: (path: string, options?: {replace?: boolean}) => void;
    setIsEditMode: Dispatch<SetStateAction<boolean>>;
}>;

const useProfileRouteSync = ({
    selectedProfile,
    profileId,
    authProfileId,
    profiles,
    searchParams,
    navigate,
    setIsEditMode,
}: ProfileRouteSyncProps): void => {
    useEffect(() => {
        if (!selectedProfile) {
            const fallbackProfileId = authProfileId ?? profiles[0]?.id;
            navigate(fallbackProfileId ? `/users/${fallbackProfileId}` : "/", {replace: true});
            return;
        }
        setIsEditMode(searchParams.get("isEditMode") === "true");
    }, [authProfileId, navigate, profileId, profiles, searchParams, selectedProfile, setIsEditMode]);
};

const ProfileEditPanel = ({
    user,
    setUser,
    form,
    secForm,
    addPasswordForm,
    setLoading,
    isPrimaryProfile,
    hasPasswordProvider,
    secLoading,
    addPasswordLoading,
    onSubmit,
    onSecuritySubmit,
    onAddPasswordSubmit,
    profileId,
}: ProfileEditPanelProps) => (
    <div className="user-profile-edit-page flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10">
        <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
            <div className="w-full">
                {user && <AvatarUploader user={user} setUser={setUser} />}
                <div>
                    <Title heading={4}>{user?.name}</Title>
                    <Text type="secondary">Account ID: {user?.global_id}</Text>
                </div>

                <ResponsiveTabs defaultActiveTab="basic" className="mt-6">
                    <TabPane title="Basic Information" key="basic">
                        <Form
                            requiredSymbol={false}
                            className="user-profile-edit-form flex flex-col items-start"
                            layout="horizontal"
                            labelAlign="left"
                            form={form}
                            onSubmit={onSubmit}
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
                            <Form.Item label="Name" field="name" rules={[{required: true, message: "Please enter your name"}]}>
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
                            <Form.Item field="gender" label="Gender" rules={[{required: true, message: "Select gender"}]}>
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
                                    filterOption={(input, node) => node.label.toLowerCase().includes(input.toLowerCase())}
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
                                    <Button type="primary" long onClick={() => form.submit()}>
                                        Save
                                    </Button>
                                    <Button
                                        long
                                        className="mt-4"
                                        onClick={() => resetProfileForm(profileId, setUser, form, setLoading)}
                                    >
                                        Reset
                                    </Button>
                                </div>
                            </MobileStickyActions>
                        </Form>
                    </TabPane>
                    {isPrimaryProfile && (
                        <ProfileSecurityTab
                            hasPasswordProvider={hasPasswordProvider}
                            secForm={secForm}
                            addPasswordForm={addPasswordForm}
                            secLoading={secLoading}
                            addPasswordLoading={addPasswordLoading}
                            onSecuritySubmit={onSecuritySubmit}
                            onAddPasswordSubmit={onAddPasswordSubmit}
                        />
                    )}
                </ResponsiveTabs>
            </div>
        </div>
    </div>
);

type ProfileDescriptionItem = {label: string; value: string; span?: number};
type ProfileRoleKey = keyof NonNullable<z.infer<typeof FirestoreUserSchema>["roles"]>;

const PROFILE_PERMISSIONS: {key: ProfileRoleKey; label: string}[] = [
    {key: "edit_tournament", label: "Edit Tournament"},
    {key: "record_tournament", label: "Record Tournament"},
    {key: "modify_admin", label: "Modify Admin"},
    {key: "verify_record", label: "Verify Record"},
];

type ProfileViewPanelProps = Readonly<{
    user: FirestoreUser | null;
    isMobile: boolean;
    isSmallScreen: boolean;
    descData: ProfileDescriptionItem[];
    bestTimes: UserBestTimeRecord[];
    tournamentRecords: UserTournamentRecord[];
    onEdit: () => void;
    accountAction: ReactNode;
}>;

const ProfileViewPanel = ({
    user,
    isMobile,
    isSmallScreen,
    descData,
    bestTimes,
    tournamentRecords,
    onEdit,
    accountAction,
}: ProfileViewPanelProps) => {
    const {Row, Col} = Grid;
    return (
        <div className="user-profile-view flex flex-col md:flex-row bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full md:w-1/3 gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                {user?.image_url ? (
                    <AvatarWithLoading src={user.image_url} size={isMobile ? 120 : 192} />
                ) : (
                    <div className="relative inline-block">
                        <Avatar
                            size={isMobile ? 120 : 192}
                            style={{backgroundColor: "#3370ff"}}
                            className="rounded-full overflow-hidden"
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
                    className="w-full h-full py-8 px-4"
                    border
                    column={1}
                    layout={isSmallScreen ? "vertical" : "horizontal"}
                    data={descData}
                    labelStyle={{
                        textAlign: isSmallScreen ? "left" : "right",
                        paddingRight: isSmallScreen ? 0 : 24,
                        width: isSmallScreen ? "100%" : 140,
                    }}
                    valueStyle={{textAlign: "left", width: "100%", wordBreak: "break-word", overflowWrap: "anywhere"}}
                />
                <Button className="w-full" type="primary" onClick={onEdit}>
                    Edit Profile
                </Button>
                {accountAction}
            </div>
            <div className="flex flex-col w-full md:w-2/3 h-full gap-6">
                <div className="flex flex-col h-full gap-6">
                    <div className="bg-white flex flex-col w-full gap-6 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                        <Title heading={4} className="!mb-4">
                            Best Performances
                        </Title>
                        <UserBestPerformances records={bestTimes} isMobile={isMobile} />
                    </div>
                    <div className="bg-white flex flex-col w-full gap-6 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                        <Title heading={4} className="!mb-4">
                            Tournament Participation
                        </Title>
                        <UserTournamentParticipation records={tournamentRecords} isMobile={isMobile} />
                    </div>
                    {user?.roles && (
                        <div className="bg-white flex flex-col w-full gap-4 items-start p-4 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                            <Title heading={4} className="!mb-4">
                                Admin Permissions
                            </Title>
                            <Row gutter={[16, 16]} className="w-full">
                                {PROFILE_PERMISSIONS.map(({key, label}) => (
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
    );
};

export default function RegisterPage() {
    const deviceBreakpoint = useDeviceBreakpoint();
    const isMobile = deviceBreakpoint < DeviceBreakpoint.md;
    const isSmallScreen = deviceBreakpoint <= DeviceBreakpoint.sm;
    const {id} = useParams<{id: string}>();
    const {activeProfileId, firebaseUser, profiles, refreshProfiles, user: authUser} = useAuthContext();
    const navigate = useNavigate();
    const [form] = Form.useForm<ProfileFormValues>();
    const [secForm] = Form.useForm<SecurityFormValues>();
    const [addPasswordForm] = Form.useForm<AddPasswordFormValues>();
    const [isEditMode, setIsEditMode] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(true);
    const [secLoading, setSecLoading] = useState(false);
    const [addPasswordLoading, setAddPasswordLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [removeLoading, setRemoveLoading] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const hasPasswordProvider = Boolean(firebaseUser?.providerData?.some((provider) => provider.providerId === "password"));
    const selectedOwnedProfile = profiles.find((profile) => profile.id === id) ?? null;
    const {user, setUser, loading, setLoading, tournamentStartDates, tournamentNames} = useUserProfileData({
        profileId: id,
        selectedProfile: selectedOwnedProfile,
        form,
    });
    const primaryProfile = resolvePrimaryProfile(profiles, firebaseUser?.uid);
    const isPrimaryProfile = primaryProfile?.id === id;
    const activeId = activeProfileId ?? authUser?.id ?? null;

    useProfileRouteSync({
        selectedProfile: selectedOwnedProfile,
        profileId: id,
        authProfileId: authUser?.id,
        profiles,
        searchParams,
        navigate,
        setIsEditMode,
    });

    const navigateToProfile = (nextProfileId: string) => {
        if (nextProfileId === id) return;
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

    const confirm = () =>
        showDeleteAccountConfirmation(isPrimaryProfile && profiles.length <= 1, deleteLoading, () =>
            performDeleteAccount(user?.id, setDeleteLoading, navigate),
        );

    const confirmRemoveProfile = () =>
        showRemoveProfileConfirmation(Boolean(id) && !isPrimaryProfile, removeLoading, () =>
            performRemoveProfile(
                id ?? "",
                activeId,
                primaryProfile,
                profiles,
                releaseOwnedProfile,
                refreshProfiles,
                navigate,
                setRemoveLoading,
            ),
        );

    const descData = [
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
    // 构建统计数据示例
    const allTimeStats: AllTimeStat[] = [
        {event: "3-3-3", time: (user?.best_times?.["3-3-3"] as {time?: number} | undefined)?.time ?? 0, rank: "-"},
        {event: "3-6-3", time: (user?.best_times?.["3-6-3"] as {time?: number} | undefined)?.time ?? 0, rank: "-"},
        {event: "Cycle", time: (user?.best_times?.Cycle as {time?: number} | undefined)?.time ?? 0, rank: "-"},
    ];
    const onlineBest: OnlineBest[] = [];
    const records: RecordItem[] = [];

    const handleSubmit = async (values: ProfileFormValues) => {
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
            setUser((prev) => mergeProfileFormValues(prev, values, birthdate));
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
    return (
        <div className="w-full">
            <MobilePageHeader
                title="User Profile"
                actions={
                    <ProfileSelector
                        profiles={profiles}
                        activeProfileId={activeId}
                        selectedProfileId={id}
                        isMobile={isMobile}
                        onChange={navigateToProfile}
                    />
                }
                className="p-0 md:p-6 xl:p-10"
            />
            <Spin tip="Loading..." size={40} loading={loading} className="w-full">
                {isEditMode ? (
                    <ProfileEditPanel
                        user={user}
                        setUser={setUser}
                        form={form}
                        secForm={secForm}
                        addPasswordForm={addPasswordForm}
                        setLoading={setLoading}
                        isPrimaryProfile={isPrimaryProfile}
                        hasPasswordProvider={hasPasswordProvider}
                        secLoading={secLoading}
                        addPasswordLoading={addPasswordLoading}
                        onSubmit={handleSubmit}
                        onSecuritySubmit={handleSecuritySubmit}
                        onAddPasswordSubmit={handleAddPasswordSubmit}
                        profileId={id}
                    />
                ) : (
                    <ProfileViewPanel
                        user={user}
                        isMobile={isMobile}
                        isSmallScreen={isSmallScreen}
                        descData={descData}
                        bestTimes={userBestTimes}
                        tournamentRecords={userTournamentRecords}
                        onEdit={() => {
                            setIsEditMode(true);
                            setSearchParams({isEditMode: "true"});
                        }}
                        accountAction={
                            <AccountAction
                                isPrimaryProfile={isPrimaryProfile}
                                hasMultipleProfiles={profiles.length > 1}
                                removeLoading={removeLoading}
                                onDeleteAccount={confirm}
                                onRemoveProfile={confirmRemoveProfile}
                            />
                        }
                    />
                )}
            </Spin>
        </div>
    );
}
