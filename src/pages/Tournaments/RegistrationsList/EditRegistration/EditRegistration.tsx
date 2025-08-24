// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {Team} from "@/schema/TeamSchema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {getUserByGlobalId, updateUserRegistrationRecord} from "@/services/firebase/authService";
import {fetchRegistrationById, fetchUserRegistration, updateRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {createTeam, fetchTeamsByTournament, fetchTournamentById, updateTeam} from "@/services/firebase/tournamentsService";
import {
    Button,
    Checkbox,
    Divider,
    Dropdown,
    Form,
    Input,
    InputNumber,
    Menu,
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
import dayjs from "dayjs";
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
    const [initialTeams, setInitialTeams] = useState<Team[]>([]);
    const [loading, setLoading] = useState(true);
    const [edit, setEdit] = useState<boolean>(false);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | File | null>(null);

    const [isMounted, setIsMounted] = useState<boolean>(false);
    const mountedRef = useRef(false);

    const getAgeAtTournament = (birthdate: Timestamp | string | Date, tournamentStart: Timestamp | string | Date) => {
        const birth = birthdate instanceof Timestamp ? dayjs(birthdate.toDate()) : dayjs(birthdate);

        const compStart = tournamentStart instanceof Timestamp ? dayjs(tournamentStart.toDate()) : dayjs(tournamentStart);

        let age = compStart.diff(birth, "year");

        // 如果比赛日期还没到今年生日，减 1 岁
        const hasHadBirthdayThisYear = compStart.isSameOrAfter(birth.add(age, "year"), "day");
        if (!hasHadBirthdayThisYear) {
            age -= 1;
        }

        return age;
    };

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
                gender: values.gender,
                country: registration?.country ?? "MY",
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
                const memberIds = team.members.map((m) => m.global_id);
                if (team.leader_id) {
                    memberIds.push(team.leader_id);
                }

                const memberUsers = await Promise.all(memberIds.map((id) => getUserByGlobalId(id)));

                const ages = memberUsers
                    .map((memberUser) => {
                        if (memberUser?.birthdate && tournament?.start_date) {
                            return getAgeAtTournament(memberUser.birthdate, tournament.start_date);
                        }
                        return 0;
                    })
                    .filter((age) => age > 0);

                // Calculate team age based on event type
                let largest_age = 0;
                
                if (ages.length > 0) {
                    // Get the first event to determine the type
                    const firstEvent = team.events[0]?.toLowerCase() || "";
                    
                    if (firstEvent.includes("team relay")) {
                        // Team relay: use average age
                        largest_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (firstEvent.includes("double")) {
                        // Double: use average age but check 10-year range constraint
                        const minAge = Math.min(...ages);
                        const maxAge = Math.max(...ages);
                        if (maxAge - minAge > 10) {
                            throw new Error(`Double event age range cannot exceed 10 years (current range: ${minAge}-${maxAge})`);
                        }
                        largest_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (firstEvent.includes("parent") && firstEvent.includes("child")) {
                        // Parent & Child: use child's age (registration user's age)
                        const childAge = registration?.age || 0;
                        largest_age = childAge;
                    } else {
                        // Default: use largest age (for backward compatibility)
                        largest_age = Math.max(...ages);
                    }
                }

                const teamData = {
                    ...team,
                    largest_age,
                    looking_for_member: team.looking_for_member ?? false,
                };

                const isNew = !initialTeams.some((initialTeam) => initialTeam.id === team.id);

                if (isNew) {
                    await createTeam(tournamentId ?? "", teamData);
                } else {
                    await updateTeam(tournamentId ?? "", team.id, teamData);
                }
            }

            const userRegistrationData: Partial<UserRegistrationRecord> = {
                status: values?.registration_status ?? "pending",
                tournament_id: tournamentId ?? "",
                events: values?.events_registered ?? [],
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

            const allTeamsData = await fetchTeamsByTournament(tournamentId);
            const registrantsUserId = userReg.user_id;
            const registrationTeams = allTeamsData.filter(
                (team) =>
                    team.leader_id === registrantsUserId || team.members.some((member) => member.global_id === registrantsUserId),
            );
            setTeams(registrationTeams);
            setInitialTeams(registrationTeams);

            setPaymentProofUrl(userReg.payment_proof_url ?? null);

            form.setFieldsValue({
                user_name: userReg.user_name,
                id: userReg.user_id,
                age: userReg.age,
                gender: userReg.gender,
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

                        <Form.Item label="Gender" field="gender">
                            <Select disabled={!edit} placeholder="Select gender" options={["Male", "Female"]} />
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
                                onChange={(selectedEvents) => {
                                    form.setFieldValue("events_registered", selectedEvents);
                                    setRegistration((prev) => (prev ? {...prev, events_registered: selectedEvents} : null));

                                    const allTeamEventTypes = ["Team Relay", "Double", "Parent & Child"];

                                    const selectedTeamEventKeys = (tournament?.events ?? [])
                                        .filter((event) => selectedEvents.includes(`${event.code}-${event.type}`))
                                        .filter((event) => allTeamEventTypes.includes(event.type))
                                        .map((event) => `${event.code}-${event.type}`);

                                    const existingTeamEventKeys = teams.flatMap((team) => team.events);

                                    const newTeamEventKeys = selectedTeamEventKeys.filter(
                                        (key) => !existingTeamEventKeys.includes(key),
                                    );
                                    if (newTeamEventKeys.length > 0) {
                                        const newTeamsToAdd: Team[] = newTeamEventKeys.map((key) => ({
                                            id: nanoid(),
                                            tournament_id: tournamentId ?? "",
                                            name: "",
                                            leader_id: registration?.user_id ?? "",
                                            members: [],
                                            events: [key],
                                            registration_id: registrationId ?? "",
                                            largest_age: 0,
                                            looking_for_member: false,
                                        }));
                                        setTeams((prev) => [...prev, ...newTeamsToAdd]);
                                    }

                                    const removedTeamEvents = teams.filter(
                                        (team) => !team.events.some((key) => selectedTeamEventKeys.includes(key)),
                                    );
                                    if (removedTeamEvents.length > 0) {
                                        const removedTeamIds = removedTeamEvents.map((t) => t.id);
                                        setTeams((prev) => prev.filter((team) => !removedTeamIds.includes(team.id)));
                                    }
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
                                {teams.map((team) => (
                                    <div key={team.id} className="border p-4 rounded-md shadow-sm">
                                        <Title heading={6}>{team.events.join(", ")}</Title>
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
                                                        <Tag
                                                            color={m.verified ? "green" : "red"}
                                                            style={{cursor: edit ? "pointer" : "default"}}
                                                            onClick={() => {
                                                                if (edit) {
                                                                    setTeams((prev) =>
                                                                        prev.map((t) =>
                                                                            t.id === team.id
                                                                                ? {
                                                                                      ...t,
                                                                                      members: t.members.map((member, idx) =>
                                                                                          idx === i
                                                                                              ? {
                                                                                                    ...member,
                                                                                                    verified: !member.verified,
                                                                                                }
                                                                                              : member,
                                                                                      ),
                                                                                  }
                                                                                : t,
                                                                        ),
                                                                    );
                                                                }
                                                            }}
                                                        >
                                                            {m.global_id || "N/A"}
                                                        </Tag>
                                                        <Button
                                                            icon={<IconClose />}
                                                            shape="circle"
                                                            size="mini"
                                                            disabled={!edit}
                                                            onClick={() => {
                                                                setTeams((prev) =>
                                                                    prev.map((t) =>
                                                                        t.id === team.id
                                                                            ? {
                                                                                  ...t,
                                                                                  members: t.members.filter(
                                                                                      (_, idx) => idx !== i,
                                                                                  ),
                                                                              }
                                                                            : t,
                                                                    ),
                                                                );
                                                            }}
                                                        />
                                                    </div>
                                                ))}
                                                <Button
                                                    type="primary"
                                                    disabled={!edit}
                                                    icon={<IconPlus />}
                                                    onClick={() => {
                                                        let newMemberId = "";
                                                        Modal.confirm({
                                                            title: "Add New Member",
                                                            content: (
                                                                <Input
                                                                    placeholder="Enter new member's global ID"
                                                                    onChange={(v) => (newMemberId = v)}
                                                                />
                                                            ),
                                                            onOk: () => {
                                                                if (newMemberId) {
                                                                    setTeams((prev) =>
                                                                        prev.map((t) =>
                                                                            t.id === team.id
                                                                                ? {
                                                                                      ...t,
                                                                                      members: [
                                                                                          ...t.members,
                                                                                          {
                                                                                              global_id: newMemberId,
                                                                                              verified: false,
                                                                                          },
                                                                                      ],
                                                                                  }
                                                                                : t,
                                                                        ),
                                                                    );
                                                                }
                                                            },
                                                        });
                                                    }}
                                                >
                                                    Add Member
                                                </Button>
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
                                accept="image/jpeg,image/png,image/gif"
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
                                customRequest={async (option) => {
                                    const {file, onSuccess, onError} = option;
                                    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
                                    const validTypes = ["image/jpeg", "image/png", "image/gif"];

                                    if (!validTypes.includes(file.type)) {
                                        Message.error("Invalid file type. Please upload a JPG, PNG, or GIF.");
                                        onError?.(new Error("Invalid file type"));
                                        return;
                                    }

                                    if (file.size > MAX_SIZE) {
                                        Message.error("File size exceeds 10MB limit");
                                        onError?.(new Error("File size exceeds 10MB limit"));
                                        return;
                                    }
                                    form.setFieldValue("payment_proof_url", file);
                                    setPaymentProofUrl(file);
                                    onSuccess?.();
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
