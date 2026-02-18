import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Profile} from "@/schema";
import {countries} from "@/schema/Country";
import {fetchAllUsers} from "@/services/firebase/authService";
import {
    createProfile,
    deleteProfile,
    fetchAllProfiles,
    syncProfilesWithUsers,
    updateProfile,
} from "@/services/firebase/profileService";
import {updateParticipantRankingsAndResults, updateProfileBestTimesFromFinalRecords} from "@/services/firebase/recordService";
import {parseIcToProfile} from "@/utils/icParser";
import {
    Button,
    Cascader,
    DatePicker,
    Dropdown,
    Form,
    Input,
    Menu,
    Message,
    Modal,
    Popconfirm,
    Select,
    Spin,
    Table,
    Tag,
    Typography,
} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconCopy, IconDelete, IconEdit, IconMore, IconPlus, IconRefresh, IconUserGroup} from "@arco-design/web-react/icon";
import Papa from "papaparse";
import {useEffect, useMemo, useRef, useState} from "react";

const {Title, Paragraph} = Typography;

type CsvProfileRow = {
    name?: string;
    IC?: string;
    ic?: string;
    birthdate?: string;
    dob?: string;
    gender?: string;
    email?: string;
    contact_email?: string;
    phone_number?: string;
    phone?: string;
    school?: string;
    country?: string;
};

const normalizeGender = (value?: string): "Male" | "Female" | null => {
    if (!value) return null;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "male" || trimmed === "m") return "Male";
    if (trimmed === "female" || trimmed === "f") return "Female";
    return null;
};

const parseDate = (value?: string): Date | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed;
};

