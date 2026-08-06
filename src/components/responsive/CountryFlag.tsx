import type {CSSProperties} from "react";
import {useEffect, useMemo, useState} from "react";

import {getCountryFlag} from "@/utils/countryFlags";

export interface CountryFlagProps {
    country?: string | null;
    size?: "sm" | "md";
    className?: string;
}

const FLAG_SIZES: Record<NonNullable<CountryFlagProps["size"]>, CSSProperties> = {
    sm: {width: 20, height: 15},
    md: {width: 24, height: 18},
};

/** Renders a country flag with a stable fallback when the remote flag cannot load. */
export const CountryFlag = ({country, size = "sm", className = ""}: CountryFlagProps) => {
    const normalizedCountry = country?.trim() ?? "";
    const flagUrl = useMemo(() => (normalizedCountry ? getCountryFlag(normalizedCountry, "4x3") : ""), [normalizedCountry]);
    const [hasError, setHasError] = useState(false);
    const [isLoading, setIsLoading] = useState(Boolean(flagUrl));
    const flagSize = FLAG_SIZES[size];
    const sharedClassName = `country-flag ${className}`.trim();

    useEffect(() => {
        setHasError(false);
        setIsLoading(Boolean(flagUrl));
    }, [flagUrl]);

    if (!flagUrl || hasError) {
        return (
            <span
                className={`${sharedClassName} country-flag--fallback`}
                style={flagSize}
                role="img"
                aria-label={normalizedCountry ? `${normalizedCountry} flag unavailable` : "Country unavailable"}
            >
                🌍
            </span>
        );
    }

    return (
        <img
            src={flagUrl}
            alt={normalizedCountry ? `${normalizedCountry} flag` : "Country flag"}
            className={`${sharedClassName}${isLoading ? " country-flag--loading" : ""}`}
            style={{...flagSize, opacity: isLoading ? 0.45 : 1}}
            loading="lazy"
            aria-busy={isLoading}
            onLoad={() => setIsLoading(false)}
            onError={() => setHasError(true)}
        />
    );
};

export default CountryFlag;
