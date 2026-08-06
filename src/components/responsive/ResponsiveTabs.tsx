import {Tabs} from "@arco-design/web-react";
import type {ComponentProps, ReactNode} from "react";
import {useEffect, useRef} from "react";

type ArcoTabsProps = ComponentProps<typeof Tabs>;

export interface ResponsiveTabsProps extends ArcoTabsProps {
    children?: ReactNode;
}

/** Tabs that remain touch-scrollable and keep the active item in view. */
export const ResponsiveTabs = ({className = "", activeTab, children, ...props}: ResponsiveTabsProps) => {
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const active = rootRef.current?.querySelector<HTMLElement>(".arco-tabs-tab-active");
        active?.scrollIntoView?.({block: "nearest", inline: "center"});
    }, [activeTab]);

    return (
        <div ref={rootRef} className={`responsive-tabs ${className}`}>
            <Tabs {...props} {...(activeTab === undefined ? {} : {activeTab})}>
                {children}
            </Tabs>
        </div>
    );
};

export default ResponsiveTabs;
