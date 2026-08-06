import {requestPasswordResetEmail} from "@/services/firebase/authService";
import {Button, Form, Input, Message} from "@arco-design/web-react";
import {IconEmail} from "@arco-design/web-react/icon";
import {useNavigate} from "react-router-dom";
import {MobilePageHeader} from "@/components/responsive";

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const handleReset = async (values: {email: string}) => {
        try {
            await requestPasswordResetEmail(values.email);
            Message.success("Password reset email sent.");
        } catch (error: unknown) {
            Message.error("Failed to send reset email.");
        }
    };

    return (
        <div className="forgot-password-page flex flex-auto bg-ghostwhite relative p-0 md:p-6 xl:p-10">
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <MobilePageHeader title="Reset Password" />
                <Form className="forgot-password-form" layout="vertical" onSubmit={handleReset} requiredSymbol={false}>
                    <Form.Item field="email" label="Email" rules={[{required: true, message: "Please enter your email"}]}>
                        <Input prefix={<IconEmail />} placeholder="Enter your email" autoComplete="email" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" long className="mobile-full-width-button">
                        Send Reset Link
                    </Button>
                    <Button
                        type="text"
                        long
                        onClick={() => navigate("/", {state: {openLogin: true}})}
                        className="mobile-full-width-button"
                    >
                        Back to Login
                    </Button>
                </Form>
            </div>
        </div>
    );
}
