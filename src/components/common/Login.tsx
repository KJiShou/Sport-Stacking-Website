import {Button, Form, Input, Link, Message, Typography} from "@arco-design/web-react";
import {IconEmail, IconLock} from "@arco-design/web-react/icon";
import {doc, getDoc} from "firebase/firestore";
import React, {useRef, useState, useEffect} from "react";
import {useLocation, useNavigate} from "react-router-dom";
import {useAuthContext} from "../../context/AuthContext";
import {login, signInWithGoogle} from "../../services/firebase/authService";
import {db} from "../../services/firebase/config";

const {Text} = Typography;

const LoginForm = ({onClose, redirectTo}: {onClose?: () => void; redirectTo?: string}) => {
    const {firebaseUser, user} = useAuthContext();
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const nextPath = redirectTo ?? "/";
    const onCloseRef = useRef(onClose);
    const hasRedirectedRef = useRef(false);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!firebaseUser || !user) {
            hasRedirectedRef.current = false;
            return;
        }

        if (hasRedirectedRef.current) {
            return;
        }

        hasRedirectedRef.current = true;
        onCloseRef.current?.();

        if (redirectTo && redirectTo !== location.pathname) {
            navigate(nextPath, {replace: true});
        }
    }, [firebaseUser, user, navigate, nextPath, redirectTo, location.pathname]);

    const handleLogin = async (values: {email: string; password: string}) => {
        setLoading(true);
        try {
            await login(values.email, values.password);
            Message.success("Login successful. You are now signed in.");
            if (onClose) onClose();
            if (redirectTo && redirectTo !== location.pathname) {
                navigate(redirectTo, {replace: true});
            }
        } catch (err: unknown) {
            const message = getLoginErrorMessage(err);
            console.error("Login error:", err);
            Message.error(message);
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
                Message.success("Google sign-in successful. You are now signed in.");
                if (redirectTo && redirectTo !== location.pathname) {
                    navigate(redirectTo, {replace: true});
                }
                if (onClose) onClose();
            } else {
                Message.info("Sign-in complete. Please finish registration to continue.");
                navigate("/register", {
                    state: {
                        email: result.user.email ?? "",
                        fromGoogle: true,
                    },
                });
                if (onClose) onClose();
            }
        } catch (err: unknown) {
            const message = getLoginErrorMessage(err);
            console.error("Google sign-in error:", err);
            Message.error(message);
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

const getLoginErrorMessage = (error: unknown): string => {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    switch (code) {
        case "auth/invalid-credential":
        case "auth/wrong-password":
            return "Incorrect email or password. Please try again.";
        case "auth/user-not-found":
            return "No account found with this email. Please register first.";
        case "auth/too-many-requests":
            return "Too many attempts. Please try again later.";
        case "auth/network-request-failed":
            return "Network error. Please check your connection and try again.";
        case "auth/popup-closed-by-user":
            return "Sign-in was canceled. Please try again.";
        default: {
            if (error instanceof Error && error.message) {
                return error.message;
            }
            return "Sign-in failed. Please try again.";
        }
    }
};

export default LoginForm;
