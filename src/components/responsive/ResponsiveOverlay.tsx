import {Drawer, Modal} from "@arco-design/web-react";
import type {ReactNode, RefObject} from "react";
import {useEffect, useRef} from "react";
import {useDeviceBreakpoint} from "@/utils/DeviceInspector";
import {DeviceBreakpoint} from "@/utils/DeviceInspector/deviceStore";

export interface ResponsiveOverlayProps {
    visible: boolean;
    title?: ReactNode;
    onCancel: () => void;
    children: ReactNode;
    footer?: ReactNode;
    desktopWidth?: string | number;
    mobileHeight?: string | number;
    mobileMode?: "fullscreen" | "sheet";
    returnFocusRef?: RefObject<HTMLElement | null>;
    className?: string;
}

/** Uses a full-width bottom sheet on phones and a normal modal on larger screens. */
export const ResponsiveOverlay = ({
    visible,
    title,
    onCancel,
    children,
    footer,
    desktopWidth = "min(95vw, 800px)",
    mobileHeight = "min(92dvh, 760px)",
    mobileMode = "sheet",
    returnFocusRef,
    className = "",
}: ResponsiveOverlayProps) => {
    const breakpoint = useDeviceBreakpoint();
    const isMobile = breakpoint < DeviceBreakpoint.md;
    const wasVisible = useRef(false);

    useEffect(() => {
        if (visible) {
            wasVisible.current = true;
            return;
        }
        if (wasVisible.current) {
            wasVisible.current = false;
            window.setTimeout(() => returnFocusRef?.current?.focus(), 0);
        }
    }, [returnFocusRef, visible]);

    useEffect(() => {
        if (!visible || isMobile || typeof document === "undefined") {
            return;
        }
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isMobile, visible]);

    if (isMobile) {
        const height = mobileMode === "fullscreen" ? "100dvh" : mobileHeight;
        return (
            <Drawer
                title={title}
                visible={visible}
                placement="bottom"
                height={height}
                onCancel={onCancel}
                footer={footer}
                focusLock
                autoFocus
                className={`responsive-overlay responsive-overlay--mobile responsive-overlay--${mobileMode} ${className}`}
            >
                <div className="responsive-overlay__body">{children}</div>
            </Drawer>
        );
    }

    return (
        <Modal
            title={title}
            visible={visible}
            onCancel={onCancel}
            footer={footer}
            autoFocus={false}
            focusLock
            style={{width: desktopWidth}}
            className={`responsive-overlay ${className}`}
        >
            <div className="responsive-overlay__body">{children}</div>
        </Modal>
    );
};

export default ResponsiveOverlay;
