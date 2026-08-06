import {Button, Form, Input, Message, Pagination, Spin, Switch, Table, type TableColumnProps, Tag} from "@arco-design/web-react";
import {MobilePageHeader, ResponsiveOverlay} from "../../components/responsive";
import {useEffect, useState} from "react";
import type {FirestoreUser} from "../../schema";
import {fetchAllUsers, updateUserProfile, updateUserRoles} from "../../services/firebase/authService";

type RoleFields = {
    memberId: string;
    edit_tournament: boolean;
    record_tournament: boolean;
    modify_admin: boolean;
    verify_record: boolean;
};

const hasAnyRole = (roles: FirestoreUser["roles"] | null | undefined): boolean =>
    Boolean(roles?.edit_tournament || roles?.record_tournament || roles?.modify_admin || roles?.verify_record);

export default function AdminPermissionsPage() {
    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [filtered, setFiltered] = useState<FirestoreUser[]>([]);
    const [mobilePage, setMobilePage] = useState(1);
    const MOBILE_PAGE_SIZE = 10;

    const [modalVisible, setModalVisible] = useState(false);
    const [selected, setSelected] = useState<FirestoreUser | null>(null);

    const [form] = Form.useForm<RoleFields>();

    const handleOpenPermissionEditor = (record: FirestoreUser) => {
        setSelected(record);
        form.setFieldsValue({
            edit_tournament: record.roles?.edit_tournament ?? false,
            record_tournament: record.roles?.record_tournament ?? false,
            modify_admin: record.roles?.modify_admin ?? false,
            verify_record: record.roles?.verify_record ?? false,
            memberId: record.memberId ?? "",
        });
        setModalVisible(true);
    };

    // 3) table columns
    const columns: (TableColumnProps<(typeof users)[number]> | false)[] = [
        {
            title: "Account ID",
            dataIndex: "global_id",
            width: 180,
            sorter: (a, b) => (a.global_id ?? "").localeCompare(b.global_id ?? ""),
            defaultSortOrder: "ascend",
        },
        {
            title: "Name",
            dataIndex: "name",
            width: 200,
            sorter: (a, b) => a.name.length - b.name.length,
        },
        {
            title: "Member ID",
            dataIndex: "memberId",
            width: 160,
            render: (_: string, record: FirestoreUser) => record.memberId || "-",
            sorter: (a, b) => (a.memberId ?? "").localeCompare(b.memberId ?? ""),
        },
        {
            title: "Email",
            dataIndex: "email",
            width: 300,
            sorter: (a, b) => (a.email ?? "").localeCompare(b.email ?? ""),
        },
        {
            title: "Roles",
            dataIndex: "is_admin",
            width: 100,
            render: (_: string, record: FirestoreUser) => (
                <Tag color={hasAnyRole(record.roles) ? "red" : "blue"}>{hasAnyRole(record.roles) ? "Admin" : "User"}</Tag>
            ),
            sorter: (a, b) => {
                const aIsAdmin = hasAnyRole(a.roles);
                const bIsAdmin = hasAnyRole(b.roles);
                return Number(bIsAdmin) - Number(aIsAdmin);
            },
        },
        {
            title: "Actions",
            dataIndex: "id",
            width: 120,
            render: (_: string, record: FirestoreUser) => (
                <Button size="small" type="primary" onClick={() => handleOpenPermissionEditor(record)}>
                    Edit
                </Button>
            ),
        },
    ];

    // 1) load all users
    const load = async () => {
        setLoading(true);
        try {
            const all = await fetchAllUsers();
            setUsers(all);
            setFiltered(all);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, []);

    // 2) filter when searchText changes
    useEffect(() => {
        const text = searchText.trim().toLowerCase();
        if (!text) {
            setMobilePage(1);
            return setFiltered(users);
        }
        setFiltered(users.filter((u) => u.global_id?.toLowerCase().includes(text) || u.name.toLowerCase().includes(text)));
        setMobilePage(1);
    }, [searchText, users]);

    // 4) handle save in modal
    const handleSave = async () => {
        try {
            const values = await form.validate();
            if (!selected) return;
            const rolesPayload: FirestoreUser["roles"] = {
                edit_tournament: values.edit_tournament,
                record_tournament: values.record_tournament,
                modify_admin: values.modify_admin,
                verify_record: values.verify_record,
            };
            await updateUserRoles(selected.id, rolesPayload);
            await updateUserProfile(selected.id, {memberId: values.memberId});
            Message.success("Permissions updated");
            setModalVisible(false);
            load(); // refresh table
        } catch (e) {
            console.error(e);
            Message.error("Failed to update permissions");
        }
    };

    return (
        <div className={`admin-page admin-permissions-page flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10 w-full`}>
            <Spin loading={loading} tip="Loading…" className={"w-full"}>
                <div
                    className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                >
                    <div className="p-6 space-y-4">
                        <MobilePageHeader title="Admin Permissions" />
                        {/* Search bar */}
                        <Input.Search
                            placeholder="Search by ID or name"
                            allowClear
                            onClear={() => setSearchText("")}
                            onSearch={(val) => setSearchText(val)}
                            style={{maxWidth: 300}}
                        />

                        {/* Users table */}
                        <div className="admin-table-scroll">
                            <Table
                                rowKey="id"
                                data={filtered}
                                columns={columns.filter((e): e is TableColumnProps<FirestoreUser> => !!e)}
                                pagination={{pageSize: 10}}
                                pagePosition="bottomCenter"
                            />
                        </div>
                        <div className="permission-mobile-cards">
                            {filtered.slice((mobilePage - 1) * MOBILE_PAGE_SIZE, mobilePage * MOBILE_PAGE_SIZE).map((record) => (
                                <div key={record.id} className="admin-mobile-card">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-semibold break-words">{record.name}</div>
                                            <div className="text-sm text-gray-500 break-words">{record.global_id || "—"}</div>
                                        </div>
                                        <Tag color={hasAnyRole(record.roles) ? "red" : "blue"}>
                                            {hasAnyRole(record.roles) ? "Admin" : "User"}
                                        </Tag>
                                    </div>
                                    <Button
                                        type="primary"
                                        className="mobile-full-width-button mt-3"
                                        onClick={() => handleOpenPermissionEditor(record)}
                                    >
                                        Edit Permissions
                                    </Button>
                                </div>
                            ))}
                            {filtered.length > MOBILE_PAGE_SIZE ? (
                                <Pagination
                                    current={mobilePage}
                                    pageSize={MOBILE_PAGE_SIZE}
                                    total={filtered.length}
                                    onChange={setMobilePage}
                                />
                            ) : null}
                        </div>

                        {/* Edit Permissions Modal */}
                        <ResponsiveOverlay
                            className={"admin-responsive-modal md:w-[80%]"}
                            title={`Edit Permissions for ${selected?.name}`}
                            visible={modalVisible}
                            onCancel={() => setModalVisible(false)}
                            mobileMode="fullscreen"
                            footer={[
                                <Button key="cancel" onClick={() => setModalVisible(false)}>
                                    Cancel
                                </Button>,
                                <Button key="save" type="primary" onClick={handleSave}>
                                    Save
                                </Button>,
                            ]}
                        >
                            <Form
                                form={form}
                                labelAlign="left"
                                layout="horizontal"
                                initialValues={
                                    selected?.roles
                                        ? {
                                              edit_tournament: selected.roles.edit_tournament ?? false,
                                              record_tournament: selected.roles.record_tournament ?? false,
                                              modify_admin: selected.roles.modify_admin ?? false,
                                              verify_record: selected.roles.verify_record ?? false,
                                              memberId: selected?.memberId ?? "",
                                          }
                                        : {
                                              edit_tournament: false,
                                              record_tournament: false,
                                              modify_admin: false,
                                              verify_record: false,
                                              memberId: selected?.memberId ?? "",
                                          }
                                }
                            >
                                <Form.Item field="memberId" label="Member ID">
                                    <Input />
                                </Form.Item>
                                <Form.Item
                                    field="edit_tournament"
                                    label="Edit Tournament"
                                    extra="Create, edit, and maintain tournament setup."
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>

                                <Form.Item
                                    field="record_tournament"
                                    label="Record Tournament"
                                    extra="Enter and update competition scores."
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>

                                <Form.Item
                                    field="modify_admin"
                                    label="Modify Admin"
                                    extra="Manage users, permissions, and administrative data."
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>

                                <Form.Item
                                    field="verify_record"
                                    label="Verify Record"
                                    extra="Review and verify submitted records."
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>
                            </Form>
                        </ResponsiveOverlay>
                    </div>
                </div>
            </Spin>
        </div>
    );
}
