import React, {useEffect, useState} from "react";
import {Form, Input, Button, Message, DatePicker, Typography, Select} from "@arco-design/web-react";
import {IconEmail, IconLock, IconUser} from "@arco-design/web-react/icon";
import type {SelectProps} from "@arco-design/web-react";
import dayjs from "dayjs";
import {register} from "../../services/firebase/authService";
import {useNavigate} from "react-router-dom";
import type {User} from "../../schema/UserSchema";
import {useAuthContext} from "../../context/AuthContext";

const {Title} = Typography;

type RegisterFormData = Omit<User, "id"> & {confirmPassword: string};

const countries = [
    {label: "Malaysia", value: "Malaysia"},
    {label: "Singapore", value: "Singapore"},
    {label: "Thailand", value: "Thailand"},
    {label: "Taiwan", value: "Taiwan"},
];

const statesByCountry: Record<string, SelectProps["options"]> = {
    Malaysia: [
        "Johor",
        "Kedah",
        "Kelantan",
        "Melaka",
        "Negeri Sembilan",
        "Pahang",
        "Penang (Pulau Pinang)",
        "Perak",
        "Perlis",
        "Sabah",
        "Sarawak",
        "Selangor",
        "Terengganu",
        "Kuala Lumpur",
        "Labuan",
        "Putrajaya",
    ].map((state) => ({label: state, value: state})),

    Singapore: [{label: "Singapore", value: "Singapore"}],

    Thailand: ["Bangkok", "Chiang Mai", "Chiang Rai", "Chonburi", "Khon Kaen", "Phuket", "Pattani", "Rayong", "Songkhla"].map(
        (state) => ({label: state, value: state}),
    ),

    Taiwan: [
        "Taipei",
        "New Taipei",
        "Taoyuan",
        "Taichung",
        "Tainan",
        "Kaohsiung",
        "Yilan",
        "Hsinchu County",
        "Miaoli",
        "Changhua",
        "Nantou",
        "Yunlin",
        "Chiayi County",
        "Pingtung",
        "Taitung",
        "Hualien",
        "Penghu",
        "Kinmen",
        "Lienchiang",
    ].map((state) => ({label: state, value: state})),
};

const RegisterPage = () => {
    const [loading, setLoading] = useState(false);
    const [form] = Form.useForm<RegisterFormData>();
    const navigate = useNavigate();
    const [selectedCountry, setSelectedCountry] = useState("Malaysia");
    const {user} = useAuthContext();

    useEffect(() => {
        if (user) {
            navigate("/");
        }
    }, [user, navigate]);

    const handleSubmit = async (values: RegisterFormData) => {
        const {email, password, confirmPassword, name, IC, birthdate, country, gender, state} = values;

        if (password !== confirmPassword) {
            Message.error("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            await register({
                email,
                password,
                name,
                IC,
                birthdate,
                gender,
                country,
                state,
                roles: [],
                image_url: "https://default.image",
                best_times: {},
            });

            Message.success("Registration successful!");
            navigate("/");
        } catch (err: unknown) {
            if (err instanceof Error) {
                Message.error(err.message);
            } else {
                Message.error("Something went wrong");
            }
        } finally {
            setLoading(false);
        }
    };

    const [isICMode, setIsICMode] = useState(true);

    const handleICChange = (val: string) => {
        form.setFieldValue("IC", val);
        if (!isICMode) return;

        const match = val.match(/^(\d{2})(\d{2})(\d{2})\d{6}$/);
        if (match) {
            const yy = match[1];
            const mm = match[2];
            const dd = match[3];

            const fullYear = Number(yy) >= 50 ? `19${yy}` : `20${yy}`;
            const birthdate = dayjs(`${fullYear}-${mm}-${dd}`);
            if (birthdate.isValid()) {
                form.setFieldValue("birthdate", birthdate.toDate());
            }

            const genderCode = Number(val[val.length - 1]);
            const gender = genderCode % 2 === 1 ? "Male" : "Female";
            form.setFieldValue("gender", gender);
        }
    };

    return (
        <div className="max-w-screen-md mx-auto my-10 p-6 shadow border rounded-md bg-white">
            <Title heading={3} className="text-center mb-6">
                Register Account
            </Title>

            <Form form={form} layout="vertical" onSubmit={handleSubmit} requiredSymbol={false}>
                <Form.Item field="email" label="Email" rules={[{required: true, type: "email", message: "Enter a valid email"}]}>
                    <Input prefix={<IconEmail />} placeholder="example@mail.com" />
                </Form.Item>

                <Form.Item field="name" label="Full Name" rules={[{required: true, message: "Enter your full name"}]}>
                    <Input prefix={<IconUser />} placeholder="Your full name" />
                </Form.Item>

                <Form.Item
                    field="IC"
                    label={
                        <div className="flex justify-between items-center">
                            <span>{isICMode ? "IC Number" : "Passport Number"}</span>
                            <Button
                                size="mini"
                                type="text"
                                onClick={() => {
                                    setIsICMode(!isICMode);
                                    form.setFieldValue("IC", "");
                                }}
                            >
                                Use {isICMode ? "Passport" : "IC"}
                            </Button>
                        </div>
                    }
                    rules={[
                        {
                            required: true,
                            message: `Enter your ${isICMode ? "IC" : "passport"} number`,
                        },
                        ...(isICMode
                            ? [
                                  {
                                      match: /^\d{12}$/,
                                      message: "IC must be 12 digits like 050101011234",
                                  },
                              ]
                            : []),
                    ]}
                >
                    <Input placeholder={isICMode ? "e.g. 050101011234" : "e.g. A12345678"} onChange={handleICChange} />
                </Form.Item>

                <Form.Item field="birthdate" label="Birthdate" rules={[{required: true, message: "Select your birthdate"}]}>
                    <DatePicker style={{width: "100%"}} disabledDate={(current) => current.isAfter(dayjs())} />
                </Form.Item>

                <Form.Item field="gender" label="Gender" rules={[{required: true, message: "Select gender"}]}>
                    <Select placeholder="Select gender" options={["Male", "Female"]} />
                </Form.Item>

                <Form.Item field="country" label="Country" rules={[{required: true, message: "Select country"}]}>
                    <Select
                        placeholder="Select your country"
                        options={countries}
                        value={selectedCountry}
                        onChange={(val) => {
                            setSelectedCountry(val);
                            form.setFieldValue("country", val);
                            form.setFieldValue("state", undefined);
                        }}
                    />
                </Form.Item>

                <Form.Item field="state" label="State" rules={[{required: true, message: "Select state"}]}>
                    <Select placeholder="Select your state" options={statesByCountry[selectedCountry || ""] || []} />
                </Form.Item>

                <Form.Item field="password" label="Password" rules={[{required: true, message: "Enter your password"}]}>
                    <Input.Password prefix={<IconLock />} placeholder="Create password" />
                </Form.Item>

                <Form.Item
                    field="confirmPassword"
                    label="Confirm Password"
                    rules={[{required: true, message: "Confirm your password"}]}
                >
                    <Input.Password prefix={<IconLock />} placeholder="Repeat password" />
                </Form.Item>

                <Button type="primary" htmlType="submit" long loading={loading} style={{marginTop: 16}}>
                    Register
                </Button>
            </Form>
        </div>
    );
};

export default RegisterPage;
