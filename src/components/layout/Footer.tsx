import {Grid, Typography} from "@arco-design/web-react";
import {IconEmail, IconFacebook, IconLocation, IconPhone} from "@arco-design/web-react/icon";
import type * as React from "react";

const {Title, Text, Paragraph} = Typography;
const {Row, Col} = Grid;

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
                <Row gutter={[24, 24]}>
                    {/* Visit Section */}
                    <Col xs={24} sm={12} md={6}>
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
                    <Col xs={24} sm={12} md={6}>
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

                    {/* Email Section */}
                    <Col xs={24} sm={12} md={6}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconEmail style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Email
                                </Title>
                                <Paragraph style={{color: "#000000", margin: 0}}>
                                    <a href="mailto:jjclub.info@gmail.com" style={{color: "#000000", textDecoration: "none"}}>
                                        jjclub.info@gmail.com
                                    </a>
                                </Paragraph>
                            </div>
                        </div>
                    </Col>

                    {/* Follow Us Section */}
                    <Col xs={24} sm={12} md={6}>
                        <div style={{display: "flex", gap: "1rem", alignItems: "flex-start"}}>
                            <div>
                                <IconFacebook style={{fontSize: "2rem", marginTop: "0.25rem", flexShrink: 0}} />
                                <Title heading={6} style={{color: "#000000", marginBottom: "0.5rem"}}>
                                    Follow Us
                                </Title>
                                <a
                                    href="https://www.facebook.com/issfmy"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: "#000000",
                                        textDecoration: "none",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                    }}
                                >
                                    <Text style={{color: "#000000"}}>Facebook Page</Text>
                                </a>
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
