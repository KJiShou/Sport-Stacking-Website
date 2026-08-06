import {Button} from "@arco-design/web-react";
import type {ReactNode, Ref} from "react";
import {forwardRef} from "react";

export interface MobileFilterTriggerProps {
    activeCount?: number;
    ariaExpanded?: boolean;
    ariaLabel: string;
    children?: never;
    className?: string;
    icon: ReactNode;
    onClick: () => void;
}

/**
 * Icon-only filter trigger used beside mobile search fields.
 *
 * The count intentionally lives outside Arco's Button children.  Arco uses
 * the presence of children to add icon/text spacing, which otherwise moves
 * an icon away from the centre of a compact touch target.
 */
export const MobileFilterTrigger = forwardRef<HTMLButtonElement, MobileFilterTriggerProps>(
    ({activeCount = 0, ariaExpanded = false, ariaLabel, className = "", icon, onClick}, ref) => (
        <span className={`mobile-filter-trigger ${className}`.trim()}>
            <Button
                ref={ref as Ref<HTMLButtonElement>}
                type="outline"
                className="mobile-filter-trigger__button"
                icon={icon}
                aria-expanded={ariaExpanded}
                aria-haspopup="dialog"
                aria-label={ariaLabel}
                onClick={onClick}
            />
            {activeCount > 0 ? (
                <span className="mobile-filter-trigger__count" aria-hidden="true">
                    {activeCount}
                </span>
            ) : null}
        </span>
    ),
);

MobileFilterTrigger.displayName = "MobileFilterTrigger";

export default MobileFilterTrigger;
