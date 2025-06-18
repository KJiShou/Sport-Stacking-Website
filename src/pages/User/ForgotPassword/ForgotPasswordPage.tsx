import {Form, Input, Button, Message, Typography} from "@arco-design/web-react";
import {IconEmail} from "@arco-design/web-react/icon";
import {sendPasswordResetEmail} from "firebase/auth";
import {auth} from "@/services/firebase/config"; // ✅ 确保指向你的 firebase `auth`

const {Title} = Typography;

export default function ForgotPasswordPage() {
    const handleReset = async (values: {email: string}) => {
        try {
            await sendPasswordResetEmail(auth, values.email);
            Message.success("Password reset email sent.");
        } catch (error: unknown) {
            Message.error("Failed to send reset email.");
        }
    };

    return (
        <div className={`flex flex-auto h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10`}>
            <div className={`bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg`}>
                <Title heading={3}>Reset Password</Title>
                <Form layout="vertical" onSubmit={handleReset} requiredSymbol={false}>
                    <Form.Item field="email" label="Email" rules={[{required: true, message: "Please enter your email"}]}>
                        <Input prefix={<IconEmail />} placeholder="Enter your email" autoComplete="email" />
                    </Form.Item>
                    <Button type="primary" htmlType="submit" long>
                        Send Reset Link
                    </Button>
                </Form>
            </div>
        </div>
    );
}
