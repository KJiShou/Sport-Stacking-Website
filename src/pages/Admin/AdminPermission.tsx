import {Button, Form, Input, Message, Modal, Spin, Switch, Table, type TableColumnProps, Tag} from "@arco-design/web-react";
import {useEffect, useState} from "react";
import type {FirestoreUser} from "../../schema";
import {fetchAllUsers, updateUserProfile, updateUserRoles} from "../../services/firebase/authService";
import {useDeviceBreakpoint} from "../../utils/DeviceInspector";
import {DeviceBreakpoint} from "../../utils/DeviceInspector/deviceStore";

type RoleFields = {
    memberId: string;
    edit_tournament: boolean;
    record_tournament: boolean;
    modify_admin: boolean;
    verify_record: boolean;
};

export default function AdminPermissionsPage() {
    const [users, setUsers] = useState<FirestoreUser[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchText, setSearchText] = useState("");
    const [filtered, setFiltered] = useState<FirestoreUser[]>([]);

    const [modalVisible, setModalVisible] = useState(false);
    const [selected, setSelected] = useState<FirestoreUser | null>(null);

    const [form] = Form.useForm<RoleFields>();
    const deviceBreakpoint = useDeviceBreakpoint();

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
        deviceBreakpoint > DeviceBreakpoint.md && {
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
                <Tag color={record.roles ? "red" : "blue"}>{record.roles ? "Admin" : "User"}</Tag>
            ),
            sorter: (a, b) => {
                const aIsAdmin = !!a.roles;
                const bIsAdmin = !!b.roles;
                return Number(bIsAdmin) - Number(aIsAdmin);
            },
        },
        {
            title: "Actions",
            dataIndex: "id",
            width: 120,
            render: (_: string, record: FirestoreUser) => (
                <Button
                    size="small"
                    type="primary"
                    onClick={() => {
                        setSelected(record);
                        form.setFieldsValue(
                            record.roles ?? {
                                edit_tournament: false,
                                record_tournament: false,
                                modify_admin: false,
                                verify_record: false,
                            },
                        );
                        setModalVisible(true);
                    }}
                >
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
        if (!text) return setFiltered(users);
        setFiltered(users.filter((u) => u.global_id?.toLowerCase().includes(text) || u.name.toLowerCase().includes(text)));
    }, [searchText, users]);

    // 4) handle save in modal
    const handleSave = async () => {
        try {
            const values = await form.validate();
            if (!selected) return;
            await updateUserRoles(selected.id, values as FirestoreUser["roles"]);
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
        <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 w-full`}>
            <Spin loading={loading} tip="Loading…" className={"w-full h-full"}>
                <div
                    className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                >
                    <div className="p-6 space-y-4">
                        {/* Search bar */}
                        <Input.Search
                            placeholder="Search by ID or name"
                            allowClear
                            onClear={() => setSearchText("")}
                            onSearch={(val) => setSearchText(val)}
                            style={{maxWidth: 300}}
                        />

                        {/* Users table */}
                        <Table
                            rowKey="id"
                            data={filtered}
                            columns={columns.filter((e): e is TableColumnProps<FirestoreUser> => !!e)}
                            pagination={{pageSize: 10}}
                            pagePosition="bottomCenter"
                        />

                        {/* Edit Permissions Modal */}
                        <Modal
                            className={"md:w-[80%]"}
                            title={`Edit Permissions for ${selected?.name}`}
                            visible={modalVisible}
                            onCancel={() => setModalVisible(false)}
                            onOk={handleSave}
                        >
                            <Form
                                form={form}
                                labelAlign="left"
                                layout="horizontal"
                                initialValues={
                                    selected?.roles ?? {
                                        edit_tournament: false,
                                        record_tournament: false,
                                        modify_admin: false,
                                        verify_record: false,
                                    }
                                }
                            >
                                <Form.Item field="memberId" label="Member ID">
                                    <Input />
                                </Form.Item>
                                <Form.Item
                                    field="edit_tournament"
                                    label="Edit Tournament"
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>

                                <Form.Item
                                    field="record_tournament"
                                    label="Record Tournament"
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>

                                <Form.Item field="modify_admin" label="Modify Admin" trigger="onChange" triggerPropName="checked">
                                    <Switch />
                                </Form.Item>

                                <Form.Item
                                    field="verify_record"
                                    label="Verify Record"
                                    trigger="onChange"
                                    triggerPropName="checked"
                                >
                                    <Switch />
                                </Form.Item>
                            </Form>
                        </Modal>
                    </div>
                </div>
            </Spin>
        </div>
    );
}
