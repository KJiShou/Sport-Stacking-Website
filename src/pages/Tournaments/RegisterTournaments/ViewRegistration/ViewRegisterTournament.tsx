// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {Team} from "@/schema/TeamSchema";
import {fetchUserRegistration, updateRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {fetchTeamsByTournament, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {
    Button,
    Checkbox,
    Divider,
    Form,
    Input,
    InputNumber,
    Message,
    Result,
    Select,
    Spin,
    Tooltip,
    Typography,
    Upload,
} from "@arco-design/web-react";
import {IconExclamationCircle, IconUndo} from "@arco-design/web-react/icon";
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
    const [teams, setTeams] = useState<Team[]>([]);
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

                const teamsData = await fetchTeamsByTournament(tournamentId);
                setTeams(
                    teamsData.filter(
                        (team) => team.leader_id === user.global_id || team.members.some((m) => m.global_id === user.global_id),
                    ),
                );
                setPaymentProofUrl(userReg.payment_proof_url ?? null);

                form.setFieldsValue({
                    user_name: userReg.user_name,
                    id: userReg.user_id,
                    age: userReg.age,
                    phone_number: userReg.phone_number,
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

    if (!loading && !registration) {
        return <Result status="404" title="Not Registered" subTitle="You haven't registered for this tournament." />;
    }

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <Spin loading={loading} tip="Loading…" className={"w-full h-full"}>
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                    <Title heading={4}>View Registration</Title>

                    <Form form={form} layout="vertical">
                        <Form.Item label="ID" field="id">
                            <Input disabled />
                        </Form.Item>

                        <Form.Item label="Name" field="user_name">
                            <Input disabled />
                        </Form.Item>

                        <Form.Item label="Age" field="age">
                            <InputNumber disabled />
                        </Form.Item>

                        <Form.Item disabled label="Phone Number" field="phone_number">
                            <InputNumber disabled />
                        </Form.Item>

                        <Form.Item label="Selected Events" field="events_registered" rules={[{required: true}]}>
                            <Select mode="multiple" disabled>
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

                        <Form.Item shouldUpdate noStyle>
                            <div className={`flex flex-row w-full gap-10`}>
                                {teams.map((team) => (
                                    <div key={team.id}>
                                        <div className={`text-center font-semibold mb-2`}>{team.name}</div>
                                        <Divider />
                                        <Form.Item label="Team Events">
                                            <Input value={team.events.join(", ")} disabled />
                                        </Form.Item>
                                        <Form.Item label="Team Leader">
                                            <Input value={team.leader_id} disabled />
                                        </Form.Item>
                                        <Form.Item label="Team Members">
                                            <div className="flex flex-col gap-2">
                                                {team.members.map((m) => (
                                                    <Button key={m.global_id} status={m.verified ? "success" : "danger"} disabled>
                                                        {m.global_id ?? "N/A"}
                                                    </Button>
                                                ))}
                                            </div>
                                        </Form.Item>
                                    </div>
                                ))}
                            </div>
                        </Form.Item>

                        <Form.Item label="Payment Proof">
                            <Upload
                                disabled
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
                    </Form>
                </div>
            </Spin>
        </div>
    );
}
