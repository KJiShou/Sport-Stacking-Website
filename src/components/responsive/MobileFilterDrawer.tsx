import {Button, Drawer} from "@arco-design/web-react";
import type {ReactNode, RefObject} from "react";
import {useEffect, useRef} from "react";

export interface MobileFilterDrawerProps {
    visible: boolean;
    title?: ReactNode;
    activeCount?: number;
    onCancel: () => void;
    onApply: () => void;
    onReset: () => void;
    children: ReactNode;
    returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * A consistent filter interaction for touch screens.  The page owns a draft
 * value, so closing the drawer never changes the applied result accidentally.
 */
export const MobileFilterDrawer = ({
    visible,
    title = "Filters",
    activeCount = 0,
    onCancel,
    onApply,
    onReset,
    children,
    returnFocusRef,
}: MobileFilterDrawerProps) => {
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

    return (
        <Drawer
            visible={visible}
            title={title}
            placement="bottom"
            height="min(92dvh, 720px)"
            focusLock
            autoFocus
            onCancel={onCancel}
            className="mobile-filter-drawer"
            bodyStyle={{display: "flex", minHeight: 0, flexDirection: "column", overflow: "hidden"}}
            footer={
                <div className="mobile-filter-drawer__footer">
                    <Button type="secondary" onClick={onReset}>
                        Reset{activeCount > 0 ? ` (${activeCount})` : ""}
                    </Button>
                    <Button type="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button type="primary" onClick={onApply}>
                        Apply
                    </Button>
                </div>
            }
        >
            <div className="mobile-filter-drawer__body">{children}</div>
        </Drawer>
    );
};

export default MobileFilterDrawer;