export default function ProfileManagementPage() {
    const {user, refreshProfiles} = useAuthContext();
    const isAdmin = user?.roles?.modify_admin || false;

    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [transferModalVisible, setTransferModalVisible] = useState(false);
    const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
    const [transferForm] = Form.useForm();
    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [createModalVisible, setCreateModalVisible] = useState(false);
    const [createForm] = Form.useForm();
    const [editModalVisible, setEditModalVisible] = useState(false);
    const [editForm] = Form.useForm();
    const [deleteModalVisible, setDeleteModalVisible] = useState(false);
    const [syncingTournament, setSyncingTournament] = useState(false);
    const importInputRef = useRef<HTMLInputElement | null>(null);

    const loadProfiles = async () => {
        setLoading(true);
        try {
            const data = await fetchAllProfiles();
            setProfiles(data);
        } catch (error) {
            console.error("Failed to load profiles:", error);
            Message.error("Failed to load profiles");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isAdmin) {
            return;
        }
        loadProfiles();
        (async () => {
            try {
                const allUsers = await fetchAllUsers();
                setUsers(allUsers);
            } catch (error) {
                console.error("Failed to load users:", error);
            }
        })();
    }, [isAdmin]);

    const filteredProfiles = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        const filtered = !query
            ? [...profiles]
            : profiles.filter((profile) => {
                  const values = [profile.global_id, profile.IC, profile.name, profile.contact_email, profile.owner_email]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase();
                  return values.includes(query);
              });

        return filtered.sort((a, b) => {
            const aId = a.global_id ?? "";
            const bId = b.global_id ?? "";
            if (!aId && !bId) return 0;
            if (!aId) return 1;
            if (!bId) return -1;
            const comparison = aId.localeCompare(bId, undefined, {numeric: true, sensitivity: "base"});
            if (comparison !== 0) return comparison;
            return (a.name ?? "").localeCompare(b.name ?? "", undefined, {sensitivity: "base"});
        });
    }, [profiles, searchTerm]);

    const handleSyncProfilesFromTournament = async () => {
        setSyncingTournament(true);
        try {
            const tournamentId = window.prompt("Enter tournament ID to update classification (leave blank to skip):", "");
            for (const profile of profiles) {
                if (profile.global_id) {
                    await updateProfileBestTimesFromFinalRecords(profile.global_id);
                }
            }

            if (tournamentId) {
                const classifications = ["prelim", "advance", "intermediate", "beginner"] as const;
                for (const classification of classifications) {
                    await updateParticipantRankingsAndResults(tournamentId, classification);
                }
            }

            await loadProfiles();
            refreshProfiles();
            Message.success("Profiles updated from final records.");
        } catch (error) {
            console.error("Failed to update profiles from final records:", error);
            Message.error("Failed to update profiles from final records.");
        } finally {
            setSyncingTournament(false);
        }
    };

    const handleCsvImport = async (file: File) => {
        setImporting(true);
        try {
            const text = await file.text();
            const parsed = Papa.parse<CsvProfileRow>(text, {header: true, skipEmptyLines: true});
            if (parsed.errors.length > 0) {
                console.warn("CSV parse errors:", parsed.errors);
            }

            const rows = parsed.data.filter((row) => row && (row.name || row.IC || row.ic));
            for (const row of rows) {
                const ic = row.IC ?? row.ic ?? "";
                const name = row.name ?? "";
                const gender = normalizeGender(row.gender) ?? "Male";
                const birthdate = parseDate(row.birthdate ?? row.dob) ?? new Date();
                const contactEmail = row.contact_email ?? row.email ?? null;
                const phone = row.phone_number ?? row.phone ?? null;
                const country = row.country ? [row.country, row.country] : null;

                if (!ic || !name) {
                    continue;
                }

                try {
                    await createProfile({
                        owner_uid: null,
                        owner_email: null,
                        name,
                        IC: ic,
                        birthdate,
                        gender,
                        country,
                        phone_number: phone,
                        school: row.school ?? null,
                        contact_email: contactEmail,
                        image_url: null, // CSV import doesn't support image URL yet
                        status: "unclaimed",
                        created_by_admin_id: user?.id ?? null,
                    });
                } catch (error) {
                    console.warn("Skipping duplicate/invalid profile row:", {ic, name, error});
                }
            }

            Message.success("Profiles imported");
            await loadProfiles();
            refreshProfiles(); // Refresh global context profiles for current user if applicable
        } catch (error) {
            console.error("Failed to import profiles:", error);
            Message.error("Failed to import profiles");
        } finally {
            setImporting(false);
        }
    };

    const handleDownloadSampleCsv = () => {
        const header = "name,IC,birthdate,gender,email,phone,school,country\n";
        const sample = "Ali Ahmad,001231141234,2000-12-31,Male,ali@example.com,0123456789,SMK Example,Malaysia\n";
        const blob = new Blob([header, sample], {type: "text/csv;charset=utf-8;"});
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "profiles_sample.csv";
        link.click();
        URL.revokeObjectURL(link.href);
    };

    const handleCopyInvite = async (profile: Profile) => {
        if (!profile.id) return;
        const link = `${window.location.origin}/profiles/claim/${profile.id}`;
        try {
            await navigator.clipboard.writeText(link);
            Message.success("Invite link copied");
        } catch (error) {
            console.error("Failed to copy invite link:", error);
            Message.error("Failed to copy invite link");
        }
    };

    const openEditModal = (profile: Profile) => {
        setSelectedProfile(profile);
        editForm.setFieldsValue({
            name: profile.name,
            IC: profile.IC,
            birthdate: profile.birthdate ?? undefined,
            gender: profile.gender,
            phone_number: profile.phone_number ?? "",
            school: profile.school ?? "",
            contact_email: profile.contact_email ?? "",
            country: profile.country ?? undefined,
        });
        setEditModalVisible(true);
    };

    const handleEditProfile = async () => {
        if (!selectedProfile?.id) return;
        try {
            const values = await editForm.validate();
            const birthdateValue =
                values.birthdate && typeof values.birthdate.toDate === "function" ? values.birthdate.toDate() : values.birthdate;
            await updateProfile(selectedProfile.id, {
                name: values.name,
                birthdate: birthdateValue,
                gender: values.gender,
                phone_number: values.phone_number ?? null,
                school: values.school ?? null,
                contact_email: values.contact_email ?? null,
                country: values.country ?? null,
            });
            Message.success("Profile updated");
            setEditModalVisible(false);
            await loadProfiles();
            refreshProfiles();
        } catch (error) {
            if (error instanceof Error) {
                Message.error(error.message);
            } else {
                Message.error("Failed to update profile");
            }
        }
    };

    const handleCreateProfile = async () => {
        try {
            const values = await createForm.validate();
            const birthdateValue =
                values.birthdate && typeof values.birthdate.toDate === "function" ? values.birthdate.toDate() : values.birthdate;
            await createProfile({
                owner_uid: null,
                owner_email: null,
                name: values.name,
                IC: values.IC,
                birthdate: birthdateValue,
                gender: values.gender,
                country: values.country ?? null,
                phone_number: values.phone_number ?? null,
                school: values.school ?? null,
                contact_email: values.contact_email ?? null,
                image_url: null,
                status: "unclaimed",
                created_by_admin_id: user?.id ?? null,
            });
            Message.success("Profile created");
            setCreateModalVisible(false);
            createForm.resetFields();
            await loadProfiles();
            refreshProfiles();
        } catch (error) {
            if (error instanceof Error) {
                Message.error(error.message);
            } else {
                Message.error("Failed to create profile");
            }
        }
    };

    const openTransferModal = (profile: Profile) => {
        setSelectedProfile(profile);
        transferForm.setFieldsValue({
            owner_uid: profile.owner_uid ?? "",
            owner_email: profile.owner_email ?? "",
        });
        setTransferModalVisible(true);
    };

    const handleTransfer = async () => {
        if (!selectedProfile?.id) return;
        try {
            const values = await transferForm.validate();
            await updateProfile(selectedProfile.id, {
                owner_uid: values.owner_uid || null,
                owner_email: values.owner_email || null,
                status: values.owner_uid ? "claimed" : "unclaimed",
            });
            Message.success("Profile updated");
            setTransferModalVisible(false);
            await loadProfiles();
        } catch (error) {
            console.error("Failed to update profile:", error);
            Message.error("Failed to update profile");
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="text-center">
                    <Title heading={3}>Access Denied</Title>
                    <Paragraph>You don't have permission to access this page.</Paragraph>
                </div>
            </div>
        );
    }

    const columns: TableColumnProps<Profile>[] = [
        {title: "Global ID", dataIndex: "global_id", width: 120},
        {title: "IC", dataIndex: "IC", width: 160},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "Contact Email", dataIndex: "contact_email", width: 220},
        {title: "Owner Email", dataIndex: "owner_email", width: 220},
        {
            title: "Status",
            width: 120,
            sorter: (a, b) => (a.status ?? "unclaimed").localeCompare(b.status ?? "unclaimed"),
            render: (_, record) => (
                <Tag color={record.status === "claimed" ? "green" : "orange"}>
                    {record.status === "claimed" ? "Claimed" : "Unclaimed"}
                </Tag>
            ),
        },
        {
            title: "Action",
            width: 280,
            render: (_, record) => (
                <div className="flex gap-2">
                    <Button size="small" type="primary" icon={<IconEdit />} onClick={() => openEditModal(record)}>
                        Edit
                    </Button>
                    <Dropdown
                        droplist={
                            <Menu>
                                <Menu.Item key="transfer" onClick={() => openTransferModal(record)}>
                                    <IconUserGroup /> Transfer
                                </Menu.Item>
                                <Menu.Item key="invite" onClick={() => handleCopyInvite(record)}>
                                    <IconCopy /> Invite
                                </Menu.Item>
                                <Menu.Item
                                    key="delete"
                                    onClick={() => {
                                        setSelectedProfile(record);
                                        setDeleteModalVisible(true);
                                    }}
                                >
                                    <span className="text-red-600">
                                        <IconDelete /> Delete
                                    </span>
                                </Menu.Item>
                            </Menu>
                        }
                        trigger="click"
                    >
                        <Button size="small" icon={<IconMore />}>
                            More
                        </Button>
                    </Dropdown>
                </div>
            ),
        },
    ];

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <Spin loading={loading || importing} tip="Loading profiles..." className="w-full">
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-6">
                            <Title heading={2}>Profile Management</Title>
                            <div className="flex gap-2">
                                <Button type="primary" icon={<IconRefresh />} onClick={loadProfiles} loading={loading}>
                                    Refresh
                                </Button>
                                <Button
                                    type="outline"
                                    icon={<IconUserGroup />}
                                    onClick={handleSyncProfilesFromTournament}
                                    loading={syncingTournament}
                                >
                                    Update Best Performances (Final Only)
                                </Button>
                                <Dropdown
                                    droplist={
                                        <Menu>
                                            <Menu.Item key="add" onClick={() => setCreateModalVisible(true)}>
                                                <IconPlus /> Add Profile
                                            </Menu.Item>
                                            <Menu.Item
                                                key="sync"
                                                onClick={async () => {
                                                    try {
                                                        setLoading(true);
                                                        const result = await syncProfilesWithUsers();
                                                        Message.success(
                                                            `Profiles synced. Created ${result.created}, updated ${result.updated}, skipped ${result.skipped}.`,
                                                        );
                                                        await loadProfiles();
                                                    } catch (error) {
                                                        console.error("Failed to sync profiles:", error);
                                                        Message.error("Failed to sync profiles");
                                                    } finally {
                                                        setLoading(false);
                                                    }
                                                }}
                                            >
                                                <IconUserGroup /> Sync Missing Profiles
                                            </Menu.Item>
                                            <Menu.Item key="download" onClick={handleDownloadSampleCsv}>
                                                <IconCopy /> Download Sample CSV
                                            </Menu.Item>
                                            <Menu.Item key="import" onClick={() => importInputRef.current?.click()}>
                                                <IconPlus /> Import CSV
                                            </Menu.Item>
                                        </Menu>
                                    }
                                    trigger="click"
                                >
                                    <Button icon={<IconMore />} loading={loading || importing}>
                                        More
                                    </Button>
                                </Dropdown>
                            </div>
                        </div>

                        <input
                            ref={importInputRef}
                            type="file"
                            accept=".csv"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    handleCsvImport(file);
                                }
                                if (importInputRef.current) {
                                    importInputRef.current.value = "";
                                }
                            }}
                        />

                        <div className="flex flex-col md:flex-row gap-3 items-center mb-4">
                            <Input
                                placeholder="Search by Global ID, IC, name, or email"
                                value={searchTerm}
                                onChange={(value) => setSearchTerm(value)}
                                allowClear
                                className="flex-1"
                            />
                        </div>

                        <Table
                            rowKey={(record) => record.id ?? record.global_id ?? record.IC}
                            columns={columns}
                            data={filteredProfiles}
                            pagination={{pageSize: 10}}
                        />
                    </div>
                </div>
            </Spin>

            <Modal
                title="Add Profile"
                visible={createModalVisible}
                onCancel={() => {
                    setCreateModalVisible(false);
                    createForm.resetFields();
                }}
                onOk={handleCreateProfile}
            >
                <Form form={createForm} layout="vertical">
                    <Form.Item label="Name" field="name" rules={[{required: true, message: "Enter name"}]}>
                        <Input placeholder="Full name" />
                    </Form.Item>
                    <Form.Item
                        label="IC"
                        field="IC"
                        rules={[
                            {required: true, message: "Enter IC"},
                            {match: /^\d{12}$/, message: "IC must be 12 digits"},
                        ]}
                    >
                        <Input
                            placeholder="123456789012"
                            onChange={(value) => {
                                const derived = parseIcToProfile(value);
                                if (derived.birthdate) {
                                    createForm.setFieldValue("birthdate", derived.birthdate);
                                }
                                if (derived.gender) {
                                    createForm.setFieldValue("gender", derived.gender);
                                }
                            }}
                        />
                    </Form.Item>
                    <Form.Item label="Birthdate" field="birthdate" rules={[{required: true, message: "Select birthdate"}]}>
                        <DatePicker style={{width: "100%"}} />
                    </Form.Item>
                    <Form.Item label="Gender" field="gender" rules={[{required: true, message: "Select gender"}]}>
                        <Select placeholder="Select gender" options={["Male", "Female"]} />
                    </Form.Item>
                    <Form.Item label="Phone Number" field="phone_number">
                        <Input placeholder="Phone number" />
                    </Form.Item>
                    <Form.Item label="School" field="school">
                        <Input placeholder="School/University/College" />
                    </Form.Item>
                    <Form.Item label="Contact Email" field="contact_email">
                        <Input placeholder="Optional contact email" />
                    </Form.Item>
                    <Form.Item label="Country / State" field="country">
                        <Cascader
                            showSearch
                            changeOnSelect
                            allowClear
                            filterOption={(input, node) => node.label.toLowerCase().includes(input.toLowerCase())}
                            options={countries}
                            placeholder="Please select location"
                            expandTrigger="hover"
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Edit Profile"
                visible={editModalVisible}
                onCancel={() => {
                    setEditModalVisible(false);
                    editForm.resetFields();
                }}
                onOk={handleEditProfile}
            >
                <Form form={editForm} layout="vertical">
                    <Form.Item label="Name" field="name" rules={[{required: true, message: "Enter name"}]}>
                        <Input placeholder="Full name" />
                    </Form.Item>
                    <Form.Item
                        label="IC"
                        field="IC"
                        rules={[
                            {required: true, message: "Enter IC"},
                            {match: /^\d{12}$/, message: "IC must be 12 digits"},
                        ]}
                    >
                        <Input disabled placeholder="IC cannot be changed" />
                    </Form.Item>
                    <Form.Item label="Birthdate" field="birthdate" rules={[{required: true, message: "Select birthdate"}]}>
                        <DatePicker style={{width: "100%"}} />
                    </Form.Item>
                    <Form.Item label="Gender" field="gender" rules={[{required: true, message: "Select gender"}]}>
                        <Select placeholder="Select gender" options={["Male", "Female"]} />
                    </Form.Item>
                    <Form.Item label="Phone Number" field="phone_number">
                        <Input placeholder="Phone number" />
                    </Form.Item>
                    <Form.Item label="School" field="school">
                        <Input placeholder="School/University/College" />
                    </Form.Item>
                    <Form.Item label="Contact Email" field="contact_email">
                        <Input placeholder="Optional contact email" />
                    </Form.Item>
                    <Form.Item label="Country / State" field="country">
                        <Cascader
                            showSearch
                            changeOnSelect
                            allowClear
                            filterOption={(input, node) => node.label.toLowerCase().includes(input.toLowerCase())}
                            options={countries}
                            placeholder="Please select location"
                            expandTrigger="hover"
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Transfer / Assign Profile"
                visible={transferModalVisible}
                onCancel={() => setTransferModalVisible(false)}
                onOk={handleTransfer}
            >
                <Form form={transferForm} layout="vertical">
                    <Form.Item label="Owner Gmail" field="owner_uid">
                        <Select
                            allowClear
                            showSearch
                            placeholder="Search by Gmail or name"
                            onChange={(value) => {
                                const selected = users.find((entry) => entry.id === value);
                                transferForm.setFieldValue("owner_email", selected?.email ?? "");
                            }}
                            filterOption={(inputValue, option) => {
                                const query = inputValue.toLowerCase();
                                const children = String(option?.props?.children ?? "").toLowerCase();
                                return children.includes(query);
                            }}
                        >
                            {users.map((entry) => {
                                const label = `${entry.email ?? "-"} • ${entry.name ?? ""}`;
                                return (
                                    <Select.Option key={entry.id} value={entry.id}>
                                        {label}
                                    </Select.Option>
                                );
                            })}
                        </Select>
                    </Form.Item>
                    <Form.Item label="Owner Email (auto-filled)" field="owner_email">
                        <Input disabled placeholder="Auto-filled from Gmail selection" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Confirm Deletion"
                visible={deleteModalVisible}
                onCancel={() => setDeleteModalVisible(false)}
                onOk={async () => {
                    if (!selectedProfile?.id) return;
                    try {
                        await deleteProfile(selectedProfile.id);
                        Message.success("Profile deleted");
                        setDeleteModalVisible(false);
                        await loadProfiles();
                    } catch (error) {
                        console.error("Failed to delete profile:", error);
                        Message.error("Failed to delete profile");
                    }
                }}
                okButtonProps={{status: "danger"}}
            >
                <Paragraph>
                    Are you sure you want to delete profile <b>{selectedProfile?.name}</b> ({selectedProfile?.global_id})?
                </Paragraph>
                <Paragraph type="secondary">This action cannot be undone.</Paragraph>
            </Modal>
        </div>
    );
}
