import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser} from "@/schema";
import {deleteUserProfileAdmin, fetchAllUsers, updateUserProfile} from "@/services/firebase/authService";
import {Button, Form, Input, Message, Modal, Select, Spin, Table, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";

const {Title, Paragraph, Text} = Typography;

const formatBirthdate = (birthdate: FirestoreUser["birthdate"]): string => {
    if (birthdate instanceof Date) {
        return birthdate.toLocaleDateString("en-GB");
    }
    if (birthdate && typeof birthdate === "object" && "toDate" in birthdate && typeof birthdate.toDate === "function") {
        return birthdate.toDate().toLocaleDateString("en-GB");
    }
    return "-";
};

export default function UserManagementPage() {
    const {user} = useAuthContext();
    const isAdmin = user?.roles?.modify_admin || false;

    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedUser, setSelectedUser] = useState<FirestoreUser | null>(null);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [editMode, setEditMode] = useState(false);
    const [editForm] = Form.useForm();

    const loadUsers = async () => {
        setLoading(true);
        try {
            const data = await fetchAllUsers();
            setUsers(data);
        } catch (error) {
            console.error("Failed to load users:", error);
            Message.error("Failed to load users");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) {
            loadUsers();
        }
    }, [isAdmin]);

    const filteredUsers = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        if (!query) return users;
        return users.filter((entry) => {
            const globalId = entry.global_id?.toString().toLowerCase() ?? "";
            const ic = entry.IC?.toLowerCase() ?? "";
            const name = entry.name?.toLowerCase() ?? "";
            const email = entry.email?.toLowerCase() ?? "";
            return globalId.includes(query) || ic.includes(query) || name.includes(query) || email.includes(query);
        });
    }, [users, searchTerm]);

    const handleViewDetail = (entry: FirestoreUser) => {
        setSelectedUser(entry);
        setDetailModalVisible(true);
        setEditMode(false);
        editForm.setFieldsValue({
            name: entry.name ?? "",
            phone_number: entry.phone_number ?? "",
            school: entry.school ?? "",
            gender: entry.gender ?? undefined,
        });
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
            setLoading(true);
            await updateUserProfile(selectedUser.id, {
                name: values.name,
                phone_number: values.phone_number,
                school: values.school,
                gender: values.gender,
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
            title: "Action",
            width: 140,
            render: (_, record) => (
                <Button type="primary" size="small" onClick={() => handleViewDetail(record)}>
                    View Detail
                </Button>
            ),
        },
    ];

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
                                    <div>{formatBirthdate(selectedUser.birthdate)}</div>
                                </div>
                                <div>
                                    <Text type="secondary">Country / State</Text>
                                    <div>
                                        {Array.isArray(selectedUser.country)
                                            ? selectedUser.country.join(" / ")
                                            : (selectedUser.country ?? "-")}
                                    </div>
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
                                {selectedUser.roles &&
                                    Object.entries(selectedUser.roles)
                                        .filter(([, enabled]) => Boolean(enabled))
                                        .map(([role]) => (
                                            <Tag key={role} color="blue">
                                                {role.replace(/_/g, " ")}
                                            </Tag>
                                        ))}
                                {selectedUser.memberId && <Tag color="green">memberId: {selectedUser.memberId}</Tag>}
                                {!selectedUser.memberId &&
                                    (!selectedUser.roles || Object.values(selectedUser.roles).every((value) => !value)) && (
                                        <Text>-</Text>
                                    )}
                            </div>
                        </div>
                    </div>
                ) : null}
            </Modal>
        </div>
    );
}
