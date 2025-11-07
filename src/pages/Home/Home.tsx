import {Button, Card, Carousel, Empty, Grid, Image, Modal, Spin, Typography} from "@arco-design/web-react";
import {IconCalendar, IconClockCircle, IconLocation, IconTrophy} from "@arco-design/web-react/icon";
import type React from "react";
import {useEffect, useState} from "react";
import {Link} from "react-router-dom";
import type {HomeCarouselImage} from "../../schema/HomeCarouselSchema";
import type {GlobalResult, GlobalTeamResult} from "../../schema/RecordSchema";
import type {Tournament} from "../../schema/TournamentSchema";
import {getActiveCarouselImages} from "../../services/firebase/homeCarouselService";
import {getNextTournaments} from "../../services/firebase/homeTournamentService";
import {getBestRecords} from "../../services/firebase/recordService";
import {getCountryFlag} from "../../utils/countryFlags";
import {formatStackingTime} from "../../utils/time";

const {Title, Paragraph, Text} = Typography;
const {Row, Col} = Grid;

/**
 * Format date for display
 */
function formatDate(dateValue: Date | {toDate: () => Date} | null | undefined): string {
    if (!dateValue) return "TBA";
    const date = dateValue instanceof Date ? dateValue : dateValue.toDate();
    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

/**
 * Home page component with carousel, upcoming tournaments, and recent records
 */
const Home: React.FC = () => {
    const [carouselImages, setCarouselImages] = useState<HomeCarouselImage[]>([]);
    const [upcomingTournaments, setUpcomingTournaments] = useState<Tournament[]>([]);
    const [recentRecords, setRecentRecords] = useState<Array<GlobalResult | GlobalTeamResult>>([]);
    const [loading, setLoading] = useState(true);
    const [detailModalVisible, setDetailModalVisible] = useState(false);
    const [selectedImage, setSelectedImage] = useState<HomeCarouselImage | null>(null);

    useEffect(() => {
        loadHomePageData();
    }, []);

    async function loadHomePageData() {
        setLoading(true);
        try {
            const [images, tournaments, records] = await Promise.all([
                getActiveCarouselImages(),
                getNextTournaments(3),
                getBestRecords(),
            ]);

            setCarouselImages(images);
            setUpcomingTournaments(tournaments);

            // Get top individual record for each of the three events
            const topRecords: Array<GlobalResult | GlobalTeamResult> = [];
            const events: Array<"3-3-3" | "3-6-3" | "Cycle"> = ["3-3-3", "3-6-3", "Cycle"];

            for (const event of events) {
                const eventRecords = records.Individual[event] || [];
                if (eventRecords.length > 0) {
                    topRecords.push(eventRecords[0]);
                }
            }

            setRecentRecords(topRecords);
        } catch (error) {
            console.error("Failed to load home page data:", error);
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div style={{display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh"}}>
                <Spin size={40} />
            </div>
        );
    }

    return (
        <div className="flex flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-left p-6 shadow-lg rounded-lg">
                <div style={{minHeight: "100vh"}}>
                    {/* Hero Carousel */}
                    {carouselImages.length > 0 && (
                        <section style={{marginBottom: "2rem"}}>
                            <Carousel autoPlay indicatorType="dot" showArrow="hover" style={{height: "500px"}}>
                                {carouselImages.map((image) => (
                                    <div key={image.id}>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            onClick={() => {
                                                setSelectedImage(image);
                                                setDetailModalVisible(true);
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" || e.key === " ") {
                                                    e.preventDefault();
                                                    setSelectedImage(image);
                                                    setDetailModalVisible(true);
                                                }
                                            }}
                                            style={{
                                                width: "100%",
                                                height: "100%",
                                                position: "absolute",
                                                top: 0,
                                                left: 0,
                                                cursor: "pointer",
                                            }}
                                        >
                                            <img
                                                src={image.imageUrl}
                                                alt={image.title}
                                                style={{
                                                    width: "100%",
                                                    height: "100%",
                                                    objectFit: "cover",
                                                    display: "block",
                                                }}
                                            />
                                        </div>
                                        <div
                                            style={{
                                                position: "absolute",
                                                bottom: 0,
                                                left: 0,
                                                right: 0,
                                                background: "linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent)",
                                                padding: "2rem",
                                                color: "white",
                                                pointerEvents: "none",
                                            }}
                                        >
                                            <Title
                                                heading={2}
                                                style={{
                                                    color: "white",
                                                    marginBottom: "0.5rem",
                                                    textShadow: "2px 2px 4px rgba(0, 0, 0, 0.8)",
                                                }}
                                            >
                                                {image.title}
                                            </Title>
                                            {image.description && (
                                                <Paragraph
                                                    style={{
                                                        color: "rgba(255, 255, 255, 0.9)",
                                                        marginBottom: 0,
                                                        textShadow: "1px 1px 2px rgba(0, 0, 0, 0.8)",
                                                    }}
                                                >
                                                    {image.description}
                                                </Paragraph>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </Carousel>
                        </section>
                    )}

                    {/* Main Content Grid */}
                    <div style={{maxWidth: "1400px", margin: "0 auto", padding: "0 1rem 2rem"}}>
                        <Row gutter={24}>
                            {/* Upcoming Tournaments */}
                            <Col xs={24} md={12}>
                                <Card
                                    title={
                                        <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                            <IconCalendar />
                                            <span>Upcoming Tournaments</span>
                                        </div>
                                    }
                                    extra={
                                        <Link to="/tournaments">
                                            <Button type="text" size="small">
                                                View All
                                            </Button>
                                        </Link>
                                    }
                                    bordered={false}
                                    style={{height: "100%", marginBottom: "1.5rem", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)"}}
                                >
                                    {upcomingTournaments.length === 0 ? (
                                        <Empty description="No upcoming tournaments" />
                                    ) : (
                                        <div style={{display: "flex", flexDirection: "column", gap: "1rem"}}>
                                            {upcomingTournaments.map((tournament) => (
                                                <Link
                                                    to={`/tournaments/${tournament.id}/view`}
                                                    key={tournament.id}
                                                    style={{
                                                        display: "block",
                                                        padding: "1rem",
                                                        borderRadius: "8px",
                                                        background: "var(--color-bg-2)",
                                                        border: "1px solid var(--color-border-2)",
                                                        transition: "all 0.2s",
                                                        textDecoration: "none",
                                                        color: "inherit",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "flex-start",
                                                            marginBottom: "0.75rem",
                                                            gap: "1rem",
                                                        }}
                                                    >
                                                        <Title heading={5} style={{margin: 0, flex: 1}}>
                                                            {tournament.name}
                                                        </Title>
                                                        <Text
                                                            type="secondary"
                                                            style={{
                                                                flexShrink: 0,
                                                                padding: "0.25rem 0.75rem",
                                                                borderRadius: "12px",
                                                                background: "var(--color-primary-light-1)",
                                                                color: "var(--color-primary-6)",
                                                                fontSize: "0.875rem",
                                                            }}
                                                        >
                                                            {tournament.status}
                                                        </Text>
                                                    </div>
                                                    <div style={{display: "flex", flexDirection: "column", gap: "0.5rem"}}>
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "0.5rem",
                                                                color: "var(--color-text-2)",
                                                            }}
                                                        >
                                                            <IconCalendar style={{flexShrink: 0, color: "var(--color-text-3)"}} />
                                                            <Text>
                                                                {formatDate(tournament.start_date)} -{" "}
                                                                {formatDate(tournament.end_date)}
                                                            </Text>
                                                        </div>
                                                        {tournament.venue && (
                                                            <div
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    gap: "0.5rem",
                                                                    color: "var(--color-text-2)",
                                                                }}
                                                            >
                                                                <IconLocation
                                                                    style={{flexShrink: 0, color: "var(--color-text-3)"}}
                                                                />
                                                                <Text>{tournament.venue}</Text>
                                                            </div>
                                                        )}
                                                    </div>
                                                </Link>
                                            ))}
                                        </div>
                                    )}
                                </Card>
                            </Col>

                            {/* World Records */}
                            <Col xs={24} md={12}>
                                <Card
                                    title={
                                        <div style={{display: "flex", alignItems: "center", gap: "8px"}}>
                                            <IconTrophy />
                                            <span>World Records</span>
                                        </div>
                                    }
                                    extra={
                                        <Link to="/records">
                                            <Button type="text" size="small">
                                                View All
                                            </Button>
                                        </Link>
                                    }
                                    bordered={false}
                                    style={{height: "100%", marginBottom: "1.5rem", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)"}}
                                >
                                    {recentRecords.length === 0 ? (
                                        <Empty description="No records found" />
                                    ) : (
                                        <div style={{display: "flex", flexDirection: "column", gap: "1rem"}}>
                                            {recentRecords.map((record) => {
                                                const name =
                                                    "participantName" in record
                                                        ? record.participantName
                                                        : "teamName" in record
                                                          ? record.teamName
                                                          : "Unknown";
                                                return (
                                                    <div
                                                        key={record.id || record.event}
                                                        style={{
                                                            display: "flex",
                                                            gap: "1rem",
                                                            padding: "1rem",
                                                            borderRadius: "8px",
                                                            background: "var(--color-bg-2)",
                                                            border: "1px solid var(--color-border-2)",
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "0.5rem",
                                                                minWidth: "100px",
                                                            }}
                                                        >
                                                            <IconClockCircle style={{color: "var(--color-primary-6)"}} />
                                                            <Title heading={6} style={{margin: 0, fontSize: "0.875rem"}}>
                                                                {record.event}
                                                            </Title>
                                                        </div>
                                                        <div style={{flex: 1}}>
                                                            <div
                                                                style={{
                                                                    fontSize: "1.5rem",
                                                                    fontWeight: 600,
                                                                    color: "var(--color-primary-6)",
                                                                    marginBottom: "0.25rem",
                                                                }}
                                                            >
                                                                {formatStackingTime(record.time)}
                                                            </div>
                                                            <div
                                                                style={{
                                                                    display: "flex",
                                                                    alignItems: "center",
                                                                    marginBottom: "0.25rem",
                                                                }}
                                                            >
                                                                <Text>{name || "Unknown"}</Text>
                                                                {record.age && <Text type="secondary"> • Age {record.age}</Text>}
                                                            </div>
                                                            {record.country && (
                                                                <Text
                                                                    type="secondary"
                                                                    style={{
                                                                        fontSize: "0.875rem",
                                                                        display: "flex",
                                                                        alignItems: "center",
                                                                        gap: 6,
                                                                    }}
                                                                >
                                                                    {getCountryFlag(record.country) && (
                                                                        <img
                                                                            src={getCountryFlag(record.country)}
                                                                            alt={`${record.country} flag`}
                                                                            style={{width: 16, height: 12}}
                                                                        />
                                                                    )}
                                                                    {record.country}
                                                                </Text>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </Card>
                            </Col>
                        </Row>

                        {/* Benefits Section */}
                        <section style={{marginTop: "3rem", marginBottom: "3rem"}}>
                            <Title heading={3} style={{textAlign: "center", marginBottom: "2rem"}}>
                                Why Sport Stacking?
                            </Title>
                            <Row gutter={24}>
                                <Col xs={24} sm={8}>
                                    <Card
                                        bordered={false}
                                        style={{
                                            height: "100%",
                                            textAlign: "center",
                                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: "3rem",
                                                marginBottom: "1rem",
                                            }}
                                        >
                                            🎯
                                        </div>
                                        <Title heading={5} style={{marginBottom: "0.75rem"}}>
                                            Hand-Eye Coordination
                                        </Title>
                                        <Text type="secondary">
                                            Improve precision and timing through fast-paced cup stacking sequences
                                        </Text>
                                    </Card>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Card
                                        bordered={false}
                                        style={{
                                            height: "100%",
                                            textAlign: "center",
                                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: "3rem",
                                                marginBottom: "1rem",
                                            }}
                                        >
                                            🧠
                                        </div>
                                        <Title heading={5} style={{marginBottom: "0.75rem"}}>
                                            Brain Activation
                                        </Title>
                                        <Text type="secondary">
                                            Activate both left and right brain hemispheres for enhanced cognitive development
                                        </Text>
                                    </Card>
                                </Col>
                                <Col xs={24} sm={8}>
                                    <Card
                                        bordered={false}
                                        style={{
                                            height: "100%",
                                            textAlign: "center",
                                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: "3rem",
                                                marginBottom: "1rem",
                                            }}
                                        >
                                            ✋
                                        </div>
                                        <Title heading={5} style={{marginBottom: "0.75rem"}}>
                                            Fine Motor Skills
                                        </Title>
                                        <Text type="secondary">
                                            Develop dexterity and muscle control through repetitive stacking movements
                                        </Text>
                                    </Card>
                                </Col>
                            </Row>
                        </section>

                        {/* Call to Action Section */}
                        <section
                            style={{
                                marginTop: "3rem",
                                marginBottom: "3rem",
                                padding: "3rem 2rem",
                                background:
                                    "linear-gradient(135deg, var(--color-primary-light-1) 0%, var(--color-primary-light-2) 100%)",
                                borderRadius: "12px",
                                textAlign: "center",
                            }}
                        >
                            <Title heading={2} style={{marginBottom: "1rem"}}>
                                Ready to Start Stacking?
                            </Title>
                            <Paragraph
                                style={{fontSize: "1.125rem", marginBottom: "2rem", maxWidth: "600px", margin: "0 auto 2rem"}}
                            >
                                Join our community and discover the exciting world of sport stacking. Whether you're a beginner or
                                an experienced stacker, we have something for everyone!
                            </Paragraph>
                            <div style={{display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap"}}>
                                <Link to="/tournaments">
                                    <Button type="primary" size="large">
                                        View Tournaments
                                    </Button>
                                </Link>
                                <Link to="/records">
                                    <Button size="large">View Records</Button>
                                </Link>
                            </div>
                        </section>
                    </div>

                    {/* Image Detail Modal */}
                    <Modal
                        visible={detailModalVisible}
                        onCancel={() => {
                            setDetailModalVisible(false);
                            setSelectedImage(null);
                        }}
                        footer={null}
                        className={`max-w-[95vw] md:max-w-[80vw] lg:max-w-[60vw]`}
                    >
                        {selectedImage && (
                            <div>
                                <Image
                                    src={selectedImage.imageUrl}
                                    alt={selectedImage.title}
                                    preview
                                    width="100%"
                                    style={{
                                        borderRadius: "8px",
                                        marginBottom: "1rem",
                                        cursor: "pointer",
                                    }}
                                />
                                <Title heading={4} style={{marginBottom: "0.5rem"}}>
                                    {selectedImage.title}
                                </Title>
                                {selectedImage.description && (
                                    <Paragraph style={{color: "var(--color-text-2)", marginBottom: "1rem"}}>
                                        {selectedImage.description}
                                    </Paragraph>
                                )}
                                {selectedImage.link && (
                                    <Button
                                        type="primary"
                                        onClick={() => {
                                            if (selectedImage.link) {
                                                window.open(selectedImage.link, "_blank", "noopener,noreferrer");
                                            }
                                        }}
                                    >
                                        Visit Link
                                    </Button>
                                )}
                            </div>
                        )}
                    </Modal>
                </div>
            </div>
        </div>
    );
};

export default Home;
