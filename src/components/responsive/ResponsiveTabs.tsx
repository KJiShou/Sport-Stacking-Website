import {Tabs} from "@arco-design/web-react";
import type {ComponentProps, ReactNode} from "react";
import {useCallback, useEffect, useRef} from "react";

type ArcoTabsProps = ComponentProps<typeof Tabs>;

export interface ResponsiveTabsProps extends ArcoTabsProps {
    children?: ReactNode;
}

/** Tabs that remain touch-scrollable and keep the active item in view. */
export const ResponsiveTabs = ({className = "", activeTab, children, onChange, ...props}: ResponsiveTabsProps) => {
    const rootRef = useRef<HTMLDivElement>(null);
    const animationFrameRef = useRef<number | null>(null);

    const scrollActiveTab = useCallback(() => {
        const active = rootRef.current?.querySelector<HTMLElement>(".arco-tabs-tab-active");
        active?.scrollIntoView?.({block: "nearest", inline: "center"});
    }, []);

    const scheduleActiveTabScroll = useCallback(() => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            scrollActiveTab();
            return;
        }

        if (animationFrameRef.current !== null) {
            window.cancelAnimationFrame(animationFrameRef.current);
        }

        animationFrameRef.current = window.requestAnimationFrame(() => {
            animationFrameRef.current = null;
            scrollActiveTab();
        });
    }, [scrollActiveTab]);

    useEffect(() => {
        scheduleActiveTabScroll();
        return () => {
            if (animationFrameRef.current !== null && typeof window !== "undefined") {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [activeTab, scheduleActiveTabScroll]);

    const handleChange = (key: string) => {
        onChange?.(key);
        scheduleActiveTabScroll();
    };

    return (
        <div ref={rootRef} className={`responsive-tabs ${className}`}>
            <Tabs {...props} {...(activeTab === undefined ? {} : {activeTab})} onChange={handleChange}>
                {children}
            </Tabs>
        </div>
    );
};

export default ResponsiveTabs;
