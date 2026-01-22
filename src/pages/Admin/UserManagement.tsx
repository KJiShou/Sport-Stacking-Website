import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser} from "@/schema";
import {deleteUserProfileAdmin, fetchAllUsers} from "@/services/firebase/authService";
import {Button, Input, Message, Modal, Spin, Table, Tag, Typography} from "@arco-design/web-react";
import type {TableColumnProps} from "@arco-design/web-react";
import {IconSearch} from "@arco-design/web-react/icon";
import {useEffect, useMemo, useState} from "react";

const {Title, Paragraph, Text} = Typography;

export default function UserManagementPage() {
    const {user} = useAuthContext();
    const isAdmin = user?.roles?.modify_admin || false;

    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedUser, setSelectedUser] = useState<FirestoreUser | null>(null);
    const [detailModalVisible, setDetailModalVisible] = useState(false);

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
                }}
                footer={
                    <div className="flex justify-between items-center w-full">
                        <Button onClick={() => setDetailModalVisible(false)}>Close</Button>
                        <Button status="danger" onClick={handleDelete}>
                            Delete Account
                        </Button>
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
                            <Text type="secondary">Name</Text>
                            <div>{selectedUser.name ?? "-"}</div>
                        </div>
                        <div>
                            <Text type="secondary">Email</Text>
                            <div>{selectedUser.email ?? "-"}</div>
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
                            <div>
                                {selectedUser.birthdate instanceof Date
                                    ? selectedUser.birthdate.toLocaleDateString()
                                    : (selectedUser.birthdate ?? "-")}
                            </div>
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
                        <div>
                            <Text type="secondary">Roles</Text>
                            <div className="flex flex-wrap gap-2">
                                {selectedUser.roles ? (
                                    Object.entries(selectedUser.roles)
                                        .filter(([, enabled]) => Boolean(enabled))
                                        .map(([role]) => (
                                            <Tag key={role} color="blue">
                                                {role.replace(/_/g, " ")}
                                            </Tag>
                                        ))
                                ) : (
                                    <Text>-</Text>
                                )}
                                {selectedUser.roles && Object.values(selectedUser.roles).every((value) => !value) && (
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
