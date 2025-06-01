// src/pages/RegisterTournamentPage.tsx

import { useAuthContext } from "@/context/AuthContext";
import type { Registration, Tournament } from "@/schema";
import { db } from "@/services/firebase/config";
import { fetchTournamentById } from "@/services/firebase/tournamentsService";
import {
    Button,
    Descriptions,
    Divider,
    Empty,
    Form,
    Input,
    InputNumber,
    Link,
    Message,
    Result,
    Select,
    Tooltip,
    Typography
} from "@arco-design/web-react";
import { IconExclamationCircle, IconLaunch } from "@arco-design/web-react/icon";
import dayjs, { type Dayjs } from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import { Timestamp, addDoc, collection } from "firebase/firestore";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
dayjs.extend(isSameOrAfter);
const { Title, Paragraph } = Typography;
const Option = Select.Option;
type TeamEntry = [boolean, string];

export default function RegisterTournamentPage() {
    const { tournamentId } = useParams();
    const [form] = Form.useForm();
    const { user } = useAuthContext();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [options, setOptions] = useState<Tournament["events"]>([]);
    const [availableEvents, setAvailableEvents] = useState<Tournament["events"]>([]);
    const [haveTeam, setHaveTeam] = useState<TeamEntry[]>([]);
    const [tournamentData, setTournamentData] = useState<{ label?: ReactNode; value?: ReactNode }[]>([]);

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

        if (now.isAfter(regEnd)) {
            Message.error("Registration has closed.");
            return;
        }

        setLoading(true);

        try {
            await addDoc(collection(db, `tournaments/${tournamentId}/registrations`), {
                tournament_id: tournamentId,
                user_id: user?.global_id,
                age: form.getFieldValue("age"),
                user_name: values.user_name,
                events_registered: values,
                registration_status: "pending",
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
            });

            Message.success("Registration successful!");
            form.resetFields();
        } catch (error) {
            console.error(error);
            Message.error("Failed to register.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const fetch = async () => {
            if (!tournamentId) return;
            setLoading(true);
            try {
                const comp = await fetchTournamentById(tournamentId);
                const age = user?.birthdate && comp?.start_date ? getAgeAtTournament(user.birthdate, comp.start_date) : 0;
                const availableEvents = comp?.events.filter((event) =>
                    event.age_brackets?.some((bracket) => age >= bracket.min_age && age <= bracket.max_age),
                );
                setAvailableEvents(availableEvents ?? []);
                if (comp) {
                    setTournament(comp);
                    setOptions(availableEvents ?? []);
                    setTournamentData([
                        {
                            label: "Location",
                            value: (
                                <Link
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(tournament?.address ?? "")}`,
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
                            label: "Date",
                            value: (
                                <div>
                                    {formatDate(comp?.start_date)} - {formatDate(comp?.end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Max Participants",
                            value: <div>{comp?.max_participants ?? "N/A"}</div>,
                        },
                        {
                            label: "Registration is open until",
                            value: <div>{formatDate(comp?.registration_end_date)}</div>,
                        },
                    ]);
                }
                form.setFieldsValue({
                    name: user?.name,
                    id: user?.global_id,
                    age: age,
                });
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
            if (eventVar[eventVar.length - 1] === "team") {
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
                        <Title style={{ textAlign: "center", width: "100%" }} heading={3}>
                            {tournament?.name}
                        </Title>
                    }
                    data={tournamentData}
                    style={{ marginBottom: 20 }}
                    labelStyle={{ textAlign: "right", paddingRight: 36 }}
                />
            </div>

            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <Title heading={5}>Register for Event</Title>
                <Form requiredSymbol={false} form={form} layout="vertical" onSubmit={handleRegister}>
                    <Form.Item disabled label="ID" field="id" rules={[{ required: true }]}>
                        <Input disabled placeholder="Enter your ID" />
                    </Form.Item>
                    <Form.Item label="Name" field="name" rules={[{ required: true }]}>
                        <Input placeholder="Enter your name" />
                    </Form.Item>
                    <Form.Item disabled label="Age" field="age" rules={[{ required: true }]}>
                        <InputNumber disabled placeholder="Enter your age" />
                    </Form.Item>
                    <Form.Item label="Select Event(s)" field="event" rules={[{ required: true }]}>
                        <Select
                            placeholder="Select an events"
                            style={{ width: 345, marginRight: 20 }}
                            mode="multiple"
                            onChange={(value) => {
                                if (!tournament?.events) return;
                                const remaining = availableEvents.filter(
                                    (option) => !value.includes(`${option.code}-${option.type}`),
                                );
                                setOptions(remaining);
                            }}
                            notFoundContent={<Empty description="No Available Events" />}
                        >
                            {options?.map((option) => (
                                <Option
                                    wrapperClassName="select-demo-hide-option-checkbox"
                                    key={`${option.code}-${option.type}`}
                                    value={`${option.code}-${option.type}`}
                                >
                                    {option.code} ({option.type})
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item shouldUpdate noStyle>
                        <div className={`flex flex-row w-full gap-10`}>
                            {haveTeam.map(([teamId, teamLabel]) => {
                                return (
                                    teamId &&
                                    teamLabel && (
                                        <div>
                                            <div className={`text-center`}>{teamLabel}</div>
                                            <Divider />
                                            <Form.Item field={`teams.${teamLabel}.label`} initialValue={teamLabel} noStyle>
                                                <Input hidden />
                                            </Form.Item>
                                            <Form.Item
                                                field={`teams.${teamLabel}.name`}
                                                label="Team Name"
                                                rules={[{ required: true }]}
                                            >
                                                <Input placeholder="Please enter team name" />
                                            </Form.Item>
                                            <Form.Item
                                                field={`teams.${teamLabel}.leader`}
                                                label={`Team Leader Global ID`}
                                                rules={[{ required: true }]}
                                            >
                                                <InputNumber hideControl placeholder="Please enter team leader global ID" />
                                            </Form.Item>
                                            <Form.Item
                                                field={`teams.${teamLabel}.member`}
                                                label={
                                                    <div>
                                                        Team Member
                                                        <Tooltip content="Must Enter Team Member Global ID">
                                                            <IconExclamationCircle
                                                                style={{ margin: "0 8px", color: "rgb(var(--arcoblue-6))" }}
                                                            />
                                                        </Tooltip>
                                                    </div>
                                                }
                                                rules={[{ required: true }]}
                                            >
                                                <Select
                                                    mode="multiple"
                                                    allowCreate={{
                                                        formatter: (inputValue, creating) => {
                                                            return {
                                                                value: inputValue,
                                                                label: `${creating ? "Enter to create: " : ""}${inputValue}`,
                                                            };
                                                        },
                                                    }}
                                                    placeholder="Input Team Member Global ID"
                                                    allowClear
                                                    style={{ width: 345, flex: 1 }}
                                                />
                                            </Form.Item>
                                        </div>
                                    )
                                );
                            })}
                        </div>
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
