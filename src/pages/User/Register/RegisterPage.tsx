import {Button, DatePicker, Form, Input, Message, Select, Typography, Upload, Cascader, Avatar} from "@arco-design/web-react";
import {IconEmail, IconLock, IconUser, IconCamera} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import type {User} from "firebase/auth";
import {EmailAuthProvider, linkWithCredential} from "firebase/auth";
import {doc, getDoc} from "firebase/firestore";
import {useEffect, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../../context/AuthContext";
import type {FirestoreUser} from "../../../schema";
import {register, registerWithGoogle} from "../../../services/firebase/authService";
import {db} from "../../../services/firebase/config";
import {uploadAvatar} from "../../../services/firebase/storageService";
import {countries} from "../../../schema/Country";

const {Title} = Typography;

type RegisterFormData = Omit<FirestoreUser, "id"> & {password: string; confirmPassword: string};

const RegisterPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {user, firebaseUser, setUser} = useAuthContext();
    const [form] = Form.useForm<RegisterFormData>();
    const [loading, setLoading] = useState(false);
    const [isICMode, setIsICMode] = useState(true);

    const isFromGoogle = location.state?.fromGoogle === true;

    const linkEmailPassword = async (email: string, password: string, user: User) => {
        const credential = EmailAuthProvider.credential(email, password);
        try {
            await linkWithCredential(user, credential);
        } catch (err) {
            console.error("Failed to link credentials:", err);
            throw err;
        }
    };

    const handleICChange = (val: string) => {
        form.setFieldValue("IC", val);
        if (!isICMode) return;

        const match = RegExp(/^(\d{2})(\d{2})(\d{2})\d{6}$/).exec(val);
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

    const handleSubmit = async (values: RegisterFormData) => {
        const {email, password, confirmPassword, name, IC, birthdate, country, gender, image_url, organizer} = values;
        let avatarUrl = firebaseUser?.photoURL ?? "";
        if (password !== confirmPassword) {
            Message.error("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            if (image_url?.startsWith("data:")) {
                const blob = await (await fetch(image_url)).blob();

                const file = new File([blob], "avatar.png", {
                    type: blob.type ?? "image/png",
                });

                avatarUrl = await uploadAvatar(file, firebaseUser?.uid ?? email);
            }
            if (!(isFromGoogle && firebaseUser)) {
                await register({
                    email,
                    password,
                    name,
                    IC,
                    birthdate,
                    gender,
                    country,
                    organizer,
                    roles: null,
                    image_url: avatarUrl || "",
                    best_times: {},
                });
            } else if (isFromGoogle && firebaseUser) {
                await registerWithGoogle(
                    firebaseUser,
                    {
                        IC,
                        name,
                        birthdate,
                        gender,
                        country,
                        organizer,
                        roles: null,
                        best_times: {},
                    },
                    avatarUrl,
                );
                await linkEmailPassword(email, password, firebaseUser);
                const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                if (userDoc.exists()) {
                    setUser(userDoc.data() as FirestoreUser);
                }
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

    useEffect(() => {
        if (isFromGoogle && firebaseUser?.photoURL) {
            form.setFieldValue("image_url", firebaseUser.photoURL);
            form.setFieldValue("email", firebaseUser.email ?? "");
        }
    }, [isFromGoogle, firebaseUser, form]);

    useEffect(() => {
        if (firebaseUser && !isFromGoogle) {
            navigate("/");
        }
    }, [firebaseUser, isFromGoogle, navigate]);

    return (
        <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10`}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={3} className="text-center mb-6">
                    Register Account
                </Title>

                <Form form={form} layout="vertical" onSubmit={handleSubmit} requiredSymbol={false}>
                    <Form.Item noStyle field="image_url">
                        <Input type="hidden" />
                    </Form.Item>

                    <Form.Item
                        className="flex flex-col items-center gap-2"
                        label="Avatar (optional)"
                        shouldUpdate={(prev, curr) => prev.image_url !== curr.image_url}
                    >
                        {() => {
                            const imageUrl = form.getFieldValue("image_url");

                            return (
                                <div className="flex flex-col items-center gap-2">
                                    <Upload
                                        listType="picture-card"
                                        accept="image/*"
                                        showUploadList={false}
                                        customRequest={({file, onSuccess}) => {
                                            const MAX_SIZE = 10 * 1024 * 1024;

                                            if (file.size > MAX_SIZE) {
                                                // 100MB

                                                Message.error("File size exceeds 10MB limit");
                                                return;
                                            }

                                            const reader = new FileReader();
                                            reader.onload = () => {
                                                form.setFieldValue("image_url", reader.result as string);
                                                onSuccess?.();
                                            };
                                            reader.readAsDataURL(file);
                                        }}
                                    >
                                        <div className="relative inline-block">
                                            <Avatar
                                                size={100}
                                                className="mx-auto w-24 h-24 rounded-full overflow-hidden"
                                                triggerIcon={<IconCamera />}
                                                triggerType="mask"
                                            >
                                                <img
                                                    className="w-full h-full object-cover"
                                                    src={imageUrl as string}
                                                    alt={user?.name}
                                                />
                                            </Avatar>
                                        </div>
                                    </Upload>

                                    {firebaseUser?.photoURL && (
                                        <Button
                                            size="mini"
                                            type="text"
                                            onClick={() => {
                                                form.setFieldValue("image_url", firebaseUser.photoURL as string);
                                            }}
                                        >
                                            Reset to Google Avatar
                                        </Button>
                                    )}
                                </div>
                            );
                        }}
                    </Form.Item>

                    <Form.Item
                        field="email"
                        label="Email"
                        rules={[{required: true, type: "email", message: "Enter a valid email"}]}
                    >
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

                    <Form.Item
                        label="Country / State"
                        field="country"
                        rules={[{required: true, message: "Please select a country/region"}]}
                    >
                        <Cascader
                            showSearch
                            changeOnSelect
                            allowClear
                            filterOption={(input, node) => {
                                return node.label.toLowerCase().includes(input.toLowerCase());
                            }}
                            options={countries}
                            placeholder="Please select location"
                            expandTrigger="hover"
                            value={user?.country}
                        />
                    </Form.Item>

                    <Form.Item
                        label="Organizer"
                        field="organizer"
                        rules={[{required: true, message: "Please enter the organizer name"}]}
                    >
                        <Input placeholder="Enter organizer name" />
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
        </div>
    );
};

export default RegisterPage;
