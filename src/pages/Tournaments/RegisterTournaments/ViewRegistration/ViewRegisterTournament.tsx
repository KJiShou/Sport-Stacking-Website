// src/pages/ViewTournamentRegistrationPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament, TournamentEvent} from "@/schema";
import type {Team} from "@/schema/TeamSchema";
import {deleteRegistrationById, fetchUserRegistration} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {getEventKey, getEventLabel, matchesAnyEventKey, matchesEventKey} from "@/utils/tournament/eventUtils";
import {
    Button,
    Divider,
    Form,
    Image,
    Input,
    InputNumber,
    Message,
    Popconfirm,
    Result,
    Select,
    Spin,
    Typography,
} from "@arco-design/web-react";
import {IconDelete, IconExclamationCircle, IconUndo} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;
const Option = Select.Option;

type LegacyTeam = Team & {
    event_ids?: string[];
    events?: string[];
};

const resolveTeamEvent = (
    team: LegacyTeam,
    tournamentEvents: TournamentEvent[] | null | undefined,
): {eventId: string; eventName: string} => {
    const legacyIds = Array.isArray(team.event_ids) ? team.event_ids.filter(Boolean) : [];
    const legacyNames = Array.isArray(team.events) ? team.events.filter(Boolean) : [];

    let eventId = team.event_id ?? legacyIds[0] ?? "";
    let eventName = Array.isArray(team.event) && team.event[0] ? (team.event[0] ?? "") : (legacyNames[0] ?? "");

    const eventsList = tournamentEvents ?? [];

    if (eventsList.length > 0) {
        if (eventId) {
            const matchById = eventsList.find((evt) => getEventKey(evt) === eventId || matchesEventKey(eventId, evt)) ?? null;
            if (matchById) {
                eventId = getEventKey(matchById);
                if (!eventName) {
                    eventName = getEventLabel(matchById);
                }
                return {eventId, eventName};
            }
        }

        if (eventName) {
            const matchByName = eventsList.find((evt) => matchesEventKey(eventName, evt)) ?? null;
            if (matchByName) {
                eventId = getEventKey(matchByName);
                eventName = getEventLabel(matchByName);
            }
        }
    }

    return {eventId, eventName};
};

const filterDisplayedEvents = (selected: string[], events: TournamentEvent[]): string[] => {
    if (selected.length === 0 || events.length === 0) {
        return selected;
    }

    const hasSpecificIndividual = events.some((event) => event.type === "Individual" && matchesAnyEventKey(selected, event));

    return selected.filter((eventId) => {
        if (eventId === "Individual" && hasSpecificIndividual) {
            return false;
        }
        return true;
    });
};

export default function ViewTournamentRegistrationPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();

    const [form] = Form.useForm();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [registration, setRegistration] = useState<Registration | null>(null);
    const [teams, setTeams] = useState<LegacyTeam[]>([]);
    const [loading, setLoading] = useState(true);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
    const [availableEventsState, setAvailableEventsState] = useState<TournamentEvent[]>([]);
    const registrationPrice = useMemo(
        () => (user?.memberId ? tournament?.member_registration_fee : tournament?.registration_fee),
        [tournament, user],
    );
    const requiresPaymentProof = (registrationPrice ?? 0) > 0;

    const parseDate = (date: Tournament["registration_start_date"]): dayjs.Dayjs | null => {
        if (!date) return null;
        if (date instanceof Timestamp) {
            return dayjs(date.toDate());
        }
        return dayjs(date);
    };

    const canDeleteRegistration = useMemo(() => {
        if (registration?.registration_status === "approved") return false;
        if (!tournament?.registration_start_date || !tournament?.registration_end_date) return true;
        if (tournament.status === "On Going" || tournament.status === "End") return false;
        const start = parseDate(tournament.registration_start_date);
        const end = parseDate(tournament.registration_end_date);
        if (!start || !end) return true;

        const now = dayjs();
        return (now.isAfter(start) || now.isSame(start)) && (now.isBefore(end) || now.isSame(end));
    }, [registration?.registration_status, tournament]);

    const handleDeleteRegistration = async (registrationId: string) => {
        if (!tournamentId) return;
        if (!canDeleteRegistration) {
            Message.error("Registration deletions are only allowed during the registration period.");
            return;
        }

        setLoading(true);
        try {
            // Here you would call your delete service function
            await deleteRegistrationById(tournamentId, registrationId);
            Message.success("Registration deleted successfully.");
            navigate("/tournaments");
        } catch (error) {
            console.error("Failed to delete registration:", error);
            Message.error("Failed to delete registration.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const loadData = async () => {
            if (!tournamentId || !user?.global_id) return;
            setLoading(true);
            try {
                const tournamentData = await fetchTournamentById(tournamentId);
                const tournamentEvents = tournamentData?.events?.length
                    ? tournamentData.events
                    : await fetchTournamentEvents(tournamentId);
                setTournament(tournamentData);
                setAvailableEventsState(tournamentEvents);

                const userReg = await fetchUserRegistration(tournamentId, user.global_id ?? "");
                if (!userReg) {
                    Message.error("No registration found for this tournament.");
                    navigate("/tournaments");
                    return;
                }
                setRegistration(userReg);

                const teamsData = await fetchTeamsByTournament(tournamentId);

                const membershipTeams = teamsData.filter(
                    (team) =>
                        team.leader_id === user.global_id || (team.members ?? []).some((m) => m.global_id === user.global_id),
                );
                const normalizedTeams = membershipTeams.map((team) => {
                    const legacyTeam = team as LegacyTeam;
                    const {eventId, eventName} = resolveTeamEvent(legacyTeam, tournamentEvents);

                    return {
                        ...legacyTeam,
                        event_id: eventId ? eventId : null,
                        event: eventName ? [eventName] : Array.isArray(legacyTeam.event) ? legacyTeam.event : [],
                    };
                });
                setTeams(normalizedTeams);
                setPaymentProofUrl(userReg.payment_proof_url ?? null);

                const displayedEvents = filterDisplayedEvents(userReg.events_registered ?? [], tournamentEvents);

                form.setFieldsValue({
                    user_name: userReg.user_name,
                    id: userReg.user_global_id,
                    age: userReg.age,
                    phone_number: userReg.phone_number,
                    events_registered: displayedEvents,
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

    const getEventDisplayLabel = (eventId: string): string => {
        const event = availableEventsState.find((evt) => getEventKey(evt) === eventId);
        return event ? getEventLabel(event) : eventId;
    };

    const extraEventIds =
        (form.getFieldValue("events_registered") as string[] | undefined)?.filter(
            (eventId) => !availableEventsState.some((event) => getEventKey(event) === eventId),
        ) ?? [];

    return (
        <div className="flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <Spin loading={loading} tip="Loading…" className={"w-full"}>
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
                                {availableEventsState.map((event) => {
                                    const key = getEventKey(event);
                                    const displayText = getEventLabel(event);
                                    return (
                                        <Option key={key} value={key}>
                                            {displayText}
                                        </Option>
                                    );
                                })}
                                {extraEventIds.map((eventId) => (
                                    <Option key={`extra-${eventId}`} value={eventId}>
                                        {getEventDisplayLabel(eventId)}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>

                        <Form.Item shouldUpdate noStyle>
                            <div className={`flex flex-row w-full gap-10`}>
                                {teams.map((team) => {
                                    const {eventId, eventName} = resolveTeamEvent(team, availableEventsState);
                                    const teamEventLabel = eventName || "Team Event";
                                    const eventDefinition =
                                        availableEventsState.find(
                                            (evt) => getEventKey(evt) === eventId || matchesEventKey(eventId, evt),
                                        ) ?? null;
                                    const isDoubleEvent = eventDefinition?.type === "Double";
                                    const teamNameLabel = isDoubleEvent ? "Double Partner Name" : "Team Name";
                                    const teamLeaderLabel = isDoubleEvent ? "Double Leader" : "Team Leader";
                                    const teamMemberLabel = isDoubleEvent ? "Double Partner Members" : "Team Members";
                                    return (
                                        <div key={team.id}>
                                            <div className={`text-center font-semibold mb-2`}>{teamEventLabel}</div>
                                            <Divider />
                                            <Form.Item label={teamNameLabel}>
                                                <Input value={team.name} disabled />
                                            </Form.Item>
                                            <Form.Item label={teamLeaderLabel}>
                                                <Input value={team.leader_id} disabled />
                                            </Form.Item>
                                            <Form.Item label={teamMemberLabel}>
                                                <div className="flex flex-col gap-2">
                                                    {team.members.map((m) => (
                                                        <Button
                                                            key={m.global_id}
                                                            status={m.verified ? "success" : "danger"}
                                                            disabled
                                                        >
                                                            {m.global_id ?? "N/A"}
                                                        </Button>
                                                    ))}
                                                </div>
                                            </Form.Item>
                                        </div>
                                    );
                                })}
                            </div>
                        </Form.Item>

                        {requiresPaymentProof ? (
                            <Form.Item label="Payment Proof">
                                {paymentProofUrl ? (
                                    <Image width={200} src={paymentProofUrl} alt="Payment Proof" />
                                ) : (
                                    <Typography.Text type="secondary">No payment proof uploaded.</Typography.Text>
                                )}
                            </Form.Item>
                        ) : (
                            <Form.Item label="Payment Proof">
                                <Typography.Text type="secondary">Payment proof not required.</Typography.Text>
                            </Form.Item>
                        )}
                    </Form>
                    <Popconfirm
                        focusLock
                        title={"Delete tournament registration"}
                        content={
                            <div className={`flex flex-col`}>
                                <div>
                                    Are you sure you want to delete this registration? Please note that this action is
                                    irreversible and your payment will be cancelled.
                                </div>
                                <div className={`text-red-500 font-semibold mt-2`}>
                                    <IconExclamationCircle /> This action cannot be undone.
                                </div>
                            </div>
                        }
                        onOk={(e) => {
                            if (registration?.id) {
                                handleDeleteRegistration(registration.id);
                            } else {
                                Message.error("Unable to determine registration id");
                            }
                            e.stopPropagation();
                        }}
                        okText="Yes"
                        cancelText="No"
                        onCancel={(e) => {
                            e.stopPropagation();
                        }}
                        okButtonProps={{status: "danger"}}
                        disabled={!canDeleteRegistration}
                    >
                        <Button
                            title={"Delete this registration"}
                            type="secondary"
                            status="danger"
                            loading={loading}
                            icon={<IconDelete />}
                            disabled={!canDeleteRegistration}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (!canDeleteRegistration) {
                                    Message.warning("You can only delete registrations within the registration period.");
                                }
                            }}
                        >
                            Delete Registration
                        </Button>
                    </Popconfirm>
                </div>
            </Spin>
        </div>
    );
}
