import React, {useState} from "react";
import {Form, Input, Button, Message} from "@arco-design/web-react";
import {IconEmail, IconLock} from "@arco-design/web-react/icon";
import {login} from "../../services/firebase/authService";
import {useNavigate} from "react-router-dom";

const LoginForm = () => {
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (values: {email: string; password: string}) => {
        setLoading(true);
        try {
            await login(values.email, values.password);
            Message.success("✅ Login successful");
            navigate("/dashboard");
        } catch (err: unknown) {
            if (err instanceof Error) {
                console.error("Error:", err.message);
            } else {
                console.error("Unknown error", err);
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <Form layout="vertical" requiredSymbol={{position: "end"}} onSubmit={handleSubmit}>
            <Form.Item field="email" rules={[{message: "Please enter your email"}]} label="Email">
                <Input prefix={<IconEmail />} placeholder="example@mail.com" autoComplete="email" />
            </Form.Item>

            <Form.Item field="password" rules={[{message: "Please enter your password"}]} label="Password">
                <Input.Password prefix={<IconLock />} placeholder="Your password" autoComplete="current-password" />
            </Form.Item>

            <Button htmlType="submit" type="primary" long loading={loading} style={{marginTop: 8}}>
                Log In
            </Button>
        </Form>
    );
};

export default LoginForm;
