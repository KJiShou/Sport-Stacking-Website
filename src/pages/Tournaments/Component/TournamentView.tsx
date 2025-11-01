import type {Tournament} from "@/schema";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {formatDate} from "@/utils/Date/formatDate";
import {Button, Descriptions, Image, Link, Modal, Result, Spin, Tag, Typography} from "@arco-design/web-react";
import {IconCalendar, IconExclamationCircle, IconLaunch, IconUndo} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import {type ReactNode, useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

const {Title} = Typography;

export default function TournamentView() {
    const {id} = useParams<{id: string}>();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [tournamentData, setTournamentData] = useState<{label: string; value: ReactNode}[]>([]);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
    const [loading, setLoading] = useState(true);
    // No modal needed for description
    const navigate = useNavigate();

    useEffect(() => {
        async function fetchTournament() {
            setLoading(true);
            try {
                if (id) {
                    const data = await fetchTournamentById(id);
                    setTournament(data);
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
            </div>
        </div>
    );
}
