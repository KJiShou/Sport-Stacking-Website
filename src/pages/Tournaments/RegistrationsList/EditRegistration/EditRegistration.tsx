// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {Team} from "@/schema/TeamSchema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {updateUserRegistrationRecord} from "@/services/firebase/authService";
import {fetchRegistrationById, fetchUserRegistration, updateRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {fetchTeamsByTournament, fetchTournamentById, updateTeam} from "@/services/firebase/tournamentsService";
import {
    Button,
    Checkbox,
    Divider,
    Dropdown,
    Form,
    Input,
    InputNumber,
    Message,
    Modal,
    Result,
    Select,
    Spin,
    Tag,
    Tooltip,
    Typography,
    Upload,
} from "@arco-design/web-react";
import type {UploadItem} from "@arco-design/web-react/es/Upload";
import {IconCheck, IconClose, IconDelete, IconExclamationCircle, IconPlus, IconUndo} from "@arco-design/web-react/icon";
import {Timestamp} from "firebase/firestore";
import {nanoid} from "nanoid";
import {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";

const {Title} = Typography;
const Option = Select.Option;
type TeamEntry = [boolean, string];

export default function EditTournamentRegistrationPage() {
    const {tournamentId, registrationId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();

    const [form] = Form.useForm();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registration, setRegistration] = useState<Registration | null>(null);
    const [teams, setTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);
    const [edit, setEdit] = useState<boolean>(false);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | File | null>(null);

    const [isMounted, setIsMounted] = useState<boolean>(false);
    const mountedRef = useRef(false);

    const handleSave = async (values: Registration, rejection_reason = "") => {
        try {
            setEdit(false);
            setLoading(true);

            const paymentProofFile = form.getFieldValue("payment_proof_url");
            let tempPaymentProofUrl = registration?.payment_proof_url ?? "";

            if (paymentProofFile instanceof File) {
                tempPaymentProofUrl = await uploadFile(
                    paymentProofFile,
                    `tournaments/${tournamentId}/registrations/payment_proof`,
                    registration?.user_id,
                );
            }
            setPaymentProofUrl(tempPaymentProofUrl);
            const registrationData: Registration = {
                id: registrationId,
                tournament_id: tournamentId ?? "",
                user_id: registration?.user_id ?? "",
                user_name: values.user_name,
                age: values.age,
                phone_number: values.phone_number ?? "",
                organizer: values?.organizer ?? "",
                events_registered: values?.events_registered ?? [],
                payment_proof_url: tempPaymentProofUrl,
                registration_status: values?.registration_status ?? "pending",
                rejection_reason: values?.registration_status === "rejected" ? rejection_reason : null,
                final_status: registration?.final_status,
                updated_at: Timestamp.now(),
            };
            await updateRegistration(registrationData);

            for (const team of teams) {
                await updateTeam(tournamentId ?? "", team.id, team);
            }

            const userRegistrationData: Partial<UserRegistrationRecord> = {
                status: values?.registration_status ?? "pending",
                tournament_id: tournamentId ?? "",
                events: registration?.events_registered ?? [],
                rejection_reason: values?.registration_status === "rejected" ? rejection_reason : null,
            };

            await updateUserRegistrationRecord(registration?.id ?? "", tournamentId ?? "", userRegistrationData);

            Message.success("Completely save the changes!");
        } catch (err) {
            console.error(err);
            throw err;
        } finally {
            setLoading(false);
        }
    };

    const loadData = async () => {
        if (!tournamentId || !user?.global_id || !registrationId) return;
        setLoading(true);
        try {
            const tournamentData = await fetchTournamentById(tournamentId);
            setTournament(tournamentData);
            if (tournamentData?.editor !== user.global_id && user.roles?.edit_tournament !== true) {
                Message.error("You are not authorized to edit this registration.");
                navigate("/tournaments");
                return;
            }
            const userReg = await fetchRegistrationById(tournamentId, registrationId);
            if (!userReg) {
                Message.error("No registration found for this tournament.");
                navigate("/tournaments");
                return;
            }
            setRegistration(userReg);

            const teamsData = await fetchTeamsByTournament(tournamentId);
            setTeams(teamsData);

            setPaymentProofUrl(userReg.payment_proof_url ?? null);

            form.setFieldsValue({
                user_name: userReg.user_name,
                id: userReg.user_id,
                age: userReg.age,
                phone_number: userReg.phone_number,
                organizer: userReg.organizer,
                events_registered: userReg.events_registered,
                registration_status: userReg.registration_status,
                rejection_reason: userReg.rejection_reason,
            });
        } catch (err) {
            Message.error("Failed to load data.");
        } finally {
            setLoading(false);
        }
    };

    const handleMount = async () => {
        setLoading(true);
        try {
            await loadData();
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;

        handleMount().finally(() => setIsMounted(true));
    });

    if (!isMounted && !loading && !registration) {
        return <Result status="404" title="Not Registered" subTitle="You haven't registered for this tournament." />;
    }

    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Spin loading={loading} tip="Loading…" className={"w-full h-full"}>
                <Button
                    type="outline"
                    onClick={() => navigate(`/tournaments/${tournamentId}/registrations`)}
                    className={`w-fit pt-2 pb-2 mb-4`}
                >
                    <IconUndo /> Go Back
                </Button>
                <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                    <Title heading={4}>Edit Registration</Title>

                    <Form form={form} layout="vertical" onSubmit={handleSave}>
                        <Form.Item className="w-full">
                            {registration?.registration_status && (
                                <div className="flex w-full justify-between gap-4">
                                    <Tag
                                        className={`w-full text-center`}
                                        color={
                                            registration.registration_status === "approved"
                                                ? "green"
                                                : registration.registration_status === "pending"
                                                  ? "blue"
                                                  : "red"
                                        }
                                    >
                                        {registration.registration_status.toUpperCase()}
                                    </Tag>
                                </div>
                            )}
                        </Form.Item>
                        <Form.Item label="ID" field="id">
                            <Input disabled />
                        </Form.Item>

                        <Form.Item label="Name" field="user_name">
                            <Input disabled={!edit} />
                        </Form.Item>

                        <Form.Item label="Age" field="age">
                            <InputNumber disabled={!edit} />
                        </Form.Item>

                        <Form.Item label="Phone Number" field="phone_number">
                            <Input disabled={!edit} />
                        </Form.Item>

                        <Form.Item label="Organizer" field="organizer">
                            <Input disabled={!edit} />
                        </Form.Item>

                        <Form.Item
                            label="Rejection Reason"
                            field="rejection_reason"
                            style={{
                                display: registration?.registration_status === "rejected" ? "block" : "none",
                            }}
                        >
                            <Input.TextArea
                                disabled={!edit}
                                placeholder="Enter rejection reason..."
                                allowClear
                                autoSize={{minRows: 2, maxRows: 4}}
                                showWordLimit
                                maxLength={500}
                            />
                        </Form.Item>

                        <Form.Item label="Selected Events" field="events_registered" rules={[{required: true}]}>
                            <Select mode="multiple" disabled={!edit} value={registration?.events_registered}>
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
                            <div className="flex flex-row w-full gap-10">
                                {teams.map((team) => (
                                    <div key={team.id} className="border p-4 rounded-md shadow-sm">
                                        <Title heading={6}>{team.name}</Title>
                                        <Divider />
                                        <Form.Item label="Team Name">
                                            <Input
                                                value={team.name}
                                                disabled={!edit}
                                                onChange={(v) => {
                                                    setTeams((prev) => prev.map((t) => (t.id === team.id ? {...t, name: v} : t)));
                                                }}
                                            />
                                        </Form.Item>
                                        <Form.Item label="Team Leader">
                                            <Input value={team.leader_id} disabled />
                                        </Form.Item>
                                        <Form.Item label="Team Members">
                                            <div className="flex flex-col gap-2">
                                                {team.members.map((m, i) => (
                                                    <div key={nanoid()} className="flex gap-2 items-center">
                                                        <Tag color={m.verified ? "green" : "red"}>{m.global_id || "N/A"}</Tag>
                                                    </div>
                                                ))}
                                            </div>
                                        </Form.Item>
                                    </div>
                                ))}
                            </div>
                        </Form.Item>

                        <Form.Item label="Payment Proof" field={`payment_proof_url`}>
                            <Upload
                                listType="picture-card"
                                imagePreview
                                disabled={!edit}
                                limit={1}
                                fileList={
                                    typeof paymentProofUrl === "string" && paymentProofUrl
                                        ? [
                                              {
                                                  uid: "1",
                                                  name: "Payment Proof",
                                                  url: paymentProofUrl,
                                              },
                                          ]
                                        : paymentProofUrl instanceof File
                                          ? ([
                                                {
                                                    uid: "1",
                                                    name: paymentProofUrl.name,
                                                    originFile: paymentProofUrl,
                                                },
                                            ] as UploadItem[])
                                          : []
                                }
                                onChange={(fileList) => {
                                    const rawFile = fileList?.[0]?.originFile || null;
                                    form.setFieldValue("payment_proof_url", rawFile); // ✅ 这里保存的是 File 对象
                                    setPaymentProofUrl(rawFile);
                                }}
                                onRemove={() => {
                                    form.setFieldValue("payment_proof_url", null);
                                    setPaymentProofUrl(null);
                                }}
                            />
                        </Form.Item>

                        {!edit ? (
                            <Form.Item>
                                <Button long type={`primary`} onClick={() => setEdit(true)}>
                                    Edit
                                </Button>
                            </Form.Item>
                        ) : (
                            <Form.Item>
                                <Button
                                    long
                                    type={`primary`}
                                    onClick={() => {
                                        setEdit(false);
                                        handleSave(form.getFieldsValue() as Registration, registration?.rejection_reason ?? "");
                                    }}
                                >
                                    Save
                                </Button>
                            </Form.Item>
                        )}
                        <Form.Item field={`registration_status`} className="w-full">
                            <div className="flex w-full justify-between gap-4">
                                <Button
                                    className="w-1/3"
                                    status="success"
                                    type="outline"
                                    onClick={async () => {
                                        setRegistration((prev) => {
                                            if (!prev) return prev;
                                            return {...prev, registration_status: "approved"};
                                        });
                                        form.setFieldValue("registration_status", "approved");
                                        if (!registration) return;
                                        await handleSave(form.getFieldsValue() as Registration);
                                    }}
                                >
                                    Approve
                                </Button>

                                <Button
                                    className="w-1/3"
                                    status="default"
                                    type="outline"
                                    onClick={async () => {
                                        setRegistration((prev) => {
                                            if (!prev) return prev;
                                            return {...prev, registration_status: "pending"};
                                        });
                                        form.setFieldValue("registration_status", "pending");
                                        if (!registration) return;
                                        await handleSave(form.getFieldsValue() as Registration);
                                    }}
                                >
                                    Pending
                                </Button>

                                <Button
                                    className="w-1/3"
                                    status="danger"
                                    type="outline"
                                    onClick={() => {
                                        let reason = "";
                                        Modal.confirm({
                                            title: "Reject Registration",
                                            content: (
                                                <div className="flex flex-col gap-2">
                                                    <div>Please provide a rejection reason:</div>
                                                    <Input.TextArea
                                                        placeholder="Enter reason here..."
                                                        onChange={(v) => {
                                                            reason = v;
                                                        }}
                                                        allowClear
                                                        autoSize={{minRows: 3, maxRows: 6}}
                                                    />
                                                </div>
                                            ),
                                            okText: "Confirm Reject",
                                            cancelText: "Cancel",
                                            onOk: async () => {
                                                if (!reason.trim()) {
                                                    Message.error("Rejection reason is required.");
                                                    throw new Error("Cancelled");
                                                }

                                                setRegistration((prev) => {
                                                    if (!prev) return prev;
                                                    return {
                                                        ...prev,
                                                        registration_status: "rejected",
                                                        rejection_reason: reason,
                                                    };
                                                });

                                                form.setFieldValue("registration_status", "rejected");

                                                if (!registration) return;
                                                await handleSave(form.getFieldsValue() as Registration, reason);
                                            },
                                        });
                                    }}
                                >
                                    Reject
                                </Button>
                            </div>
                        </Form.Item>
                    </Form>
                </div>
            </Spin>
        </div>
    );
}
