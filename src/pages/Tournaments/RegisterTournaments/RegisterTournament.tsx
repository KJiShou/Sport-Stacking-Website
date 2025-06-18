// src/pages/RegisterTournamentPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {addUserRegistrationRecord, getUserByGlobalId} from "@/services/firebase/authService";
import {createRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {sendProtectedEmail} from "@/utils/SenderGrid/sendMail";
import {
    Button,
    Checkbox,
    Descriptions,
    Divider,
    Empty,
    Form,
    Input,
    InputNumber,
    Link,
    Message,
    Modal,
    Result,
    Select,
    Tooltip,
    Typography,
    Upload,
} from "@arco-design/web-react";
import {IconExclamationCircle, IconLaunch} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import dayjs, {type Dayjs} from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import {Timestamp} from "firebase/firestore";
import {useEffect, useState, type ReactNode} from "react";
import {useNavigate, useParams} from "react-router-dom";
dayjs.extend(isSameOrAfter);
const {Title, Paragraph} = Typography;
const Option = Select.Option;
type TeamEntry = [boolean, string];

export default function RegisterTournamentPage() {
    const {tournamentId} = useParams();
    const [form] = Form.useForm();
    const {firebaseUser, user} = useAuthContext();
    const navigate = useNavigate();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [options, setOptions] = useState<Tournament["events"]>([]);
    const [availableEvents, setAvailableEvents] = useState<Tournament["events"]>([]);
    const [haveTeam, setHaveTeam] = useState<TeamEntry[]>([]);
    const [tournamentData, setTournamentData] = useState<{label?: ReactNode; value?: ReactNode}[]>([]);
    const [requiredKeys, setRequiredKeys] = useState(["3-3-3-individual", "3-6-3-individual", "cycle-individual"]);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);

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

    const formatDate = (date: Timestamp | Date | Dayjs | string | null | undefined): string => {
        if (!date) return "-";
        if (typeof (date as Timestamp).toDate === "function") {
            return (date as Timestamp).toDate().toLocaleString();
        }
        if (dayjs.isDayjs(date)) {
            return date.format("YYYY-MM-DD HH:mm");
        }
        if (date instanceof Date) {
            return date.toLocaleString();
        }
        if (typeof date === "string") {
            return new Date(date).toLocaleString();
        }
        return "-";
    };

    const handleRegister = async (values: Registration) => {
        if (!tournamentId || !tournament) return;

        const now = dayjs();
        const regEnd =
            tournament.registration_end_date instanceof Timestamp
                ? dayjs(tournament.registration_end_date.toDate())
                : dayjs(tournament.registration_end_date);

        const regStart =
            tournament.registration_start_date instanceof Timestamp
                ? dayjs(tournament.registration_start_date.toDate())
                : dayjs(tournament.registration_start_date);

        if (now.isAfter(regEnd)) {
            Message.error("Registration has closed.");
            return;
        }

        if (now.isBefore(regStart)) {
            Message.error("Registration has not started yet.");
            return;
        }

        setLoading(true);

        try {
            if (!user) {
                Message.error("You must be logged in to register.");
                return;
            }

            const teamsRaw = (values.teams ?? {}) as Record<string, NonNullable<RegistrationForm["teams"]>[number]>;
            type Team = NonNullable<RegistrationForm["teams"]>[number];

            for (const [teamId, team] of Object.entries(teamsRaw) as [string, Team][]) {
                const leaderId = team.leader ?? null;
                const memberIds = (team.member ?? []).map((m) => m).filter((id) => id != null) as string[];
                if (!team.looking_for_team_members && leaderId && memberIds.includes(leaderId)) {
                    Message.error(`In team "${team.name}", team leader cannot be included in team members.`);
                    setLoading(false);
                    return;
                }

                const userInTeam = leaderId === user.global_id || memberIds.includes(user.global_id ?? "");
                if (!team.looking_for_team_members && !userInTeam) {
                    Message.error(`In team "${team.name}", you must be either leader or one of the members.`);
                    setLoading(false);
                    return;
                }
            }

            const teams: Registration["teams"] = Object.entries(teamsRaw).map(([teamId, teamData]) => ({
                team_id: teamId,
                label: teamData.label ?? null,
                name: teamData.name ?? null,
                leader: {
                    global_id: teamData.leader ?? null,
                    verified: false,
                },
                member: (teamData.member ?? []).map((memberId: string | null | undefined) => ({
                    global_id: memberId ?? null,
                    verified: false,
                })),
                looking_for_team_members: teamData.looking_for_team_members ?? false,
            }));

            const registrationData: Registration = {
                tournament_id: tournamentId,
                user_id: user?.global_id ?? "",
                user_name: values.user_name,
                age: form.getFieldValue("age"),
                events_registered: values.events_registered,
                payment_proof_url: paymentProofUrl,
                registration_status: "pending",
                rejection_reason: null,
                teams: teams.length > 0 ? teams : null,
                final_status: null,
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
            };

            await createRegistration(user, registrationData);
            const registrationRecord: UserRegistrationRecord = {
                status: "Pending",
                tournament_id: tournamentId,
                events: registrationData.events_registered,
                registration_date: Timestamp.now(),
                rejection_reason: null,
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
                confirmation_date: null,
            };

            for (const team of teams) {
                const toNotify: string[] = [];

                if (team.leader?.global_id && team.leader.global_id !== user.global_id) {
                    toNotify.push(team.leader.global_id);
                }

                for (const member of team.member ?? []) {
                    if (member.global_id && member.global_id !== user.global_id) {
                        toNotify.push(member.global_id);
                    }
                }

                for (const globalId of toNotify) {
                    try {
                        // 🔍 从 Firestore 获取 email
                        const userSnap = await getUserByGlobalId(globalId);
                        const email = userSnap?.email;
                        if (email) {
                            await sendProtectedEmail(email, tournamentId, user?.id ?? "", globalId);
                        }
                    } catch (err) {
                        console.error(`❌ Failed to send verification to ${globalId}`, err);
                    }
                }
            }

            await addUserRegistrationRecord(user.id ?? "", registrationRecord);

            Message.success("Registration successful!");
        } catch (error) {
            console.error(error);
            Message.error("Failed to register.");
        } finally {
            setLoading(false);
            navigate("/tournaments?type=current");
        }
    };

    useEffect(() => {
        const fetch = async () => {
            if (!tournamentId) return;
            setLoading(true);
            try {
                const comp = await fetchTournamentById(tournamentId);
                const age = user?.birthdate && comp?.start_date ? getAgeAtTournament(user.birthdate, comp.start_date) : 0;
                const allAvailableEvents =
                    comp?.events.filter((event) =>
                        event.age_brackets?.some((bracket) => age >= bracket.min_age && age <= bracket.max_age),
                    ) ?? [];

                // 找出 required keys
                const requiredKeys = allAvailableEvents
                    .filter((event) => event.type === "individual")
                    .map((event) => `${event.code}-${event.type}`);

                // 从 availableEvents 里面排除 required 的
                const remainingEvents = allAvailableEvents.filter(
                    (event) => !requiredKeys.includes(`${event.code}-${event.type}`),
                );

                setAvailableEvents(remainingEvents); // 👉 这里只留 non-required
                setOptions(remainingEvents);
                if (comp) {
                    setTournament(comp);
                    setTournamentData([
                        {
                            label: "Location",
                            value: (
                                <Link
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(comp?.address ?? "")}`,
                                            "_blank",
                                        )
                                    }
                                    hoverable={false}
                                >
                                    {comp?.address} ({comp?.country?.join(" / ")}) <IconLaunch />
                                </Link>
                            ),
                        },
                        {
                            label: "Venue",
                            value: <div>{comp?.venue}</div>,
                        },
                        {
                            label: "Date",
                            value: (
                                <div>
                                    {formatDate(comp?.start_date)} - {formatDate(comp?.end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Max Participants",
                            value: <div>{comp?.max_participants === 0 ? "No Limit" : comp?.max_participants}</div>,
                        },
                        {
                            label: "Registration is open until",
                            value: <div>{formatDate(comp?.registration_end_date)}</div>,
                        },
                        {
                            label: "Description",
                            value: (
                                <Button onClick={() => setDescriptionModalVisible(true)} type="text">
                                    <IconExclamationCircle />
                                    view description
                                </Button>
                            ),
                        },
                    ]);
                }

                form.setFieldsValue({
                    user_name: user?.name,
                    id: user?.global_id,
                    age: age,
                    events_registered: requiredKeys, // 一开始强制先选上 required events
                });

                setRequiredKeys(requiredKeys); // 存起来供 onChange 时使用
            } catch (e) {
                setError("Failed to load tournament.");
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [tournamentId]);

    useEffect(() => {
        const events = form.getFieldValue("event");
        if (!events) return;
        const tempHaveTeam = events.map((event: string) => {
            const eventVar = event.split("-");
            if (
                eventVar[eventVar.length - 1] === "team relay" ||
                eventVar[eventVar.length - 1] === "double" ||
                eventVar[eventVar.length - 1] === "parent & child"
            ) {
                return [true, event];
            }
            return [false, event];
        });
        setHaveTeam(tempHaveTeam);
    }, [options]);

    if (error) return <Result status="error" title="Error" subTitle={error} />;
    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <Descriptions
                    column={1}
                    title={
                        <Title style={{textAlign: "center", width: "100%"}} heading={3}>
                            {tournament?.name}
                        </Title>
                    }
                    data={tournamentData}
                    style={{marginBottom: 20}}
                    labelStyle={{textAlign: "right", paddingRight: 36}}
                />
                <Modal
                    title="Tournament Description"
                    visible={descriptionModalVisible}
                    onCancel={() => setDescriptionModalVisible(false)}
                    footer={null}
                    className={`m-10 w-1/2`}
                >
                    <MDEditor.Markdown source={tournament?.description ?? ""} />
                </Modal>
            </div>

            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <Title heading={5}>Register for Event</Title>
                <Form requiredSymbol={false} form={form} layout="vertical" onSubmit={handleRegister}>
                    <Form.Item disabled label="ID" field="id" rules={[{required: true}]}>
                        <Input disabled placeholder="Enter your ID" />
                    </Form.Item>
                    <Form.Item label="Name" field="user_name" rules={[{required: true}]}>
                        <Input disabled placeholder="Enter your name" />
                    </Form.Item>
                    <Form.Item disabled label="Age" field="age" rules={[{required: true}]}>
                        <InputNumber disabled placeholder="Enter your age" />
                    </Form.Item>
                    <Form.Item
                        label={
                            <div>
                                Select Event(s)
                                <Tooltip content="Individual Events are required.">
                                    <IconExclamationCircle
                                        style={{
                                            margin: "0 8px",
                                            color: "rgb(var(--arcoblue-6))",
                                        }}
                                    />
                                </Tooltip>
                            </div>
                        }
                        field="events_registered"
                        rules={[{required: true}]}
                    >
                        <Select
                            placeholder="Select an events"
                            style={{width: 345, marginRight: 20}}
                            mode="multiple"
                            defaultValue={requiredKeys}
                            onChange={(value) => {
                                // 自动补回必须选的 key
                                const finalValue = Array.from(new Set([...value, ...requiredKeys]));

                                // 你这里做 setOptions 等其他逻辑
                                if (!tournament?.events) return;
                                const remaining = availableEvents.filter(
                                    (option) => !finalValue.includes(`${option.code}-${option.type}`),
                                );
                                setOptions(remaining);

                                // 更新表单值（如果你有 form 实例可以 setFieldsValue）
                                form.setFieldsValue({event: finalValue});
                            }}
                            notFoundContent={<Empty description="No Available Events" />}
                        >
                            {options?.map((option) => {
                                const key = `${option.code}-${option.type}`;
                                return (
                                    <Option wrapperClassName="select-demo-hide-option-checkbox" key={key} value={key}>
                                        {option.code} ({option.type})
                                    </Option>
                                );
                            })}
                        </Select>
                    </Form.Item>

                    <Form.Item shouldUpdate noStyle>
                        <div className="flex flex-row w-full gap-10">
                            {haveTeam.map(([teamId, teamLabel]) => {
                                return (
                                    teamId &&
                                    teamLabel && (
                                        <div key={teamLabel}>
                                            <div className="text-center">{teamLabel}</div>
                                            <Divider />
                                            <Form.Item field={`teams.${teamLabel}.label`} initialValue={teamLabel} noStyle>
                                                <Input hidden />
                                            </Form.Item>

                                            {/* Team Name */}
                                            <Form.Item
                                                shouldUpdate={() =>
                                                    form.getFieldValue(`teams.${teamLabel}.looking_for_team_members`)
                                                }
                                            >
                                                {({getFieldValue}) => {
                                                    const isLooking = form.getFieldValue(
                                                        `teams.${teamLabel}.looking_for_team_members`,
                                                    );
                                                    return (
                                                        <Form.Item
                                                            field={`teams.${teamLabel}.name`}
                                                            label="Team Name"
                                                            rules={isLooking ? [] : [{required: true}]}
                                                        >
                                                            <Input disabled={isLooking} placeholder="Please enter team name" />
                                                        </Form.Item>
                                                    );
                                                }}
                                            </Form.Item>

                                            {/* Team Leader */}
                                            <Form.Item
                                                shouldUpdate={() =>
                                                    form.getFieldValue(`teams.${teamLabel}.looking_for_team_members`)
                                                }
                                            >
                                                {({getFieldValue}) => {
                                                    const isLooking = form.getFieldValue(
                                                        `teams.${teamLabel}.looking_for_team_members`,
                                                    );
                                                    return (
                                                        <Form.Item
                                                            field={`teams.${teamLabel}.leader`}
                                                            label="Team Leader Global ID"
                                                            rules={isLooking ? [] : [{required: true}]}
                                                        >
                                                            <Input
                                                                disabled={isLooking}
                                                                placeholder="Please enter team leader global ID"
                                                            />
                                                        </Form.Item>
                                                    );
                                                }}
                                            </Form.Item>

                                            {/* Team Member */}
                                            <Form.Item
                                                shouldUpdate={() =>
                                                    form.getFieldValue(`teams.${teamLabel}.looking_for_team_members`)
                                                }
                                            >
                                                {({getFieldValue}) => {
                                                    const isLooking = form.getFieldValue(
                                                        `teams.${teamLabel}.looking_for_team_members`,
                                                    );
                                                    return (
                                                        <Form.Item
                                                            field={`teams.${teamLabel}.member`}
                                                            label={
                                                                <div>
                                                                    Team Member
                                                                    <Tooltip content="Must Enter Team Member Global ID. Not include Team Leader Global ID">
                                                                        <IconExclamationCircle
                                                                            style={{
                                                                                margin: "0 8px",
                                                                                color: "rgb(var(--arcoblue-6))",
                                                                            }}
                                                                        />
                                                                    </Tooltip>
                                                                </div>
                                                            }
                                                            rules={
                                                                isLooking
                                                                    ? []
                                                                    : [
                                                                          {required: true},
                                                                          {
                                                                              validator: (value, callback) => {
                                                                                  const type = teamLabel.split("-").pop();
                                                                                  if (!value || value.length === 0) {
                                                                                      callback("Please enter team members");
                                                                                      return;
                                                                                  }
                                                                                  if (
                                                                                      type === "team relay" &&
                                                                                      (value.length < 3 || value.length > 4)
                                                                                  ) {
                                                                                      callback(
                                                                                          "Team relay must have 3 to 4 members",
                                                                                      );
                                                                                      return;
                                                                                  }
                                                                                  if (
                                                                                      (type === "double" ||
                                                                                          type === "parent & child") &&
                                                                                      value.length !== 1
                                                                                  ) {
                                                                                      callback(
                                                                                          "Double / Parent & Child must have exactly 1 member",
                                                                                      );
                                                                                      return;
                                                                                  }
                                                                                  callback();
                                                                              },
                                                                          },
                                                                      ]
                                                            }
                                                        >
                                                            <Select
                                                                mode="multiple"
                                                                allowCreate={{
                                                                    formatter: (inputValue, creating) => ({
                                                                        value: inputValue,
                                                                        label: `${creating ? "Enter to create: " : ""}${inputValue}`,
                                                                    }),
                                                                }}
                                                                placeholder="Input Team Member Global ID"
                                                                allowClear
                                                                disabled={isLooking}
                                                                style={{width: 345, flex: 1}}
                                                            />
                                                        </Form.Item>
                                                    );
                                                }}
                                            </Form.Item>

                                            {/* Looking for Team Members */}
                                            <Form.Item
                                                field={`teams.${teamLabel}.looking_for_team_members`}
                                                triggerPropName="checked"
                                            >
                                                <Checkbox>Looking for Team Members</Checkbox>
                                            </Form.Item>
                                        </div>
                                    )
                                );
                            })}
                        </div>
                    </Form.Item>
                    <Form.Item
                        label={
                            <div>
                                Payment Proof
                                <Tooltip content="Please upload a picture of your payment proof.">
                                    <IconExclamationCircle
                                        style={{
                                            margin: "0 8px",
                                            color: "rgb(var(--arcoblue-6))",
                                        }}
                                    />
                                </Tooltip>
                            </div>
                        }
                        field="payment_proof"
                        rules={[{required: true}]}
                    >
                        <Upload
                            className={"w-full flex flex-col items-center justify-center mb-10"}
                            drag
                            multiple={false}
                            limit={1}
                            accept="image/*"
                            customRequest={async (option) => {
                                const {file, onSuccess, onError, onProgress} = option;
                                if (!user?.global_id) {
                                    onError?.(new Error("User not authenticated"));
                                    return;
                                }
                                try {
                                    setLoading(true);
                                    const downloadURL = await uploadFile(
                                        file as File,
                                        `tournaments/${tournamentId}/registrations/payment_proof`,
                                        user.global_id,
                                        (progress) => {
                                            onProgress?.(progress);
                                        },
                                    );
                                    setPaymentProofUrl(downloadURL);
                                    setLoading(false);
                                    onSuccess?.(file);
                                } catch (err) {
                                    onError?.(err as Error);
                                }
                            }}
                            tip="Only pictures can be uploaded"
                        />
                    </Form.Item>

                    <Form.Item>
                        <Button type="primary" htmlType="submit" long loading={loading} disabled={loading}>
                            Register
                        </Button>
                    </Form.Item>
                </Form>
            </div>
        </div>
    );
}
