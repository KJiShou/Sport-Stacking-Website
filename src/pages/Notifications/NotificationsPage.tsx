import {useAuthContext} from "@/context/AuthContext";
import type {UserNotification} from "@/schema";
import {markNotificationRead, subscribeNotificationsForGlobalIds} from "@/services/firebase/notificationService";
import {Button, Card, Message, Result, Spin, Typography} from "@arco-design/web-react";
import dayjs from "dayjs";
import {useEffect, useMemo, useState} from "react";

const {Title, Paragraph, Text} = Typography;

export default function NotificationsPage() {
    const {firebaseUser, profiles} = useAuthContext();
    const [notifications, setNotifications] = useState<UserNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [markingId, setMarkingId] = useState<string | null>(null);
    const globalIds = useMemo(
        () => profiles.map((profile) => profile.global_id?.trim()).filter((value): value is string => Boolean(value)),
        [profiles],
    );

    useEffect(() => {
        setLoading(true);
        const unsubscribe = subscribeNotificationsForGlobalIds(globalIds, (items) => {
            setNotifications(items);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [globalIds]);

    if (!firebaseUser) {
        return <Result status="403" title="Sign In Required" subTitle="Please sign in to see your notifications." />;
    }

    const handleOpen = async (notification: UserNotification) => {
        setMarkingId(notification.id);
        try {
            if (notification.status === "unread") {
                await markNotificationRead(notification.id);
            }
            if (notification.action_url) {
                window.location.assign(notification.action_url);
            }
        } catch (error) {
            console.error("Failed to update notification:", error);
            Message.error("Failed to update notification.");
        } finally {
            setMarkingId(null);
        }
    };

    return (
        <div className="flex flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 p-4 md:p-6 xl:p-8 shadow-lg md:rounded-lg">
                <Title heading={4} style={{marginBottom: 0}}>
                    Notifications
                </Title>
                <Spin loading={loading}>
                    {notifications.length === 0 ? (
                        <Result status="success" title="No Notifications" subTitle="You are all caught up." />
                    ) : (
                        <div className="grid grid-cols-1 gap-4">
                            {notifications.map((notification) => {
                                const createdAt =
                                    notification.created_at instanceof Date
                                        ? notification.created_at
                                        : (notification.created_at?.toDate?.() ?? null);
                                return (
                                    <Card
                                        key={notification.id}
                                        title={notification.title}
                                        style={
                                            notification.status === "unread" ? {borderColor: "rgb(var(--primary-6))"} : undefined
                                        }
                                    >
                                        <div className="flex flex-col gap-2">
                                            <Paragraph>{notification.message}</Paragraph>
                                            <Text type="secondary">
                                                {createdAt ? dayjs(createdAt).format("YYYY-MM-DD HH:mm") : ""}
                                            </Text>
                                            <div>
                                                <Button
                                                    type={notification.status === "unread" ? "primary" : "outline"}
                                                    loading={markingId === notification.id}
                                                    onClick={() => void handleOpen(notification)}
                                                >
                                                    {notification.action_url ? "Open" : "Mark as read"}
                                                </Button>
                                            </div>
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </Spin>
            </div>
        </div>
    );
}
