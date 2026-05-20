import {detectInAppBrowser} from "@/utils/inAppBrowser";
import {Alert, Button, Message, Typography} from "@arco-design/web-react";
import {IconCopy, IconLaunch} from "@arco-design/web-react/icon";
import {useMemo} from "react";

const {Text} = Typography;

const InAppBrowserNotice = () => {
    const inAppBrowser = useMemo(() => detectInAppBrowser(), []);

    if (!inAppBrowser) {
        return null;
    }

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            Message.success("Link copied. Open it in Safari or Chrome to continue Google sign-in.");
        } catch (err) {
            Message.error("Failed to copy the link. Please copy the URL manually.");
        }
    };

    return (
        <Alert
            type="warning"
            className="w-full max-w-xl mb-4 text-left"
            content={
                <div className="flex flex-col gap-3">
                    <Text>
                        Google sign-in may fail inside the {inAppBrowser.label} in-app browser. Open this page in Safari or Chrome
                        first, then continue with Google.
                    </Text>
                    <div className="flex flex-wrap gap-2">
                        <Button size="small" type="primary" icon={<IconCopy />} onClick={handleCopyLink}>
                            Copy Link
                        </Button>
                        <Text type="secondary">
                            Use your browser menu and choose <strong>Open in Browser</strong> if available.
                        </Text>
                    </div>
                </div>
            }
            icon={<IconLaunch />}
        />
    );
};

export default InAppBrowserNotice;
