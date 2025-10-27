export function formatStackingTime(time?: number | null): string {
    if (typeof time !== "number" || Number.isNaN(time) || time <= 0) {
        return "—";
    }

    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    const hundredths = Math.floor((time % 1) * 100);

    if (minutes > 0) {
        return `${minutes}:${seconds.toString().padStart(2, "0")}.${hundredths.toString().padStart(2, "0")}`;
    }

    return `${seconds}.${hundredths.toString().padStart(2, "0")}`;
}

export function formatDateSafe(value?: Date | string | number | null): string {
    if (!value) {
        return "—";
    }

    let date: Date;

    if (value instanceof Date) {
        date = value;
    } else if (typeof value === "number") {
        date = new Date(value);
    } else {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) {
            return "—";
        }
        date = parsed;
    }

    if (Number.isNaN(date.getTime())) {
        return "—";
    }

    return date.toLocaleDateString();
}
