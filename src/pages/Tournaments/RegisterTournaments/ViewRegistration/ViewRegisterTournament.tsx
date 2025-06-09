// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import {fetchUserRegistration, updateRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {Button, Form, Input, InputNumber, Message, Result, Select, Typography, Upload} from "@arco-design/web-react";
import {Timestamp} from "firebase/firestore";
import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const Option = Select.Option;

export default function ViewTournamentRegistrationPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();

    const [form] = Form.useForm();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registration, setRegistration] = useState<Registration | null>(null);
    const [loading, setLoading] = useState(true);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);

    useEffect(() => {
        const loadData = async () => {
            if (!tournamentId || !user?.global_id) return;
            setLoading(true);
            try {
                const tournamentData = await fetchTournamentById(tournamentId);
                setTournament(tournamentData);

                const userReg = await fetchUserRegistration(tournamentId, user.id);
                if (!userReg) {
                    Message.error("No registration found for this tournament.");
                    navigate("/tournaments");
                    return;
                }
                setRegistration(userReg);
                setPaymentProofUrl(userReg.payment_proof_url ?? null);

                form.setFieldsValue({
                    user_name: userReg.user_name,
                    id: userReg.user_id,
                    age: userReg.age,
                    events_registered: userReg.events_registered,
                });
            } catch (err) {
                Message.error("Failed to load data.");
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [tournamentId, user]);

    const handleUpdate = async (values: RegistrationForm) => {
        if (!tournamentId || !registration || !user) return;
        setLoading(true);
        try {
            const updatedData: Registration = {
                ...registration,
                events_registered: values.events_registered,
                payment_proof_url: paymentProofUrl,
                updated_at: Timestamp.now(),
            };

            await updateRegistration(user, updatedData);
            Message.success("Registration updated successfully!");
        } catch (err) {
            console.error(err);
            Message.error("Failed to update registration.");
        } finally {
            setLoading(false);
        }
    };

    if (!loading && !registration) {
        return <Result status="404" title="Not Registered" subTitle="You haven't registered for this tournament." />;
    }

    return (
        <div className="bg-white flex flex-col p-6 rounded-lg shadow-lg">
            <Title heading={4}>View / Edit Registration</Title>

            <Form form={form} layout="vertical" onSubmit={handleUpdate}>
                <Form.Item label="ID" field="id">
                    <Input disabled />
                </Form.Item>

                <Form.Item label="Name" field="user_name">
                    <Input disabled />
                </Form.Item>

                <Form.Item label="Age" field="age">
                    <InputNumber disabled />
                </Form.Item>

                <Form.Item label="Selected Events" field="events_registered" rules={[{required: true}]}>
                    <Select mode="multiple">
                        {tournament?.events?.map((event) => {
                            const key = `${event.code}-${event.type}`;
                            return (
                                <Option key={key} value={key}>
                                    {event.code} ({event.type})
                                </Option>
                            );
                        })}
                    </Select>
                </Form.Item>

                <Form.Item label="Payment Proof">
                    <Upload
                        multiple={false}
                        limit={1}
                        fileList={
                            paymentProofUrl
                                ? [
                                      {
                                          uid: "1",
                                          name: "Payment Proof",
                                          url: paymentProofUrl,
                                      },
                                  ]
                                : []
                        }
                        customRequest={async (option) => {
                            const {file, onSuccess, onError, onProgress} = option;
                            try {
                                const url = await uploadFile(
                                    file as File,
                                    `tournaments/${tournamentId}/registrations/payment_proof`,
                                    user?.global_id ?? "",
                                    onProgress,
                                );
                                setPaymentProofUrl(url);
                                onSuccess?.(file);
                            } catch (err) {
                                onError?.(err as Error);
                            }
                        }}
                    />
                </Form.Item>

                <Form.Item>
                    <Button type="primary" htmlType="submit" loading={loading}>
                        Update Registration
                    </Button>
                </Form.Item>
            </Form>
        </div>
    );
}
