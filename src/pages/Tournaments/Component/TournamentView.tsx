import type {Registration, Tournament, TournamentEvent} from "@/schema";
import {fetchApprovedRegistrations} from "@/services/firebase/registerService";
import {fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {formatDate} from "@/utils/Date/formatDate";
import {
    Button,
    Card,
    Descriptions,
    Divider,
    Image,
    Link,
    Modal,
    Result,
    Spin,
    Table,
    Tag,
    Typography,
} from "@arco-design/web-react";
import {IconCalendar, IconExclamationCircle, IconLaunch, IconUndo} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import {type ReactNode, useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title, Text} = Typography;

export default function TournamentView() {
    const {id} = useParams<{id: string}>();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [tournamentData, setTournamentData] = useState<{label: string; value: ReactNode}[]>([]);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    const [registrations, setRegistrations] = useState<Registration[]>([]);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const navigate = useNavigate();

    useEffect(() => {
        async function fetchTournament() {
            setLoading(true);
            try {
                if (id) {
                    const data = await fetchTournamentById(id);
                    setTournament(data);

                    // Fetch registrations and events
                    const [regs, evts] = await Promise.all([fetchApprovedRegistrations(id), fetchTournamentEvents(id)]);
                    setRegistrations(regs);
                    setEvents(evts);

                    setTournamentData([
                        {
                            label: "Registration Price",
                            value: <div>RM{data?.registration_fee}</div>,
                        },
                        {
                            label: "Member Registration Price",
                            value: <div>RM{data?.member_registration_fee}</div>,
                        },
                        {
                            label: "Total Participants",
                            value: (
                                <div>
                                    <Text bold>{regs.length}</Text>
                                    {data &&
                                        data.max_participants !== null &&
                                        data.max_participants !== undefined &&
                                        data.max_participants > 0 && <Text type="secondary"> / {data.max_participants}</Text>}
                                </div>
                            ),
                        },
                        {
                            label: "Location",
                            value: (
                                <Link
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data?.address ?? "")}`,
                                            "_blank",
                                        )
                                    }
                                    hoverable={false}
                                >
                                    {data?.address} ({data?.country?.join(" / ")}) <IconLaunch />
                                </Link>
                            ),
                        },
                        {
                            label: "Venue",
                            value: <div>{data?.venue}</div>,
                        },
                        {
                            label: "Date",
                            value: (
                                <div>
                                    {formatDate(data?.start_date)} - {formatDate(data?.end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Max Participants",
                            value: <div>{data?.max_participants === 0 ? "No Limit" : data?.max_participants}</div>,
                        },
                        {
                            label: "Registration is open until",
                            value: <div>{formatDate(data?.registration_end_date)}</div>,
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
                        {
                            label: "Agenda",
                            value: data?.agenda ? (
                                <Button type="text" onClick={() => window.open(`${data?.agenda}`, "_blank")}>
                                    <IconCalendar /> View Agenda
                                </Button>
                            ) : (
                                "-"
                            ),
                        },
                    ]);
                }
            } finally {
                setLoading(false);
            }
        }
        fetchTournament();
    }, [id]);
    if (loading) {
        return <Spin style={{margin: 40}} />;
    }
    if (!tournament) {
        return (
            <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
                <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                    <IconUndo /> Go Back
                </Button>
                <div
                    className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}
                >
                    <Result status="error" title="Tournament not found" subTitle="Something went wrong. Please try again. " />
                </div>
            </div>
        );
    }

    return (
        <div className={`flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch `}>
            <Button type="outline" onClick={() => navigate("/tournaments")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <div className={`flex flex-col items-center`}>
                    <Image src={`${tournament?.logo}`} alt="logo" width={200} />
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

                {/* Event Participant Breakdown */}
                {events.length > 0 && (
                    <div className="w-full mt-6">
                        <Divider />
                        <Title heading={4} style={{marginBottom: 16}}>
                            Event Participation
                        </Title>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {events.map((event) => (
                                <Card key={event.id} title={`${event.type} (${event.codes?.join(", ")})`} bordered>
                                    <div className="space-y-2">
                                        {event.age_brackets.map((bracket) => {
                                            const participantsInBracket = registrations.filter(
                                                (reg) => reg.age >= bracket.min_age && reg.age <= bracket.max_age,
                                            );
                                            return (
                                                <div key={bracket.name} className="flex justify-between items-center">
                                                    <Text>
                                                        {bracket.name} ({bracket.min_age}-{bracket.max_age})
                                                    </Text>
                                                    <Tag color="arcoblue">{participantsInBracket.length}</Tag>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </div>
                )}

                {/* Records Section - Show for Ongoing or End tournaments */}
                {tournament && (tournament.status === "On Going" || tournament.status === "End") && id && (
                    <div className="w-full mt-6">
                        <Divider />
                        <div className="flex justify-between items-center mb-4">
                            <Title heading={4}>Tournament Records</Title>
                            <Button type="primary" onClick={() => navigate(`/tournaments/${id}/record/prelim`)}>
                                View All Records
                            </Button>
                        </div>
                        <Text type="secondary">
                            This tournament is {tournament.status.toLowerCase()}. Click "View All Records" to see detailed
                            results.
                        </Text>
                    </div>
                )}
            </div>
        </div>
    );
}
