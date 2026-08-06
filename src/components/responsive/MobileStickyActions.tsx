import type {ReactNode} from "react";

export interface MobileStickyActionsProps {
    children: ReactNode;
    className?: string;
}

/** Keeps primary form actions reachable above the mobile browser safe area. */
export const MobileStickyActions = ({children, className = ""}: MobileStickyActionsProps) => (
    <>
        <div className={`mobile-sticky-actions ${className}`}>
            <div className="mobile-sticky-actions__inner">{children}</div>
        </div>
        <div className="mobile-sticky-actions__spacer" aria-hidden="true" />
    </>
);

export default MobileStickyActions;
