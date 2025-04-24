import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
    Avatar,
    Button,
    Card,
    Form,
    Input,
    Select,
    Cascader,
    Upload,
    Tabs,
    Spin,
    Typography,
    Message,
} from '@arco-design/web-react';
import { IconCamera } from '@arco-design/web-react/icon';
import { fetchUserByID, updateUserProfile } from '../../../services/firebase/authService';
import type { FirestoreUser } from '../../../schema';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

export default function EditProfilePage() {
    const { id } = useParams<{ id: string }>();
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [form] = Form.useForm();

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        fetchUserByID(id)
            .then((data) => {
                if (!data) return;
                setUser(data);
                form.setFieldsValue({
                    email: data.email,
                    IC: data.IC,
                    nickname: data.name,
                    country: data.country,
                    location: [data.country, data.state],
                    address: data.organizer ?? '',
                    profile: '',
                });
            })
            .catch(console.error)
            .finally(() => setLoading(false));
    }, [id]);

    const handleSubmit = async (values: any) => {
        if (!user) return;
        setLoading(true);
        try {
            await updateUserProfile(id!, {
                name: values.nickname,
                country: values.country,
                state: values.location[1],
                organizer: values.address,
                // other profile updates
            });
            Message.success('Profile updated successfully');
        } catch (err) {
            console.error(err);
            Message.error('Failed to update profile');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-screen">
                <Spin tip="Loading..." />
            </div>
        );
    }

    return (
        <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10`}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Card className="flex items-center space-x-6 p-8 ">
                    <Avatar size={100} className="mx-auto w-24 h-24 rounded-full overflow-hidden">
                        <img className={`w-full h-full object-cover`} src={user?.image_url} alt={user?.name} />
                        <Upload
                            className="absolute bottom-0 right-0"
                            showUploadList={false}
                            action="/api/upload-avatar"
                            onChange={() => Message.success('Avatar uploaded')}
                        >
                            <IconCamera className="bg-white rounded-full p-1 text-2xl cursor-pointer" />
                        </Upload>
                    </Avatar>
                    <div>
                        <Title heading={4}>{user?.name}</Title>
                        <Text type="secondary">Account ID: {user?.global_id}</Text>
                    </div>

                    <Tabs defaultActiveTab="basic" className="mt-6">
                        <TabPane title="Basic Information" key="basic">
                            <Form
                                form={form}
                                labelCol={{ span: 5 }}
                                wrapperCol={{ span: 16 }}
                                onSubmit={handleSubmit}
                                autoComplete="off"
                            >
                                <Form.Item label="* Email" field="email">
                                    <Input disabled />
                                </Form.Item>

                                <Form.Item label="* IC" field="IC">
                                    <Input disabled />
                                </Form.Item>

                                <Form.Item
                                    label="* Nick name"
                                    field="nickname"
                                    rules={[{ required: true, message: 'Please enter your nickname' }]}
                                >
                                    <Input placeholder="Please enter your nickname" />
                                </Form.Item>

                                <Form.Item
                                    label="* Country / Region"
                                    field="country"
                                    rules={[{ required: true, message: 'Please select a country/region' }]}
                                >
                                    <Select placeholder="Please select a country/region">
                                        {/* TODO: populate options dynamically */}
                                        <Select.Option value="Malaysia">Malaysia</Select.Option>
                                        <Select.Option value="China">China</Select.Option>
                                        <Select.Option value="USA">USA</Select.Option>
                                    </Select>
                                </Form.Item>

                                <Form.Item
                                    label="* Your location"
                                    field="location"
                                    rules={[{ required: true, message: 'Please select your location' }]}
                                >
                                    <Cascader
                                        options={[] /* TODO: fill province-city-district data */}
                                        placeholder="Please select location"
                                    />
                                </Form.Item>

                                <Form.Item label="Specific address" field="address">
                                    <Input placeholder="Please enter your address" />
                                </Form.Item>

                                <Form.Item label="Personal profile" field="profile">
                                    <Input.TextArea placeholder="Please enter your profile, no more than 200 words" rows={4} />
                                </Form.Item>

                                <Form.Item wrapperCol={{ offset: 5, span: 16 }}>
                                    <Button type="primary" long htmlType="submit">
                                        Save
                                    </Button>
                                    <Button className="ml-4" long onClick={() => form.resetFields()}>
                                        Reset
                                    </Button>
                                </Form.Item>
                            </Form>
                        </TabPane>

                        <TabPane title="Security Settings" key="security">
                            {/* TODO: Security Settings form */}
                        </TabPane>

                        <TabPane title="Whether Verified" key="verified">
                            {/* TODO: Verification info */}
                        </TabPane>
                    </Tabs>
                </Card>
            </div>
        </div>
    );
}
