import dayjs from "dayjs";
import type {Dayjs} from "dayjs";
import {Timestamp} from "firebase/firestore";

const isFirestoreTimestamp = (value: unknown): value is Timestamp =>
    value instanceof Timestamp ||
    (typeof value === "object" &&
        value !== null &&
        "toDate" in value &&
        typeof value.toDate === "function" &&
        "toMillis" in value &&
        typeof value.toMillis === "function");

const isDayjsValue = (value: unknown): value is Dayjs =>
    dayjs.isDayjs(value) ||
    (typeof value === "object" &&
        value !== null &&
        "isValid" in value &&
        typeof value.isValid === "function" &&
        "toDate" in value &&
        typeof value.toDate === "function");

const isValidDateParts = (year: number, month: number, day: number): boolean => {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return false;
    }

    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
};

const dateFromParts = (year: number, month: number, day: number): Date | null =>
    isValidDateParts(year, month, day) ? new Date(year, month - 1, day) : null;

export const parseBirthdate = (value: unknown): Date | null => {
    if (!value) {
        return null;
    }

    if (isFirestoreTimestamp(value)) {
        return value.toDate();
    }

    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (isDayjsValue(value)) {
        return value.isValid() ? value.toDate() : null;
    }

    if (typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (slashMatch) {
        return dateFromParts(Number(slashMatch[3]), Number(slashMatch[2]), Number(slashMatch[1]));
    }

    const dashMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
    if (dashMatch) {
        return dateFromParts(Number(dashMatch[1]), Number(dashMatch[2]), Number(dashMatch[3]));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const deriveBirthdateFromMykad = (ic: string | null | undefined): Date | null => {
    const match = /^(\d{2})(\d{2})(\d{2})\d{6}$/.exec((ic ?? "").trim());
    if (!match) {
        return null;
    }

    const yearPrefix = Number(match[1]) >= 50 ? 1900 : 2000;
    return dateFromParts(yearPrefix + Number(match[1]), Number(match[2]), Number(match[3]));
};

export const isSameBirthdateDay = (left: unknown, right: unknown): boolean => {
    const leftDate = parseBirthdate(left);
    const rightDate = parseBirthdate(right);
    if (!leftDate || !rightDate) {
        return false;
    }

    return (
        leftDate.getFullYear() === rightDate.getFullYear() &&
        leftDate.getMonth() === rightDate.getMonth() &&
        leftDate.getDate() === rightDate.getDate()
    );
};

export const isBirthdateMatchingMykad = (ic: string | null | undefined, birthdate: unknown): boolean => {
    const derivedBirthdate = deriveBirthdateFromMykad(ic);
    return Boolean(derivedBirthdate && isSameBirthdateDay(derivedBirthdate, birthdate));
};

export const normalizeBirthdateForWrite = (birthdate: unknown): Timestamp => {
    const parsed = parseBirthdate(birthdate);
    if (!parsed) {
        throw new Error("Invalid birthdate.");
    }

    return Timestamp.fromDate(parsed);
};

export const formatBirthdateForDisplay = (
    birthdate: unknown,
    fallbackIc?: string | null,
    fallback = "-",
): string => {
    const parsed = parseBirthdate(birthdate) ?? deriveBirthdateFromMykad(fallbackIc);
    if (!parsed) {
        return fallback;
    }

    const day = String(parsed.getDate()).padStart(2, "0");
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${parsed.getFullYear()}`;
};
