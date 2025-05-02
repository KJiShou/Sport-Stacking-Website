// src/pages/RegisterCompetitionPage.tsx

import {useParams} from "react-router-dom";
import {useEffect, useState} from "react";
import {Timestamp, addDoc, collection} from "firebase/firestore";
import {fetchCompetitionById} from "../../../services/firebase/competitionsService";
import type {Competition, Registration} from "../../../schema";
import {Typography, Spin, Result, Card, Form, Input, Select, Button, Message} from "@arco-design/web-react";
import dayjs, {type Dayjs} from "dayjs";
import {db} from "../../../services/firebase/config";

const {Title, Paragraph} = Typography;
const Option = Select.Option;

export default function RegisterCompetitionPage() {
    const {competitionId} = useParams();
    const [competition, setCompetition] = useState<Competition | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [form] = Form.useForm();
    const [options, setOptions] = useState<Competition["events"]>([]);

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

    useEffect(() => {
        const fetch = async () => {
            if (!competitionId) return;
            try {
                const comp = await fetchCompetitionById(competitionId);
                if (comp) {
                    setCompetition(comp);
                    setOptions(comp.events);
                }
            } catch (e) {
                setError("Failed to load competition.");
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [competitionId]);

    const handleRegister = async (values: {name: string; team?: string; event: string[]}) => {
        if (!competitionId || !competition) return;

        const now = dayjs();
        const regEnd =
            competition.registration_end_date instanceof Timestamp
                ? dayjs(competition.registration_end_date.toDate())
                : dayjs(competition.registration_end_date);

        if (now.isAfter(regEnd)) {
            Message.error("Registration has closed.");
            return;
        }

        try {
            await addDoc(collection(db, `competitions/${competitionId}/registrations`), {
                competition_id: competitionId,
                user_id: "user-id-placeholder", // 需要替换为真实的 user ID
                age: 0, // 可替换为实际年龄输入值
                events_registered: values.event,
                registration_status: "pending",
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
            });

            Message.success("Registration successful!");
            form.resetFields();
        } catch (error) {
            console.error(error);
            Message.error("Failed to register.");
        }
    };

    if (loading) return <Spin className="w-full mt-20" />;
    if (error) return <Result status="error" title="Error" subTitle={error} />;

    return (
        <div className="flex flex-col items-center p-6 md:p-10 gap-4 w-full">
            <Card className="w-full max-w-4xl shadow-lg">
                <Title heading={3}>{competition?.name}</Title>
                <Paragraph>
                    📍 <b>Location:</b> {competition?.address} ({competition?.country?.join(" / ")})
                </Paragraph>
                <Paragraph>
                    🗓️ <b>Date:</b> {formatDate(competition?.start_date)} - {formatDate(competition?.end_date)}
                </Paragraph>
                <Paragraph>
                    👥 <b>Max Participants:</b> {competition?.max_participants ?? "N/A"}
                </Paragraph>
                <Paragraph>📝 Registration is open until: {formatDate(competition?.registration_end_date)}</Paragraph>
            </Card>

            <div className="w-full max-w-4xl mt-6">
                <Card className="shadow-md">
                    <Title heading={5}>Register for Event</Title>
                    <Form form={form} layout="vertical" onSubmit={handleRegister}>
                        <Form.Item label="Your Name" field="name" rules={[{required: true}]}>
                            {" "}
                            <Input placeholder="Enter your name" />{" "}
                        </Form.Item>
                        <Form.Item label="Team Name (optional)" field="team">
                            {" "}
                            <Input placeholder="Enter team name if applicable" />{" "}
                        </Form.Item>
                        <Form.Item label="Select Event(s)" field="event" rules={[{required: true}]}>
                            <Select
                                placeholder="Select an item"
                                style={{width: 345, marginRight: 20}}
                                mode="multiple"
                                onChange={(value) => {
                                    if (!competition?.events) return;
                                    const remaining = competition.events.filter(
                                        (option) => !value.includes(`${option.code}-${option.type}`),
                                    );
                                    setOptions(remaining);
                                }}
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

                        <Form.Item>
                            <Button type="primary" htmlType="submit">
                                Register
                            </Button>
                        </Form.Item>
                    </Form>
                </Card>
            </div>
        </div>
    );
}
