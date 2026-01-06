import {Grid, Link, Typography} from "@arco-design/web-react";
import {IconEmail, IconFacebook, IconLocation, IconPhone} from "@arco-design/web-react/icon";
import type * as React from "react";

const {Title, Text, Paragraph} = Typography;
const {Row, Col} = Grid;

const WhatsAppIcon: React.FC = () => (
    <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{marginTop: "0.25rem", flexShrink: 0}}
    >
        <path
            d="M16 2.667C8.636 2.667 2.667 8.636 2.667 16c0 2.773.813 5.386 2.357 7.647L4 29.333l5.838-1.906A13.29 13.29 0 0 0 16 29.333c7.364 0 13.333-5.969 13.333-13.333C29.333 8.636 23.364 2.667 16 2.667Z"
            fill="#25D366"
        />
        <path
            d="M23.17 18.828c-.35-.175-2.073-1.024-2.395-1.143-.322-.117-.557-.175-.792.176-.233.35-.909 1.143-1.114 1.376-.205.235-.409.263-.76.088-.35-.175-1.479-.546-2.82-1.741-1.043-.93-1.746-2.08-1.951-2.43-.205-.35-.022-.538.154-.712.158-.157.35-.409.526-.613.176-.205.234-.35.35-.585.117-.234.058-.439-.03-.613-.088-.175-.792-1.91-1.085-2.616-.286-.688-.578-.594-.792-.604l-.675-.013c-.234 0-.613.088-.935.439s-1.23 1.2-1.23 2.925c0 1.725 1.26 3.39 1.437 3.624.175.233 2.48 3.783 6.01 5.154.84.363 1.496.58 2.005.744.842.268 1.61.23 2.216.14.676-.101 2.073-.85 2.366-1.67.292-.819.292-1.52.205-1.67-.088-.146-.322-.233-.672-.408Z"
            fill="#fff"
        />
    </svg>
);

const Footer: React.FC = () => {
    return (
        <footer
            className="bg-white "
            style={{
                color: "#000000",
                padding: "3rem 2rem 1.5rem",
            }}
        >
            <div style={{maxWidth: "1400px", margin: "0 auto"}}>
                <Row gutter={[16, 24]} justify="space-between">
                    {/* Visit Section */}
                    <Col xs={24} sm={12} md={4}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconLocation style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Visit
                                </Title>
                                <Paragraph style={{color: "#000000", margin: 0, lineHeight: 1.6}}>
                                    128, 1st Floor, Plaza Serdang Raya, Jln Serdang Raya, Tmn Serdang Raya, 43300 Seri Kembangan,
                                    Selangor
                                    <br />
                                    Malaysia
                                </Paragraph>
                            </div>
                        </div>
                    </Col>

                    {/* Call Section */}
                    <Col xs={24} sm={12} md={4}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconPhone style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Call
                                </Title>
                                <Paragraph style={{color: "#000000", margin: 0, lineHeight: 1.6}}>
                                    T: +6012-2099116 or
                                    <br />
                                    +6012-2011364
                                </Paragraph>
                            </div>
                        </div>
                    </Col>

                    {/* WhatsApp Section */}
                    <Col xs={24} sm={12} md={4}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <WhatsAppIcon />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    WhatsApp
                                </Title>
                                <Link href="https://wa.link/gukxyp" target="_blank" rel="noopener noreferrer">
                                    Chat with us
                                </Link>
                            </div>
                        </div>
                    </Col>

                    {/* Email Section */}
                    <Col xs={24} sm={12} md={4}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconEmail style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Email
                                </Title>
                                <Link style={{margin: 0}}>
                                    <a href="mailto:jjclub.info@gmail.com">jjclub.info@gmail.com</a>
                                </Link>
                            </div>
                        </div>
                    </Col>

                    {/* Follow Us Section */}
                    <Col xs={24} sm={12} md={4}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconFacebook style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Follow Us
                                </Title>
                                <Link href="https://www.facebook.com/issfmy" target="_blank" rel="noopener noreferrer">
                                    Facebook Page
                                </Link>
                            </div>
                        </div>
                    </Col>
                </Row>

                {/* Copyright Section */}
                <div
                    style={{
                        borderTop: "1px solid #444",
                        marginTop: "2rem",
                        paddingTop: "1.5rem",
                        textAlign: "center",
                    }}
                >
                    <Text style={{color: "#000000"}}>© 2025 by J&J Stacking Centre</Text>
                </div>
            </div>
        </footer>
    );
};

export default Footer;
