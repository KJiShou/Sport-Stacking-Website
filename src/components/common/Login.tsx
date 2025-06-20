import {Button, Form, Input, Link, Message, Typography} from "@arco-design/web-react";
import {IconEmail, IconLock} from "@arco-design/web-react/icon";
import {doc, getDoc} from "firebase/firestore";
import React, {useState, useEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {login, signInWithGoogle} from "../../services/firebase/authService";
import {db} from "../../services/firebase/config";

const {Text} = Typography;

const LoginForm = ({onClose}: {onClose?: () => void}) => {
    const {firebaseUser} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        if (firebaseUser) {
            if (onClose) onClose();
            navigate("/");
        }
    }, [firebaseUser]);

    const handleLogin = async (values: {email: string; password: string}) => {
        setLoading(true);
        try {
            await login(values.email, values.password);
            Message.success("Login successful");
            if (onClose) onClose();
            navigate(`${location.pathname}`);
        } catch (err: unknown) {
            if (err instanceof Error) {
                console.error("Error:", err.message);
                Message.error(err.message);
            } else {
                console.error("Unknown error", err);
            }
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleLogin = async () => {
        setLoading(true);
        try {
            const result = await signInWithGoogle();
            const uid = result.user.uid;

            // Check if Firestore user exists
            const userRef = doc(db, "users", uid);
            const userSnap = await getDoc(userRef);

            if (userSnap.exists()) {
                Message.success("Logged in with Google");
                navigate(`${location.pathname}`);
                if (onClose) onClose();
            } else {
                Message.info("Please complete your registration");
                navigate("/register", {
                    state: {
                        email: result.user.email ?? "",
                        fromGoogle: true,
                    },
                });
                if (onClose) onClose();
            }
        } catch (err: unknown) {
            Message.error(err instanceof Error ? err.message : "Unexpected error.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <Form layout="vertical" requiredSymbol={false} onSubmit={handleLogin}>
            <Form.Item field="email" rules={[{required: true, message: "Please enter your email"}]} label="Email">
                <Input prefix={<IconEmail />} placeholder="example@mail.com" autoComplete="email" />
            </Form.Item>

            <Form.Item field="password" rules={[{required: true, message: "Please enter your password"}]} label="Password">
                <Input.Password prefix={<IconLock />} placeholder="Your password" autoComplete="current-password" />
            </Form.Item>
            <div className="text-right mt-2">
                <Link
                    onClick={() => {
                        if (onClose) onClose();
                        navigate("/forgot-password");
                    }}
                >
                    Forgot password?
                </Link>
            </div>

            <Button htmlType="submit" type="primary" long loading={loading} style={{marginTop: 8}}>
                Log In
            </Button>

            <Button type="secondary" long onClick={handleGoogleLogin} className="mt-4 flex items-center justify-center gap-x-2">
                <img src="https://www.svgrepo.com/show/475656/google-color.svg" alt="Google" className="w-5 h-5" />
                <span>Sign in with Google</span>
            </Button>

            <div className="text-right mt-2">
                <Text>
                    No account?{" "}
                    <Link
                        onClick={() => {
                            if (onClose) onClose();
                            navigate("/register");
                        }}
                    >
                        Register
                    </Link>
                </Text>
            </div>
        </Form>
    );
};

export default LoginForm;
