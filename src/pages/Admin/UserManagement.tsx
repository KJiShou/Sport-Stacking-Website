import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, ProfileClaimRequest} from "@/schema";
import {
    approveProfileClaimRequest,
    deleteUserProfileAdmin,
    fetchAllUsers,
    fetchProfileClaimRequests,
    rejectProfileClaimRequest,
    transferProfileOwnership,
    updateUserProfile,
} from "@/services/firebase/authService";
import {deriveBirthdateFromMykad, formatBirthdateForDisplay, isBirthdateMatchingMykad, parseBirthdate} from "@/utils/birthdate";
import {Button, DatePicker, Form, Input, Message, Modal, Select, Spin, Table, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {useEffect, useMemo, useState} from "react";

const {Title, Paragraph, Text} = Typography;

const getAccountStatus = (entry?: FirestoreUser | null): string => entry?.account_status ?? "claimed";

const isUnclaimedProfile = (entry?: FirestoreUser | null): boolean => getAccountStatus(entry) === "unclaimed";

const getTransferActionLabel = (entry?: FirestoreUser | null): string =>
    isUnclaimedProfile(entry) ? "Assign Gmail" : "Transfer Profile";

const getCountryLabel = (country: FirestoreUser["country"]): string =>
    Array.isArray(country) ? country.join(" / ") : (country ?? "-");

const getEnabledRoles = (entry: FirestoreUser): string[] =>
    Object.entries(entry.roles ?? {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([role]) => role);

const shouldShowNoRoles = (entry: FirestoreUser): boolean => !entry.memberId && getEnabledRoles(entry).length === 0;

const matchesSearchTerm = (entry: FirestoreUser, query: string): boolean => {
    const searchableValues = [entry.global_id?.toString(), entry.IC, entry.name, entry.email, entry.primary_owner_email];
    return searchableValues.some((value) => (value ?? "").toLowerCase().includes(query));
};

const filterUsers = (users: FirestoreUser[], searchTerm: string): FirestoreUser[] => {
    const query = searchTerm.trim().toLowerCase();
    return query ? users.filter((entry) => matchesSearchTerm(entry, query)) : users;
};

const findClaimProfileCandidate = (request: ProfileClaimRequest | null, users: FirestoreUser[]): FirestoreUser | undefined => {
    if (!request) return undefined;
    const globalId = request.profile_global_id?.trim();
    if (globalId) {
        const byGlobalId = users.find((entry) => entry.global_id === globalId);
        if (byGlobalId) return byGlobalId;
    }
    const normalizedName = request.profile_name.trim().toLowerCase();
    return users.find(
        (entry) => (entry.account_status ?? "claimed") === "unclaimed" && entry.name?.trim().toLowerCase() === normalizedName,
    );
};

export default function UserManagementPage() {
    const {user} = useAuthContext();
    const isAdmin = user?.roles?.modify_admin || false;

    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedUser, setSelectedUser] = useState<FirestoreUser | null>(null);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [transferModalVisible, setTransferModalVisible] = useState(false);
    const [claimReviewModalVisible, setClaimReviewModalVisible] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [claimRequests, setClaimRequests] = useState<ProfileClaimRequest[]>([]);
    const [selectedClaimRequest, setSelectedClaimRequest] = useState<ProfileClaimRequest | null>(null);
    const [editForm] = Form.useForm();
    const [transferForm] = Form.useForm<{targetEmail: string}>();
    const [claimReviewForm] = Form.useForm<{profileId: string; rejectionReason: string}>();

    const loadUsers = async () => {
        setLoading(true);
        const [usersResult, claimRequestsResult] = await Promise.allSettled([
            fetchAllUsers(),
            fetchProfileClaimRequests("pending"),
        ]);

        if (usersResult.status === "fulfilled") {
            setUsers(usersResult.value);
        } else {
            console.error("Failed to load users:", usersResult.reason);
            Message.error("Failed to load users");
        }

        if (claimRequestsResult.status === "fulfilled") {
            setClaimRequests(claimRequestsResult.value);
        } else {
            console.error("Failed to load profile claim requests:", claimRequestsResult.reason);
            Message.error("Failed to load profile claim requests");
        }

        setLoading(false);
    };

    useEffect(() => {
        if (isAdmin) {
            loadUsers();
        }
    }, [isAdmin]);

    const filteredUsers = useMemo(() => filterUsers(users, searchTerm), [users, searchTerm]);
    const selectedClaimCandidate = useMemo(
        () => findClaimProfileCandidate(selectedClaimRequest, users),
        [selectedClaimRequest, users],
    );

    const handleViewDetail = (entry: FirestoreUser) => {
        const birthdate = parseBirthdate(entry.birthdate) ?? deriveBirthdateFromMykad(entry.IC);
        setSelectedUser(entry);
        setDetailModalVisible(true);
        setEditMode(false);
        editForm.setFieldsValue({
            name: entry.name ?? "",
            phone_number: entry.phone_number ?? "",
            school: entry.school ?? "",
            gender: entry.gender ?? undefined,
            birthdate,
        });
    };

    const handleOpenTransferModal = () => {
        if (!selectedUser) return;
        transferForm.resetFields();
        setTransferModalVisible(true);
    };

    const handleOpenClaimReview = (request: ProfileClaimRequest) => {
        const candidate = findClaimProfileCandidate(request, users);
        setSelectedClaimRequest(request);
        claimReviewForm.setFieldsValue({
            profileId: candidate?.id ?? request.matched_profile_id ?? "",
            rejectionReason: "",
        });
        setClaimReviewModalVisible(true);
    };

    const handleApproveClaimRequest = async () => {
        if (!selectedClaimRequest?.id) return;
        try {
            const values = await claimReviewForm.validate();
            const profileId = values.profileId.trim();
            if (!profileId) {
                Message.error("Enter the profile document ID to approve this claim.");
                return;
            }
            setLoading(true);
            await approveProfileClaimRequest(selectedClaimRequest.id, profileId);
            Message.success("Claim request approved");
            setClaimReviewModalVisible(false);
            setSelectedClaimRequest(null);
            await loadUsers();
        } catch (error) {
            Message.error(error instanceof Error ? error.message : "Failed to approve claim request");
        } finally {
            setLoading(false);
        }
    };

    const handleRejectClaimRequest = async () => {
        if (!selectedClaimRequest?.id) return;
        try {
            const rejectionReason = claimReviewForm.getFieldValue("rejectionReason")?.trim();
            if (!rejectionReason) {
                Message.error("Enter a rejection reason.");
                return;
            }
            setLoading(true);
            await rejectProfileClaimRequest(selectedClaimRequest.id, rejectionReason);
            Message.success("Claim request rejected");
            setClaimReviewModalVisible(false);
            setSelectedClaimRequest(null);
            await loadUsers();
        } catch (error) {
            Message.error(error instanceof Error ? error.message : "Failed to reject claim request");
        } finally {
            setLoading(false);
        }
    };

    const handleTransferOwnership = async () => {
        if (!selectedUser?.id) return;

        try {
            const values = await transferForm.validate();
            const targetEmail = values.targetEmail.trim().toLowerCase();
            setLoading(true);
            const updatedOwnership = await transferProfileOwnership(selectedUser.id, targetEmail);
            const nextPatch: Partial<FirestoreUser> = {
                owner_uids: updatedOwnership.owner_uids,
                email: updatedOwnership.email,
                primary_owner_email: updatedOwnership.primary_owner_email,
                account_status: updatedOwnership.account_status,
            };

            setUsers((prev) => prev.map((entry) => (entry.id === selectedUser.id ? {...entry, ...nextPatch} : entry)));
            setSelectedUser((prev) => (prev ? {...prev, ...nextPatch} : prev));
            setTransferModalVisible(false);
            Message.success("Profile ownership updated");
        } catch (error) {
            Message.error(error instanceof Error ? error.message : "Failed to transfer profile ownership");
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedUser?.id) return;
        Modal.confirm({
            title: "Delete Account",
            content: `Delete ${selectedUser.name ?? selectedUser.email ?? selectedUser.id}? This cannot be undone.`,
            okText: "Delete",
            cancelText: "Cancel",
            okButtonProps: {status: "danger"},
            onOk: async () => {
                try {
                    setLoading(true);
                    await deleteUserProfileAdmin(selectedUser.id);
                    setUsers((prev) => prev.filter((entry) => entry.id !== selectedUser.id));
                    setDetailModalVisible(false);
                    setSelectedUser(null);
                    Message.success("Account deleted");
                } catch (error) {
                    console.error("Failed to delete account:", error);
                    Message.error("Failed to delete account");
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleSaveEdit = async () => {
        if (!selectedUser?.id) return;
        try {
            const values = await editForm.validate();
            const birthdate = parseBirthdate(values.birthdate);
            if (!birthdate) {
                Message.error("Select a valid birthdate");
                return;
            }
            if (/^\d{12}$/.test(selectedUser.IC ?? "") && !isBirthdateMatchingMykad(selectedUser.IC, birthdate)) {
                Message.error("Birthdate must match the IC number");
                return;
            }
            setLoading(true);
            await updateUserProfile(selectedUser.id, {
                name: values.name,
                phone_number: values.phone_number,
                school: values.school,
                gender: values.gender,
                birthdate,
            });
            setUsers((prev) =>
                prev.map((entry) =>
                    entry.id === selectedUser.id
                        ? {
                              ...entry,
                              name: values.name,
                              phone_number: values.phone_number,
                              school: values.school,
                              gender: values.gender,
                              birthdate,
                          }
                        : entry,
                ),
            );
            setSelectedUser((prev) =>
                prev
                    ? {
                          ...prev,
                          name: values.name,
                          phone_number: values.phone_number,
                          school: values.school,
                          gender: values.gender,
                          birthdate,
                      }
                    : prev,
            );
            Message.success("User updated");
            setEditMode(false);
        } catch (error) {
            if (error) {
                Message.error("Failed to update user");
            }
        } finally {
            setLoading(false);
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

    const columns: TableColumnProps<FirestoreUser>[] = [
        {title: "Global ID", dataIndex: "global_id", width: 120},
        {title: "IC", dataIndex: "IC", width: 160},
        {title: "Name", dataIndex: "name", width: 200},
        {title: "Gmail", dataIndex: "email", width: 220},
        {
            title: "Status",
            dataIndex: "account_status",
            width: 120,
            render: (_, record) => {
                const status = record.account_status ?? "claimed";
                return <Tag color={status === "unclaimed" ? "orange" : "green"}>{status}</Tag>;
            },
        },
        {
            title: "Action",
            width: 140,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => handleViewDetail(record)}>
                    View Detail
                </Button>
            ),
        },
    ];

    const claimRequestColumns: TableColumnProps<ProfileClaimRequest>[] = [
        {title: "Requester Gmail", dataIndex: "requester_email", width: 220},
        {title: "Profile Name", dataIndex: "profile_name", width: 200},
        {title: "Global ID", dataIndex: "profile_global_id", width: 120, render: (value) => value || "-"},
        {title: "Identity Hint", dataIndex: "identity_hint", width: 160, render: (value) => value || "-"},
        {title: "Tournament Hint", dataIndex: "tournament_hint", width: 220, render: (value) => value || "-"},
        {
            title: "Action",
            width: 140,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => handleOpenClaimReview(record)}>
                    Review
                </Button>
            ),
        },
    ];

    const selectedUserStatus = getAccountStatus(selectedUser);
    const selectedUserStatusColor = isUnclaimedProfile(selectedUser) ? "orange" : "green";
    const transferActionLabel = getTransferActionLabel(selectedUser);
    const selectedUserEnabledRoles = selectedUser ? getEnabledRoles(selectedUser) : [];
    const selectedUserHasNoRoles = selectedUser ? shouldShowNoRoles(selectedUser) : false;

    return (
        <div className="flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full">
            <Spin loading={loading} tip="Loading users..." className="w-full">
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                    <div className="w-full">
                        <div className="flex justify-between items-center mb-6">
                            <Title heading={2}>User Management</Title>
                            <Button type="primary" onClick={loadUsers} loading={loading}>
                                Refresh
                            </Button>
                        </div>

                        <Input
                            prefix={<IconSearch />}
                            placeholder="Search by Global ID, IC, name, or Gmail"
                            value={searchTerm}
                            onChange={(value) => setSearchTerm(value)}
                            allowClear
                            className="mb-4"
                        />

                        <Table
                            rowKey={(record) => record.id ?? record.global_id ?? record.email ?? ""}
                            columns={columns}
                            data={filteredUsers}
                            pagination={{pageSize: 10}}
                            loading={loading}
                        />

                        <div className="mt-8">
                            <div className="flex justify-between items-center mb-4">
                                <Title heading={3}>Pending Profile Claims</Title>
                                <Tag color="orange">{claimRequests.length}</Tag>
                            </div>
                            <Table
                                rowKey={(record) => record.id ?? `${record.requester_uid}-${record.profile_name}`}
                                columns={claimRequestColumns}
                                data={claimRequests}
                                pagination={{pageSize: 5}}
                                loading={loading}
                            />
                        </div>
                    </div>
                </div>
            </Spin>

            <Modal
                title="User Detail"
                visible={detailModalVisible}
                onCancel={() => {
                    setDetailModalVisible(false);
                    setSelectedUser(null);
                    setEditMode(false);
                    setTransferModalVisible(false);
                }}
                footer={
                    <div className="flex justify-between items-center w-full">
                        <Button onClick={() => setDetailModalVisible(false)}>Close</Button>
                        <div className="flex gap-2">
                            {editMode ? (
                                <Button type="primary" onClick={handleSaveEdit} loading={loading}>
                                    Save
                                </Button>
                            ) : (
                                <Button type="primary" onClick={() => setEditMode(true)}>
                                    Edit
                                </Button>
                            )}
                            <Button onClick={handleOpenTransferModal}>{transferActionLabel}</Button>
                            <Button status="danger" onClick={handleDelete}>
                                Delete Account
                            </Button>
                        </div>
                    </div>
                }
            >
                {selectedUser ? (
                    <div className="flex flex-col gap-3">
                        <div>
                            <Text type="secondary">Global ID</Text>
                            <div>{selectedUser.global_id ?? "-"}</div>
                        </div>
                        <div>
                            <Text type="secondary">IC</Text>
                            <div>{selectedUser.IC ?? "-"}</div>
                        </div>
                        <div>
                            <Text type="secondary">Email</Text>
                            <div>{selectedUser.email ?? "-"}</div>
                        </div>
                        <div>
                            <Text type="secondary">Ownership</Text>
                            <div className="flex flex-col gap-1">
                                <div>
                                    <Tag color={selectedUserStatusColor}>{selectedUserStatus}</Tag>
                                    {selectedUser.source && <Tag>{selectedUser.source}</Tag>}
                                </div>
                                <div>Primary owner Gmail: {selectedUser.primary_owner_email ?? "-"}</div>
                            </div>
                        </div>
                        {editMode ? (
                            <Form form={editForm} layout="vertical">
                                <Form.Item label="Name" field="name" rules={[{required: true, message: "Enter name"}]}>
                                    <Input />
                                </Form.Item>
                                <Form.Item label="Phone" field="phone_number">
                                    <Input />
                                </Form.Item>
                                <Form.Item label="Gender" field="gender">
                                    <Select allowClear>
                                        <Select.Option value="Male">Male</Select.Option>
                                        <Select.Option value="Female">Female</Select.Option>
                                    </Select>
                                </Form.Item>
                                <Form.Item
                                    label="Birthdate"
                                    field="birthdate"
                                    rules={[{required: true, message: "Select birthdate"}]}
                                >
                                    <DatePicker
                                        format="DD/MM/YYYY"
                                        style={{width: "100%"}}
                                        disabledDate={(current) => current.isAfter(dayjs())}
                                    />
                                </Form.Item>
                                <Form.Item label="School" field="school">
                                    <Input />
                                </Form.Item>
                            </Form>
                        ) : (
                            <>
                                <div>
                                    <Text type="secondary">Name</Text>
                                    <div>{selectedUser.name ?? "-"}</div>
                                </div>
                                <div>
                                    <Text type="secondary">Phone</Text>
                                    <div>{selectedUser.phone_number ?? "-"}</div>
                                </div>
                                <div>
                                    <Text type="secondary">Gender</Text>
                                    <div>{selectedUser.gender ?? "-"}</div>
                                </div>
                                <div>
                                    <Text type="secondary">Birthdate</Text>
                                    <div>{formatBirthdateForDisplay(selectedUser.birthdate, selectedUser.IC)}</div>
                                </div>
                                <div>
                                    <Text type="secondary">Country / State</Text>
                                    <div>{getCountryLabel(selectedUser.country)}</div>
                                </div>
                                <div>
                                    <Text type="secondary">School</Text>
                                    <div>{selectedUser.school ?? "-"}</div>
                                </div>
                            </>
                        )}
                        <div>
                            <Text type="secondary">Roles</Text>
                            <div className="flex flex-wrap gap-2">
                                {selectedUserEnabledRoles.map((role) => (
                                    <Tag key={role} color="blue">
                                        {role.replace(/_/g, " ")}
                                    </Tag>
                                ))}
                                {selectedUser.memberId && <Tag color="green">memberId: {selectedUser.memberId}</Tag>}
                                {selectedUserHasNoRoles && <Text>-</Text>}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>

            <Modal
                title={transferActionLabel}
                visible={transferModalVisible}
                onCancel={() => setTransferModalVisible(false)}
                onOk={handleTransferOwnership}
                confirmLoading={loading}
                okText="Confirm"
            >
                <Form form={transferForm} layout="vertical">
                    <Paragraph>
                        This will replace the current profile owner. Enter a Gmail that already has a Firebase account.
                    </Paragraph>
                    <Form.Item
                        label="Target Gmail"
                        field="targetEmail"
                        rules={[
                            {required: true, message: "Enter target Gmail"},
                            {type: "email", message: "Enter a valid Gmail"},
                        ]}
                    >
                        <Input allowClear placeholder="name@gmail.com" />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                title="Review Profile Claim"
                visible={claimReviewModalVisible}
                onCancel={() => {
                    setClaimReviewModalVisible(false);
                    setSelectedClaimRequest(null);
                }}
                footer={
                    <div className="flex justify-between items-center w-full">
                        <Button onClick={() => setClaimReviewModalVisible(false)}>Cancel</Button>
                        <div className="flex gap-2">
                            <Button status="danger" onClick={handleRejectClaimRequest} loading={loading}>
                                Reject
                            </Button>
                            <Button type="primary" onClick={handleApproveClaimRequest} loading={loading}>
                                Approve
                            </Button>
                        </div>
                    </div>
                }
            >
                {selectedClaimRequest ? (
                    <div className="flex flex-col gap-3">
                        <div>
                            <Text type="secondary">Requester Gmail</Text>
                            <div>{selectedClaimRequest.requester_email}</div>
                        </div>
                        <div>
                            <Text type="secondary">Requested Profile</Text>
                            <div>
                                {selectedClaimRequest.profile_name}
                                {selectedClaimRequest.profile_global_id ? ` (${selectedClaimRequest.profile_global_id})` : ""}
                            </div>
                        </div>
                        <div>
                            <Text type="secondary">Hints</Text>
                            <div>
                                IC/passport: {selectedClaimRequest.identity_hint ?? "-"}
                                <br />
                                Birthdate: {formatBirthdateForDisplay(selectedClaimRequest.birthdate_hint, null)}
                                <br />
                                Tournament: {selectedClaimRequest.tournament_hint ?? "-"}
                            </div>
                        </div>
                        {selectedClaimRequest.note && (
                            <div>
                                <Text type="secondary">Note</Text>
                                <div>{selectedClaimRequest.note}</div>
                            </div>
                        )}
                        {selectedClaimCandidate && (
                            <div>
                                <Text type="secondary">Suggested Match</Text>
                                <div>
                                    {selectedClaimCandidate.name} / {selectedClaimCandidate.global_id ?? "-"} / doc{" "}
                                    {selectedClaimCandidate.id}
                                </div>
                            </div>
                        )}
                        <Form form={claimReviewForm} layout="vertical">
                            <Form.Item label="Profile Document ID To Claim" field="profileId">
                                <Input allowClear placeholder="Firestore users document ID" />
                            </Form.Item>
                            <Form.Item label="Rejection Reason" field="rejectionReason">
                                <Input.TextArea
                                    placeholder="Required only when rejecting"
                                    autoSize={{minRows: 2, maxRows: 4}}
                                    maxLength={500}
                                    showWordLimit
                                />
                            </Form.Item>
                        </Form>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
