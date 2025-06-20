import {useAuthContext} from "@/context/AuthContext";
import type {Registration, Tournament} from "@/schema";
import {deleteRegistrationById, fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTournamentById} from "@/services/firebase/tournamentsService";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";
import {Button, Dropdown, Message, Popconfirm, type TableColumnProps, Tag} from "@arco-design/web-react";
import Table from "@arco-design/web-react/es/Table/table";
import Title from "@arco-design/web-react/es/Typography/title";
import {IconDelete, IconEye, IconEyeInvisible, IconUndo} from "@arco-design/web-react/icon";
import type {Timestamp} from "firebase/firestore";
import {ref} from "firebase/storage";
import {useEffect, useRef, useState} from "react";
import {Link, useLocation, useNavigate, useParams} from "react-router-dom";
import {useMount} from "react-use";
import {set} from "zod";

export default function RegistrationsListPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();
    const deviceBreakpoint = useDeviceBreakpoint();
    const location = useLocation();

    const [loading, setLoading] = useState<boolean>(true);
    const [isMounted, setIsMounted] = useState<boolean>(false);
    const mountedRef = useRef(false);
    const [registrations, setRegistrations] = useState<Registration[]>([]); // Replace 'any' with your actual registration type
    const [tournamentTitle, setTournamentTitle] = useState<string>();

    const refreshRegistrationsList = async () => {
        if (!tournamentId) return;

        setLoading(true);
        try {
            const tempRegistrations = await fetchRegistrations(tournamentId);
            setRegistrations(tempRegistrations);

            const tournament = await fetchTournamentById(tournamentId);
            setTournamentTitle(tournament?.name ?? "");
        } catch (error) {
            console.error("Failed to refresh registrations:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteRegistration = async (registrationId: string) => {
        if (!tournamentId) return;

        setLoading(true);
        try {
            // Here you would call your delete service function
            await deleteRegistrationById(tournamentId, registrationId);
            Message.success("Registration deleted successfully.");
            await refreshRegistrationsList();
        } catch (error) {
            console.error("Failed to delete registration:", error);
            Message.error("Failed to delete registration.");
        } finally {
            setLoading(false);
        }
    };

    const handleMount = async () => {
        setLoading(true);
        try {
            await refreshRegistrationsList();
        } finally {
            setLoading(false);
        }
    };

    useMount(() => {
        if (mountedRef.current) return;
        mountedRef.current = true;

        handleMount().finally(() => setIsMounted(true));
    });

    const columns: (TableColumnProps<(typeof registrations)[number]> | false)[] = [
        {
            title: "ID",
            dataIndex: "user_id",
            width: 200,
        },
        {
            title: "Name",
            dataIndex: "user_name",
            width: 300,
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Created At",
            dataIndex: "created_at",
            width: 200,
            render: (value: Timestamp) => value?.toDate?.().toLocaleDateString() ?? "-",
        },
        deviceBreakpoint > DeviceBreakpoint.md && {
            title: "Status",
            dataIndex: "registration_status",
            width: 200,
            render: (status: string) => {
                let color: string | undefined;
                if (status === "pending") {
                    color = "blue";
                } else if (status === "approved") {
                    color = "green";
                } else if (status === "rejected") {
                    color = "red";
                } else {
                    color = undefined;
                }
                return <Tag color={color}>{status}</Tag>;
            },
        },
        {
            title: "Action",
            dataIndex: "action",
            width: 200,
            render: (_: string, registration: Registration) => {
                return (
                    <Popconfirm
                        focusLock
                        title={"Delete tournament registration"}
                        content={
                            <div className={`flex flex-col`}>
                                <div>Are you sure want to delete this registration?</div>
                            </div>
                        }
                        onOk={(e) => {
                            handleDeleteRegistration(registration?.id ?? "");
                            e.stopPropagation();
                        }}
                        okText="Yes"
                        cancelText="No"
                        onCancel={(e) => {
                            e.stopPropagation();
                        }}
                        okButtonProps={{status: "danger"}}
                    >
                        <Button
                            title={"Delete this registration"}
                            type="secondary"
                            status="danger"
                            loading={loading}
                            icon={<IconDelete />}
                            onClick={(e) => {
                                e.stopPropagation();
                            }}
                        />
                    </Popconfirm>
                );
            },
        },
    ];

    return (
        <div
            className={`flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch `}
        >
            <Button type="outline" onClick={() => navigate("/tournaments?type=current")} className={`w-fit pt-2 pb-2`}>
                <IconUndo /> Go Back
            </Button>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={4}>{tournamentTitle}</Title>
                <Table
                    columns={columns.filter((e): e is TableColumnProps<(typeof registrations)[number]> => !!e)}
                    data={registrations}
                    pagination={{pageSize: 10}}
                    className="my-4"
                    rowKey={(record) => record.id ?? ""}
                    rowClassName={() => "cursor-pointer hover:bg-gray-50"}
                    onRow={(record) => ({
                        onClick: () => {
                            navigate(`/tournaments/${tournamentId}/registrations/${record.id}/edit`);
                        },
                    })}
                />
            </div>
        </div>
    );
}
