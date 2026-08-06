import {Button, Typography} from "@arco-design/web-react";
import {IconArrowLeft} from "@arco-design/web-react/icon";
import type {ReactNode} from "react";
import {useNavigate} from "react-router-dom";

const {Title, Text} = Typography;

export interface MobilePageHeaderProps {
    title: ReactNode;
    subtitle?: ReactNode;
    backTo?: string;
    backLabel?: string;
    actions?: ReactNode;
    className?: string;
}

/** A responsive page heading that keeps actions reachable on narrow screens. */
export const MobilePageHeader = ({
    title,
    subtitle,
    backTo,
    backLabel = "Back",
    actions,
    className = "",
}: MobilePageHeaderProps) => {
    const navigate = useNavigate();

    return (
        <div className={`mobile-page-header ${className}`}>
            <div className="mobile-page-header__main">
                {backTo ? (
                    <Button
                        className="mobile-page-header__back"
                        type="outline"
                        icon={<IconArrowLeft />}
                        onClick={() => navigate(backTo)}
                    >
                        {backLabel}
                    </Button>
                ) : null}
                <div className="mobile-page-header__copy">
                    <Title heading={3} className="!mb-0 break-words">
                        {title}
                    </Title>
                    {subtitle ? (
                        <Text type="secondary" className="mt-1 block break-words">
                            {subtitle}
                        </Text>
                    ) : null}
                </div>
            </div>
            {actions ? <div className="mobile-page-header__actions">{actions}</div> : null}
        </div>
    );
};

export default MobilePageHeader;
