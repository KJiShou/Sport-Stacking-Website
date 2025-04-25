import {
    Avatar,
    Card,
    Spin,
    Statistic,
    Table,
    Typography,
    Button,
    Select,
    Form,
    Upload,
    Tabs,
    Input,
    Cascader,
    Message,
    DatePicker,
} from "@arco-design/web-react";
import { IconCamera, IconUser } from "@arco-design/web-react/icon";
import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import type { FirestoreUser } from "../../../schema";
import { changeUserPassword, fetchUserByID, updateUserProfile } from "../../../services/firebase/authService";
import TabPane from "@arco-design/web-react/es/Tabs/tab-pane";
import { AvatarUploader } from "../../../components/common/AvatarUploader";
import { countries } from "../../../schema/Country";
import dayjs from "dayjs";
import { useAuthContext } from "../../../context/AuthContext";

const { Title, Text } = Typography;

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
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [isEditMode, setIsEditMode] = useState(false);
    const [form] = Form.useForm();
    const [secForm] = Form.useForm();
    const [isImageLoading, setIsImageLoading] = useState(true);
    const [secLoading, setSecLoading] = useState(false);
    const { user: authUser } = useAuthContext();

    useEffect(() => {
        if (authUser?.id !== id) {
            navigate("/");
        }
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
                    country: [data?.country ?? "", data?.state ?? ""],
                    organizer: data?.organizer ?? "",
                    gender: data?.gender,
                    birthdate: data?.birthdate,
                });
            } catch (err) {
                console.error(err);
                setUser(null);
            } finally {
                setLoading(false);
            }
        })();
    }, [id]);

    // 构建统计数据示例
    const allTimeStats: AllTimeStat[] = [
        { event: "all-around", time: user?.best_times?.["all-around"] ?? 0, rank: "-" },
        // TODO: 按需添加其他项目并计算排名
    ];
    const onlineBest: OnlineBest[] = [];
    const records: RecordItem[] = [];

    const handleSubmit = async (values: {
        name: string;
        country: [country: string, state: string];
        organizer: string;
    }) => {
        setLoading(true);
        try {
            if (!id) return;
            await updateUserProfile(id, {
                name: values.name,
                country: values.country[0],
                state: values.country[1],
                organizer: values.organizer,
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

    const handleSecuritySubmit = async (values: { currentPassword: string, newPassword: string, confirmPassword: string }) => {
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
        <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10`}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                {loading && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                        <Spin tip="Loading..." size={40} />
                    </div>
                )}
                {isEditMode ? (
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

                                    <Form.Item label="IC" field="IC">
                                        <Input disabled />
                                    </Form.Item>

                                    <Form.Item
                                        label="Name"
                                        field="name"
                                        rules={[{ required: true, message: "Please enter your name" }]}
                                    >
                                        <Input placeholder="Please enter your name" />
                                    </Form.Item>

                                    <Form.Item
                                        field="birthdate"
                                        label="Birthdate"
                                        rules={[{ required: true, message: "Select your birthdate" }]}
                                    >
                                        <DatePicker
                                            style={{ width: "100%" }}
                                            disabledDate={(current) => current.isAfter(dayjs())}
                                        />
                                    </Form.Item>

                                    <Form.Item field="gender" label="Gender" rules={[{ required: true, message: "Select gender" }]}>
                                        <Select placeholder="Select gender" options={["Male", "Female"]} />
                                    </Form.Item>

                                    <Form.Item
                                        label="Country / State"
                                        field="country"
                                        rules={[{ required: true, message: "Please select a country/region" }]}
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
                                            value={[user?.country ?? "", user?.state ?? ""]}
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        label="Organizer"
                                        field="organizer"
                                        rules={[{ required: false, message: "Please enter your organizer" }]}
                                    >
                                        <Input placeholder="Please enter your organizer" />
                                    </Form.Item>

                                    <div className="w-full mx-auto flex flex-col items-center">
                                        <Button type="primary" long onClick={() => form.submit()}>
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
                                                        country: [data?.country ?? "", data?.state ?? ""],
                                                        organizer: data?.organizer ?? "",
                                                        gender: data?.gender,
                                                        birthdate: data?.birthdate,
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
                                        rules={[{ required: true, message: "Enter current password" }]}
                                    >
                                        <Input.Password placeholder="Current Password" />
                                    </Form.Item>
                                    <Form.Item
                                        label="New Password"
                                        field="newPassword"
                                        rules={[{ required: true, message: "Enter new password" }]}
                                    >
                                        <Input.Password placeholder="New Password" />
                                    </Form.Item>
                                    <Form.Item
                                        label="Confirm Password"
                                        field="confirmPassword"
                                        rules={[{ required: true, message: "Confirm new password" }]}
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
                ) : (
                    <div className="max-w-2xl mx-auto space-y-6">
                        {/* 基本信息卡片 */}
                        <Card className="text-center">
                            <Avatar className="mx-auto w-24 h-24 rounded-full overflow-hidden relative">
                                {isImageLoading && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
                                        <Spin size={24} />
                                    </div>
                                )}
                                <img
                                    src={user?.image_url}
                                    alt={user?.name}
                                    onLoad={() => setIsImageLoading(false)}
                                    onError={() => setIsImageLoading(false)}
                                    className={`w-full h-full object-cover transition-opacity duration-300 ${isImageLoading ? "opacity-0" : "opacity-100"
                                        }`}
                                />
                            </Avatar>
                            <Title heading={4} className="mt-4">
                                {user?.name}
                            </Title>
                            <Text className="flex items-center justify-center gap-1">
                                <IconUser /> {user?.global_id}
                            </Text>
                            <Text className="block mt-1 text-sm text-gray-600">
                                {user?.country} / {user?.state}
                            </Text>
                            <Text className="block mt-1 text-sm text-gray-600">{user?.organizer}</Text>
                        </Card>
                        <Button className={`w-full`} type={`primary`} onClick={() => setIsEditMode(true)}>
                            Edit Profile
                        </Button>

                        {/* 最佳成绩 */}
                        <Card>
                            <Statistic
                                title="All-around Best Time"
                                value={user?.best_times?.["all-around"]?.toFixed(3) ?? "-"}
                                suffix="sec"
                            />
                        </Card>

                        {/* 全时统计表 */}
                        <Card title="All Time Statistics">
                            <Table
                                data={allTimeStats}
                                columns={[
                                    { title: "Event", dataIndex: "event" },
                                    {
                                        title: "Time (sec)",
                                        dataIndex: "time",
                                        render: (val) => val.toFixed(3),
                                    },
                                    { title: "Rank", dataIndex: "rank" },
                                ]}
                                pagination={false}
                            />
                        </Card>
                    </div>
                )}
            </div>
        </div>
    );
}
