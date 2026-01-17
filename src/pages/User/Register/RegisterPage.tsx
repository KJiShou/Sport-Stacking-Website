import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser} from "@/schema";
import {countries} from "@/schema/Country";
import {cacheGoogleAvatar, registerWithGoogle, signInWithGoogle} from "@/services/firebase/authService";
import {db} from "@/services/firebase/config";
import {uploadAvatar} from "@/services/firebase/storageService";
import {
    Avatar,
    Button,
    Cascader,
    DatePicker,
    Form,
    Input,
    Message,
    Select,
    Tooltip,
    Typography,
    Upload,
} from "@arco-design/web-react";
import {IconCamera, IconEmail, IconExclamationCircle, IconLock, IconPhone, IconUser} from "@arco-design/web-react/icon";
import dayjs from "dayjs";
import type {User} from "firebase/auth";
import {EmailAuthProvider, linkWithCredential} from "firebase/auth";
import {doc, getDoc} from "firebase/firestore";
import {useEffect, useRef, useState} from "react";
import {useLocation, useNavigate} from "react-router-dom";

const {Title} = Typography;

type RegisterFormData = Omit<FirestoreUser, "id"> & {password: string; confirmPassword: string};

const RegisterPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const {user, firebaseUser, setUser} = useAuthContext();
    const [form] = Form.useForm<RegisterFormData>();
    const [loading, setLoading] = useState(false);
    const [isICMode, setIsICMode] = useState(true);
    const avatarRetryRef = useRef(0);

    const isFromGoogle = location.state?.fromGoogle === true;
    const isGoogleAuth = Boolean(
        isFromGoogle || firebaseUser?.providerData?.some((provider) => provider.providerId === "google.com"),
    );

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
        const {email, password, confirmPassword, name, IC, birthdate, country, gender, image_url, school, phone_number} = values;
        let avatarUrl = "";
        if ((password || confirmPassword) && password !== confirmPassword) {
            Message.error("Passwords do not match");
            return;
        }

        try {
            if (!isGoogleAuth || !firebaseUser) {
                Message.error("Please sign in with Google before registering.");
                return;
            }

            setLoading(true);

            // If user uploaded an avatar (data URL), upload it to storage
            if (image_url?.startsWith("data:")) {
                const blob = await (await fetch(image_url)).blob();
                const file = new File([blob], "avatar.png", {
                    type: blob.type ?? "image/png",
                });
                avatarUrl = await uploadAvatar(file, firebaseUser.uid);
            } else if (isGoogleAuth && firebaseUser.photoURL) {
                // Already uploaded in useEffect, just use the form value
                avatarUrl = image_url;
            } else if (image_url) {
                avatarUrl = image_url;
            }

            await registerWithGoogle(
                firebaseUser,
                {
                    IC,
                    name,
                    birthdate,
                    gender,
                    country,
                    school: school || "",
                    phone_number,
                    roles: null,
                    best_times: {},
                },
                avatarUrl,
            );
            if (password && confirmPassword && password === confirmPassword) {
                await linkEmailPassword(email, password, firebaseUser);
            }
            const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
            if (userDoc.exists()) {
                setUser(userDoc.data() as FirestoreUser);
            }
            Message.success("Registration successful!");
            navigate("/", {replace: true});
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
        const fetchAndUploadGoogleAvatar = async () => {
            if (!isGoogleAuth || !firebaseUser) {
                return;
            }

            form.setFieldValue("email", firebaseUser.email ?? "");

            if (firebaseUser.photoURL) {
                try {
                    const uploadedUrl = await cacheGoogleAvatar(firebaseUser.photoURL);
                    form.setFieldValue("image_url", uploadedUrl);
                    avatarRetryRef.current = 0;
                } catch (err) {
                    form.setFieldValue("image_url", "");
                }
            }
        };
        fetchAndUploadGoogleAvatar();
    }, [isGoogleAuth, firebaseUser, form]);

    const handleResetAvatar = async () => {
        if (firebaseUser?.photoURL) {
            try {
                const uploadedUrl = await cacheGoogleAvatar(firebaseUser.photoURL);
                form.setFieldValue("image_url", uploadedUrl);
                avatarRetryRef.current = 0;
                return;
            } catch (err) {
                form.setFieldValue("image_url", "");
                return;
            }
        }
        form.setFieldValue("image_url", "");
    };

    const handleAvatarError = async () => {
        if (avatarRetryRef.current >= 1) {
            form.setFieldValue("image_url", "");
            return;
        }
        avatarRetryRef.current += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        await handleResetAvatar();
    };

    useEffect(() => {
        if (firebaseUser && user) {
            navigate("/", {replace: true});
        }
    }, [firebaseUser, user, navigate]);

    return (
        <div className={`flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10`}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={3} className="text-center mb-6">
                    <div>
                        Register Participant Account
                        <Tooltip content="Register for the participant account to participate in the event">
                            <IconExclamationCircle style={{margin: "0 8px", color: "rgb(var(--arcoblue-6))"}} />
                        </Tooltip>
                    </div>
                </Title>

                {!isGoogleAuth || !firebaseUser ? (
                    <div className="flex flex-col items-center gap-4 w-full max-w-xl">
                        <p className="text-center text-gray-600">
                            Please sign in with Google to start your registration, then complete your participant details.
                        </p>
                        <Button
                            type="primary"
                            long
                            loading={loading}
                            onClick={async () => {
                                setLoading(true);
                                try {
                                    const result = await signInWithGoogle();
                                    const userDoc = await getDoc(doc(db, "users", result.user.uid));
                                    if (userDoc.exists()) {
                                        Message.success("Account already registered. You're now logged in.");
                                        setUser(userDoc.data() as FirestoreUser);
                                        navigate("/", {replace: true});
                                    }
                                } catch (err) {
                                    Message.error(err instanceof Error ? err.message : "Failed to sign in with Google.");
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            className="flex items-center justify-center gap-x-2"
                        >
                            <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google logo" className="w-5 h-5" />
                            <span>Continue with Google</span>
                        </Button>
                    </div>
                ) : (
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
                                            accept="image/jpeg,image/png,image/gif"
                                            showUploadList={false}
                                            customRequest={({file, onSuccess, onError}) => {
                                                const MAX_SIZE = 10 * 1024 * 1024; // 10MB
                                                const validTypes = ["image/jpeg", "image/png", "image/gif"];

                                                if (!validTypes.includes(file.type)) {
                                                    Message.error("Invalid file type. Please upload a JPG, PNG, or GIF.");
                                                    onError?.(new Error("Invalid file type"));
                                                    return;
                                                }

                                                if (file.size > MAX_SIZE) {
                                                    Message.error("File size exceeds 10MB limit");
                                                    onError?.(new Error("File size exceeds 10MB limit"));
                                                    return;
                                                }

                                                const reader = new FileReader();
                                                reader.onload = () => {
                                                    form.setFieldValue("image_url", reader.result as string);
                                                    onSuccess?.();
                                                };
                                                reader.onerror = () => {
                                                    Message.error("Failed to read file.");
                                                    onError?.(new Error("Failed to read file."));
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
                                                    {imageUrl ? (
                                                        <img
                                                            className="w-full h-full object-cover"
                                                            src={imageUrl as string}
                                                            alt={user?.name}
                                                            onError={handleAvatarError}
                                                        />
                                                    ) : (
                                                        <IconUser />
                                                    )}
                                                </Avatar>
                                            </div>
                                        </Upload>

                                        {firebaseUser && (
                                            <Button
                                                size="mini"
                                                type="text"
                                                onClick={() => {
                                                    handleResetAvatar();
                                                }}
                                            >
                                                Reset Avatar
                                            </Button>
                                        )}
                                    </div>
                                );
                            }}
                        </Form.Item>

                        <Form.Item
                            field="email"
                            label="Participant Email"
                            rules={[{required: true, type: "email", message: "Enter a valid email"}]}
                        >
                            <Input prefix={<IconEmail />} placeholder="example@mail.com" disabled={isGoogleAuth} />
                        </Form.Item>

                        <Form.Item
                            field="name"
                            label="Participant Full Name"
                            rules={[{required: true, message: "Enter your full name"}]}
                        >
                            <Input prefix={<IconUser />} placeholder="Your full name" />
                        </Form.Item>

                        <Form.Item
                            field="IC"
                            label={
                                <div className="flex justify-between items-center">
                                    <span>{isICMode ? "Participant IC Number" : "Participant Passport Number"}</span>
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

                        <Form.Item
                            field="birthdate"
                            label="Participant Birthdate"
                            rules={[{required: true, message: "Select your birthdate"}]}
                        >
                            <DatePicker style={{width: "100%"}} disabledDate={(current) => current.isAfter(dayjs())} />
                        </Form.Item>

                        <Form.Item field="gender" label="Participant Gender" rules={[{required: true, message: "Select gender"}]}>
                            <Select placeholder="Select gender" options={["Male", "Female"]} />
                        </Form.Item>

                        <Form.Item
                            field="phone_number"
                            label="Phone Number"
                            rules={[{required: true, message: "Enter your phone number"}]}
                        >
                            <Input prefix={<IconPhone />} placeholder="Your phone number" />
                        </Form.Item>

                        <Form.Item
                            label="Participant Country / State"
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

                        <Form.Item label="Participant School/University/College" field="school">
                            <Input placeholder="Enter School/University/College name" />
                        </Form.Item>

                        <Form.Item field="password" label="Password (optional)" rules={[]}>
                            <Input.Password prefix={<IconLock />} placeholder="Create password (optional)" />
                        </Form.Item>

                        <Form.Item
                            field="confirmPassword"
                            label="Confirm Password (optional)"
                            rules={[]}
                        >
                            <Input.Password prefix={<IconLock />} placeholder="Repeat password (optional)" />
                        </Form.Item>

                        <Button type="primary" htmlType="submit" long loading={loading} style={{marginTop: 16}}>
                            Register
                        </Button>
                    </Form>
                )}
            </div>
        </div>
    );
};

export default RegisterPage;
