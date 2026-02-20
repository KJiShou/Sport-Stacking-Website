export function formatStackingTime(time?: number | null): string {
    if (typeof time !== "number" || Number.isNaN(time) || time <= 0) {
        return "—";
    }

    const total = time;
    let minutes = Math.floor(total / 60);
    let seconds = Math.floor(total % 60);
    let thousandths = Math.round((total - Math.floor(total)) * 1000);

    // Handle rounding overflow (e.g., 59.9995 -> 60.000)
    if (thousandths === 1000) {
        thousandths = 0;
        seconds += 1;
        if (seconds === 60) {
            seconds = 0;
            minutes += 1;
        }
    }

    const secStr = seconds.toString().padStart(2, "0");
    const msStr = thousandths.toString().padStart(3, "0");

    if (minutes > 0) {
        return `${minutes}:${secStr}.${msStr}`;
    }

    return `${seconds}.${msStr}`;
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

    return date.toLocaleDateString("en-GB");
}
