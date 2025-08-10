import {AvatarUploader} from "@/components/common/AvatarUploader";
import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, FirestoreUserSchema} from "@/schema";
import {countries} from "@/schema/Country";
import {changeUserPassword, deleteAccount, fetchUserByID, updateUserProfile} from "@/services/firebase/authService";
import {
    Avatar,
    Button,
    Cascader,
    DatePicker,
    Descriptions,
    Form,
    Grid,
    Input,
    Message,
    Modal,
    Select,
    Spin,
    Statistic,
    Switch,
    Table,
    Tabs,
    Typography,
} from "@arco-design/web-react";
import TabPane from "@arco-design/web-react/es/Tabs/tab-pane";
import {IconPhone, IconUser} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";
import {useEffect, useState} from "react";
import {useNavigate, useParams, useSearchParams} from "react-router-dom";
import type {z} from "zod";

const {Title, Text} = Typography;

interface AllTimeStat {
    event: string;
    time: number;
    rank: string;
}
interface OnlineBest {
    event: string;
    time: number;
}
interface RecordItem {
    event: string;
    time: number;
    date: string;
}

export default function RegisterPage() {
    const {Row, Col} = Grid;
    const {id} = useParams<{id: string}>();
    const {user: authUser} = useAuthContext();
    const navigate = useNavigate();
    const [form] = Form.useForm();
    const [secForm] = Form.useForm();
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [isEditMode, setIsEditMode] = useState(false);
    const [isImageLoading, setIsImageLoading] = useState(true);
    const [secLoading, setSecLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [searchParams, setSearchParams] = useSearchParams();

    function confirm() {
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

    let descData = [
        {label: "Email", value: user?.email ?? "-"},
        {label: "Member ID", value: user?.memberId ?? "-"},
        {label: "IC", value: user?.IC ?? "-"},
        {label: "Country / State", value: `${user?.country[0]} / ${user?.country[1]}`},
        {label: "Phone Number", value: user?.phone_number ?? "-"},
        {label: "School/University/College", value: user?.school ?? "-"},
        {
            label: "Birthdate",
            value: user?.birthdate
                ? dayjs(user.birthdate instanceof Timestamp ? user.birthdate.toDate() : user.birthdate).format("YYYY-MM-DD")
                : "-",
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
        if (authUser?.id !== id) {
            navigate("/");
        }
        setIsEditMode(searchParams.get("isEditMode") === "true");
    }, []);

    useEffect(() => {
        if (!id) {
            setLoading(false);
            return;
        }

        setLoading(true);

        (async () => {
            try {
                const data = await fetchUserByID(id);
                setUser(data ?? null);
                form.setFieldsValue({
                    email: data?.email,
                    IC: data?.IC,
                    name: data?.name,
                    country: data?.country,
                    school: data?.school ?? "",
                    gender: data?.gender,
                    birthdate: data?.birthdate,
                    phone_number: data?.phone_number ?? "-",
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
                        value: data?.birthdate
                            ? dayjs(data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate).format(
                                  "YYYY-MM-DD",
                              )
                            : "-",
                        span: 2,
                    },
                ];
            } catch (err) {
                console.error(err);
                setUser(null);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    // 构建统计数据示例
    const allTimeStats: AllTimeStat[] = [{event: "all-around", time: user?.best_times?.["all-around"] ?? 0, rank: "-"}];
    const onlineBest: OnlineBest[] = [];
    const records: RecordItem[] = [];

    const handleSubmit = async (values: {
        name: string;
        country: [country: string, state: string];
        school: string;
        phone_number: string;
    }) => {
        setLoading(true);
        try {
            if (!id) return;
            await updateUserProfile(id, {
                name: values.name,
                country: values.country,
                school: values.school,
                phone_number: values.phone_number,
            });
            Message.success("Profile updated successfully");
        } catch (err) {
            console.error(err);
            Message.error("Failed to update profile");
        } finally {
            setLoading(false);
            setIsEditMode(false);
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
            changeUserPassword(values.currentPassword, values.newPassword);
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

    return (
        <div className="h-full w-full">
            <Spin tip="Loading..." size={40} loading={loading} className="h-full w-full">
                {isEditMode ? (
                    <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10`}>
                        <div
                            className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                        >
                            <div className={`w-full `}>
                                {user && <AvatarUploader user={user} setUser={setUser} />}
                                <div>
                                    <Title heading={4}>{user?.name}</Title>
                                    <Text type="secondary">Account ID: {user?.global_id}</Text>
                                </div>

                                <Tabs defaultActiveTab="basic" className="mt-6">
                                    <TabPane title="Basic Information" key="basic">
                                        <Form
                                            requiredSymbol={false}
                                            className={`flex flex-col items-start`}
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
                                                    expandTrigger="hover"
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

                                            <div className="w-full mx-auto flex flex-col items-center">
                                                <Button
                                                    type="primary"
                                                    long
                                                    onClick={() => {
                                                        form.submit();
                                                        setSearchParams({isEditMode: "false"});
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
                                                            form.setFieldsValue({
                                                                email: data?.email,
                                                                IC: data?.IC,
                                                                name: data?.name,
                                                                country: data?.country,
                                                                memberId: data?.memberId,
                                                                school: data?.school ?? "",
                                                                gender: data?.gender,
                                                                birthdate: data?.birthdate,
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
                                        </Form>
                                    </TabPane>

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
                                </Tabs>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col md:flex-row h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
                        {/* 左边：基本信息卡片 */}
                        <div className="bg-white flex flex-col w-full md:w-1/3 h-full gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                            <Avatar className="mx-auto w-48 h-48 rounded-full overflow-hidden relative">
                                {isImageLoading && <Spin size={24} />}
                                <img
                                    src={user?.image_url}
                                    alt={user?.name}
                                    onLoad={() => setIsImageLoading(false)}
                                    onError={() => setIsImageLoading(false)}
                                    className={`w-full h-full object-cover transition-opacity duration-300 ${isImageLoading ? "opacity-0" : "opacity-100"}`}
                                />
                            </Avatar>
                            <Text className="flex items-center justify-center gap-1 text-4xl font-bold mt-2">{user?.name}</Text>
                            <Text className="flex items-center justify-center gap-1">
                                <IconUser /> {user?.global_id}
                            </Text>
                            <Descriptions className={"w-full h-full py-8 px-4"} border column={1} data={descData} />
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
                            <Button className="w-full" type="outline" status="danger" onClick={confirm}>
                                Delete Account
                            </Button>
                        </div>

                        {/* 右边：包一层，让它整体高度统一 */}
                        {!user?.roles ? (
                            <div className="flex flex-col w-full md:w-2/3 h-full gap-6">
                                <div className="flex flex-col h-full gap-6">
                                    {/* 最佳成绩卡片 */}
                                    <div className="bg-white flex flex-col w-full h-1/2 gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                        <Statistic
                                            title="All-around Best Time"
                                            value={user?.best_times?.["all-around"]?.toFixed(3) ?? "-"}
                                            suffix="sec"
                                        />
                                    </div>

                                    {/* 全时统计表卡片 */}
                                    <div className="bg-white flex flex-col w-full flex-1 gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                        <Title>All Time Statistics</Title>
                                        <Table
                                            data={allTimeStats}
                                            columns={[
                                                {title: "Event", dataIndex: "event"},
                                                {
                                                    title: "Time (sec)",
                                                    dataIndex: "time",
                                                    render: (val) => val.toFixed(3),
                                                },
                                                {title: "Rank", dataIndex: "rank"},
                                            ]}
                                            pagination={false}
                                        />
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white flex flex-col w-full flex-1 gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                                <Row gutter={[16, 16]}>
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
                )}
            </Spin>
        </div>
    );
}
