import {useAuthContext} from "@/context/AuthContext";
import type {UserNotification} from "@/schema";
import {markNotificationRead, subscribeNotificationsForGlobalIds} from "@/services/firebase/notificationService";
import {Button, Card, Message, Result, Spin, Tag, Typography} from "@arco-design/web-react";
import dayjs from "dayjs";
import {useEffect, useMemo, useState} from "react";
import {MobilePageHeader} from "@/components/responsive";

const {Paragraph, Text} = Typography;

export default function NotificationsPage() {
    const {firebaseUser, profiles} = useAuthContext();
    const [notifications, setNotifications] = useState<UserNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [markingId, setMarkingId] = useState<string | null>(null);
    const [expandedId, setExpandedId] = useState<string | null>(null);
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
                <MobilePageHeader title="Notifications" />
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
                                        className="notification-card"
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`Open notification: ${notification.title}`}
                                        onClick={(event) => {
                                            if ((event.target as HTMLElement).closest("button, a")) {
                                                return;
                                            }
                                            void handleOpen(notification);
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                void handleOpen(notification);
                                            }
                                        }}
                                        style={
                                            notification.status === "unread" ? {borderColor: "rgb(var(--primary-6))"} : undefined
                                        }
                                    >
                                        <div className="flex flex-col gap-2">
                                            <div className="notification-meta">
                                                {notification.status === "unread" ? (
                                                    <Tag color="arcoblue">Unread</Tag>
                                                ) : (
                                                    <Tag>Read</Tag>
                                                )}
                                                <Text type="secondary">
                                                    {createdAt ? dayjs(createdAt).format("YYYY-MM-DD HH:mm") : ""}
                                                </Text>
                                            </div>
                                            <Paragraph
                                                className={`mobile-card-content ${expandedId === notification.id ? "" : "notification-message"}`}
                                            >
                                                {notification.message}
                                            </Paragraph>
                                            {notification.message.length > 160 ? (
                                                <Button
                                                    type="text"
                                                    className="notification-expand"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        setExpandedId((current) =>
                                                            current === notification.id ? null : notification.id,
                                                        );
                                                    }}
                                                >
                                                    {expandedId === notification.id ? "Show less" : "Read more"}
                                                </Button>
                                            ) : null}
                                            <div className="notification-actions">
                                                <Button
                                                    type={notification.status === "unread" ? "primary" : "outline"}
                                                    loading={markingId === notification.id}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void handleOpen(notification);
                                                    }}
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
