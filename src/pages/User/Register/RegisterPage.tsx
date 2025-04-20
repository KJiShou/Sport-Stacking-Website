import React, {useEffect, useState, useRef} from "react";
import {useLocation} from "react-router-dom";
import {Form, Input, Button, Message, DatePicker, Typography, Select, Upload} from "@arco-design/web-react";
import {IconEmail, IconLock, IconUser} from "@arco-design/web-react/icon";
import type {SelectProps} from "@arco-design/web-react";
import dayjs from "dayjs";
import {register, registerWithGoogle, logout} from "../../../services/firebase/authService";
import {useNavigate} from "react-router-dom";
import type {FirestoreUser} from "../../../schema";
import {useAuthContext} from "../../../context/AuthContext";
import {EmailAuthProvider, linkWithCredential} from "firebase/auth";
import type {User} from "firebase/auth";
import firebase from "firebase/compat/app";

const {Title} = Typography;

type RegisterFormData = Omit<FirestoreUser, "id"> & {password: string; confirmPassword: string};

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
    const {user, firebaseUser} = useAuthContext();
    const location = useLocation();
    const isFromGoogle = location.state?.fromGoogle === true;

    useEffect(() => {
        if (firebaseUser && isFromGoogle) {
            form.setFieldsValue({
                email: firebaseUser.email || "",
                image_url: firebaseUser.photoURL || "",
            });
        }
    }, [firebaseUser, isFromGoogle]);

    useEffect(() => {
        if (firebaseUser && !isFromGoogle) {
            navigate("/");
        }
    }, [firebaseUser, isFromGoogle, navigate]);

    const linkEmailPassword = async (email: string, password: string, user: User) => {
        const credential = EmailAuthProvider.credential(email, password);
        try {
            await linkWithCredential(user, credential);
        } catch (err) {
            console.error("Failed to link credentials:", err);
            throw err;
        }
    };

    const handleSubmit = async (values: RegisterFormData) => {
        const {email, password, confirmPassword, name, IC, birthdate, country, gender, state} = values;

        if (password !== confirmPassword) {
            Message.error("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            if (!(isFromGoogle && firebaseUser)) {
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
            } else {
                if (isFromGoogle && firebaseUser) {
                    await linkEmailPassword(email, password, firebaseUser);
                }
                await registerWithGoogle(firebaseUser, {
                    IC,
                    name,
                    birthdate,
                    gender,
                    country,
                    state,
                    roles: [],
                    best_times: {},
                });
            }

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
                <Form.Item noStyle field="image_url">
                    <Input type="hidden" />
                </Form.Item>

                {/* 下面这块依旧用 shouldUpdate 监听 image_url 变化 */}
                <Form.Item label="Avatar (optional)" shouldUpdate={(prev, curr) => prev.image_url !== curr.image_url}>
                    {() => {
                        const imageUrl = form.getFieldValue("image_url") as string;
                        return imageUrl ? (
                            <img src={imageUrl} alt="avatar" className="w-24 h-24 rounded-full object-cover" />
                        ) : (
                            <Upload
                                listType="picture-card"
                                accept="image/*"
                                showUploadList={false}
                                customRequest={({file, onSuccess}) => {
                                    const reader = new FileReader();
                                    reader.onload = () => {
                                        form.setFieldValue("image_url", reader.result as string);
                                        onSuccess?.();
                                    };
                                    reader.readAsDataURL(file as File);
                                }}
                            >
                                <div className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center text-sm text-gray-500">
                                    Upload
                                </div>
                            </Upload>
                        );
                    }}
                </Form.Item>
                <Form.Item field="email" label="Email" rules={[{required: true, type: "email", message: "Enter a valid email"}]}>
                    <Input
                        prefix={<IconEmail />}
                        placeholder="example@mail.com"
                        disabled={!!firebaseUser?.providerData?.[0]?.providerId?.includes("google")}
                    />
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
