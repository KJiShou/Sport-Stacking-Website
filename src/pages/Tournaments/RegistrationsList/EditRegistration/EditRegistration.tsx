// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {fetchRegistrationById, fetchUserRegistration, updateRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {updateUserRegistrationRecord} from "@/services/firebase/authService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
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
                organizer: registration?.organizer ?? "",
                events_registered: registration?.events_registered ?? [],
                payment_proof_url: tempPaymentProofUrl,
                registration_status: values?.registration_status ?? "pending",
                rejection_reason: values?.registration_status === "rejected" ? rejection_reason : null,
                teams: (registration?.teams?.length ?? [].length > 0) ? registration?.teams : null,
                final_status: registration?.final_status,
                updated_at: Timestamp.now(),
            };
            await updateRegistration(registrationData);

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
            setPaymentProofUrl(userReg.payment_proof_url ?? null);

            form.setFieldsValue({
                user_name: userReg.user_name,
                id: userReg.user_id,
                age: userReg.age,
                phone_number: userReg.phone_number,
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
                            <Select
                                mode="multiple"
                                disabled={!edit}
                                value={registration?.events_registered}
                                onChange={(value) => {
                                    setRegistration((prev) => {
                                        if (!prev) return prev;

                                        const oldEvents = prev.events_registered ?? [];
                                        const newEvents = value;

                                        const addedEvents = newEvents.filter((e: string) => !oldEvents.includes(e));
                                        const removedEvents = oldEvents.filter((e) => !newEvents.includes(e));

                                        let updatedTeams = prev.teams ?? [];

                                        for (const eventKey of addedEvents) {
                                            const type = eventKey.split("-").pop()?.toLowerCase();

                                            if (["double", "team relay", "parent & child"].includes(type ?? "")) {
                                                const team = {
                                                    team_id: eventKey,
                                                    name: "",
                                                    label: eventKey,
                                                    looking_for_team_members: false,
                                                    leader: {
                                                        global_id: "",
                                                        verified: false,
                                                    },
                                                    member: [] as {global_id: string; verified: boolean}[],
                                                };

                                                if (type === "double") {
                                                    team.member = [{global_id: "", verified: false}];
                                                } else if (type === "team relay") {
                                                    team.member = Array.from({length: 4}, () => ({
                                                        global_id: "",
                                                        verified: false,
                                                    }));
                                                } else if (type === "parent & child") {
                                                    team.member = [{global_id: "", verified: false}];
                                                }

                                                updatedTeams.push(team);
                                            }
                                        }

                                        updatedTeams = updatedTeams.filter((team) => !removedEvents.includes(team.team_id));

                                        return {
                                            ...prev,
                                            events_registered: newEvents,
                                            teams: updatedTeams,
                                        };
                                    });

                                    form.setFieldValue("events_registered", value);
                                }}
                            >
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
                                {(registration?.teams ?? []).map((team) => (
                                    <div key={team.team_id} className="border p-4 rounded-md shadow-sm">
                                        <Title heading={6}>{team.label}</Title>
                                        <Divider />

                                        <Form.Item label="Team Name">
                                            <Input
                                                value={team.name}
                                                disabled={!edit}
                                                onChange={(v) => {
                                                    setRegistration((prev) => {
                                                        if (!prev) return prev;
                                                        const updated = prev.teams?.map((t) =>
                                                            t.team_id === team.team_id ? {...t, name: v} : t,
                                                        );
                                                        return {...prev, teams: updated};
                                                    });
                                                }}
                                            />
                                        </Form.Item>

                                        <Form.Item label="Team Leader">
                                            <Dropdown
                                                disabled={!edit}
                                                trigger={["click", "hover"]}
                                                position="br"
                                                droplist={
                                                    <div
                                                        className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                                    >
                                                        <Button
                                                            type="text"
                                                            onClick={() => {
                                                                Modal.confirm({
                                                                    title: "Change Leader",
                                                                    content: (
                                                                        <Input
                                                                            placeholder="New Global ID"
                                                                            onChange={(e) => {
                                                                                const newId = e;
                                                                                setRegistration((prev) => {
                                                                                    if (!prev) return prev;
                                                                                    const updated = prev.teams?.map((t) =>
                                                                                        t.team_id === team.team_id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  leader: {
                                                                                                      global_id: newId,
                                                                                                      verified: false,
                                                                                                  },
                                                                                              }
                                                                                            : t,
                                                                                    );
                                                                                    return {...prev, teams: updated};
                                                                                });
                                                                            }}
                                                                        />
                                                                    ),
                                                                    okText: "Change",
                                                                });
                                                            }}
                                                        >
                                                            Change Leader
                                                        </Button>
                                                        <Button
                                                            status={team.leader.verified ? "danger" : "default"}
                                                            type="text"
                                                            disabled={!edit}
                                                            onClick={() => {
                                                                if (!edit) return;
                                                                setRegistration((prev) => {
                                                                    if (!prev) return prev;
                                                                    const updated = prev.teams?.map((t) =>
                                                                        t.team_id === team.team_id
                                                                            ? {
                                                                                  ...t,
                                                                                  leader: {
                                                                                      ...t.leader,
                                                                                      verified: !t.leader.verified,
                                                                                  },
                                                                              }
                                                                            : t,
                                                                    );
                                                                    return {...prev, teams: updated};
                                                                });
                                                            }}
                                                        >
                                                            {team.leader.verified ? <IconClose /> : <IconCheck />}
                                                            {team.leader.verified ? "Unverify" : "Verify"}
                                                        </Button>
                                                    </div>
                                                }
                                            >
                                                <Tag color={team.leader.verified ? "green" : "red"} defaultChecked>
                                                    {team.leader?.global_id || "N/A"}
                                                </Tag>
                                            </Dropdown>
                                        </Form.Item>

                                        <Form.Item label="Team Members">
                                            <div className="flex flex-col gap-2">
                                                {(team.member ?? []).map((m, i) => (
                                                    <div key={nanoid()} className="flex gap-2 items-center">
                                                        <Dropdown
                                                            disabled={!edit}
                                                            trigger={["click", "hover"]}
                                                            position="tr"
                                                            droplist={
                                                                <div
                                                                    className={`bg-white flex flex-col py-2 border border-solid border-gray-200 rounded-lg shadow-lg`}
                                                                >
                                                                    <Button
                                                                        type="text"
                                                                        onClick={() => {
                                                                            Modal.confirm({
                                                                                title: "Change Member",
                                                                                content: (
                                                                                    <Input
                                                                                        placeholder="New Global ID"
                                                                                        onChange={(e) => {
                                                                                            const newId = e;
                                                                                            setRegistration((prev) => {
                                                                                                if (!prev) return prev;
                                                                                                const updated = prev.teams?.map(
                                                                                                    (t) => {
                                                                                                        if (
                                                                                                            t.team_id !==
                                                                                                            team.team_id
                                                                                                        )
                                                                                                            return t;
                                                                                                        const members = [
                                                                                                            ...(t.member ?? []),
                                                                                                        ];
                                                                                                        members[i] = {
                                                                                                            global_id: newId,
                                                                                                            verified: false,
                                                                                                        };
                                                                                                        return {
                                                                                                            ...t,
                                                                                                            member: members,
                                                                                                        };
                                                                                                    },
                                                                                                );
                                                                                                return {...prev, teams: updated};
                                                                                            });
                                                                                        }}
                                                                                    />
                                                                                ),
                                                                                okText: "Change",
                                                                            });
                                                                        }}
                                                                    >
                                                                        Change Member
                                                                    </Button>
                                                                    <Button
                                                                        status={m.verified ? "danger" : "default"}
                                                                        disabled={!edit}
                                                                        type="text"
                                                                        onClick={() => {
                                                                            if (!edit) return;
                                                                            setRegistration((prev) => {
                                                                                if (!prev) return prev;
                                                                                const updated = prev.teams?.map((t) => {
                                                                                    if (t.team_id !== team.team_id) return t;
                                                                                    const members = [...(t.member ?? [])];
                                                                                    members[i].verified = !members[i].verified;
                                                                                    return {...t, member: members};
                                                                                });
                                                                                return {...prev, teams: updated};
                                                                            });
                                                                        }}
                                                                    >
                                                                        {m.verified ? <IconClose /> : <IconCheck />}
                                                                        {m.verified ? "Unverify" : "Verify"}
                                                                    </Button>
                                                                    <Button
                                                                        status="danger"
                                                                        type="text"
                                                                        disabled={!edit}
                                                                        onMouseDown={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                        }}
                                                                        onClick={() => {
                                                                            setRegistration((prev) => {
                                                                                if (!prev) return prev;
                                                                                const updated = prev.teams?.map((t) => {
                                                                                    if (t.team_id !== team.team_id) return t;
                                                                                    const members = [...(t.member ?? [])];
                                                                                    members.splice(i, 1);
                                                                                    return {...t, member: members};
                                                                                });
                                                                                return {...prev, teams: updated};
                                                                            });
                                                                        }}
                                                                    >
                                                                        <IconDelete /> Delete
                                                                    </Button>
                                                                </div>
                                                            }
                                                        >
                                                            <Tag color={m.verified ? "green" : "red"} defaultChecked>
                                                                {m.global_id || "N/A"}
                                                            </Tag>
                                                        </Dropdown>
                                                    </div>
                                                ))}

                                                <Button
                                                    disabled={!edit}
                                                    type="text"
                                                    onClick={() => {
                                                        setRegistration((prev) => {
                                                            if (!prev) return prev;
                                                            const updated = prev.teams?.map((t) =>
                                                                t.team_id === team.team_id
                                                                    ? {
                                                                          ...t,
                                                                          member: [
                                                                              ...(t.member ?? []),
                                                                              {global_id: "", verified: false},
                                                                          ],
                                                                      }
                                                                    : t,
                                                            );
                                                            return {...prev, teams: updated};
                                                        });
                                                    }}
                                                >
                                                    <IconPlus /> Add Member
                                                </Button>
                                            </div>
                                        </Form.Item>

                                        <Form.Item>
                                            <Checkbox
                                                checked={team.looking_for_team_members}
                                                disabled={!edit}
                                                onChange={(v) => {
                                                    setRegistration((prev) => {
                                                        if (!prev) return prev;
                                                        const updated = prev.teams?.map((t) =>
                                                            t.team_id === team.team_id ? {...t, looking_for_team_members: v} : t,
                                                        );
                                                        return {...prev, teams: updated};
                                                    });
                                                }}
                                            >
                                                Looking for Team Members
                                            </Checkbox>
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
