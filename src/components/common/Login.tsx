import React, {useState, useEffect} from "react";
import {Form, Input, Button, Message, Modal, Typography, Link, Select} from "@arco-design/web-react";
import {IconEmail, IconLock} from "@arco-design/web-react/icon";
import {login, register, signInWithGoogle} from "../../services/firebase/authService";
import {useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import type {User} from "../../schema/UserSchema";

const {Ellipsis, Text} = Typography;

const LoginForm = ({onClose}: {onClose?: () => void}) => {
    const handleGoogleLogin = async () => {
        setLoading(true);
        try {
            await signInWithGoogle();
            Message.success("Logged in with Google");
            navigate("/");
        } catch (err: unknown) {
            if (err instanceof Error) {
                Message.error(err.message);
            } else {
                Message.error("Unexpected error.");
            }
        } finally {
            setLoading(false);
        }
    };

    const {user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (user) {
            navigate("/");
        }
    }, [user]);

    const handleLogin = async (values: {email: string; password: string}) => {
        setLoading(true);
        try {
            await login(values.email, values.password);
            Message.success("Login successful");
            navigate("/");
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

    return (
        <>
            <Form layout="vertical" requiredSymbol={false} onSubmit={handleLogin}>
                <Form.Item field="email" rules={[{required: true, message: "Please enter your email"}]} label="Email">
                    <Input prefix={<IconEmail />} placeholder="example@mail.com" autoComplete="email" />
                </Form.Item>

                <Form.Item field="password" rules={[{required: true, message: "Please enter your password"}]} label="Password">
                    <Input.Password prefix={<IconLock />} placeholder="Your password" autoComplete="current-password" />
                </Form.Item>

                <Button htmlType="submit" type="primary" long loading={loading} style={{marginTop: 8}}>
                    Log In
                </Button>
                <Button
                    type="secondary"
                    long
                    onClick={handleGoogleLogin}
                    className="mt-4 flex items-center justify-center gap-x-2"
                >
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
        </>
    );
};

export default LoginForm;
