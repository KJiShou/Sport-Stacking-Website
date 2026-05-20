export type InAppBrowserType = "whatsapp" | "instagram" | "facebook" | "line" | "messenger" | "unknown";

export interface InAppBrowserInfo {
    type: InAppBrowserType;
    label: string;
}

const IN_APP_BROWSER_RULES: Array<{pattern: RegExp; info: InAppBrowserInfo}> = [
    {
        pattern: /\bWhatsApp\b/i,
        info: {type: "whatsapp", label: "WhatsApp"},
    },
    {
        pattern: /\bInstagram\b/i,
        info: {type: "instagram", label: "Instagram"},
    },
    {
        pattern: /\bFBAN\b|\bFBAV\b/i,
        info: {type: "facebook", label: "Facebook"},
    },
    {
        pattern: /\bMessenger\b/i,
        info: {type: "messenger", label: "Messenger"},
    },
    {
        pattern: /\bLine\b/i,
        info: {type: "line", label: "LINE"},
    },
];

export const detectInAppBrowser = (
    userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "",
): InAppBrowserInfo | null => {
    for (const rule of IN_APP_BROWSER_RULES) {
        if (rule.pattern.test(userAgent)) {
            return rule.info;
        }
    }

    return null;
};
