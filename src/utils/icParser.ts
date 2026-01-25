export type IcDerivedProfile = {
    birthdate: Date | null;
    gender: "Male" | "Female" | null;
};

export const parseIcToProfile = (ic: string): IcDerivedProfile => {
    const trimmed = ic.trim();
    if (!/^\d{12}$/.test(trimmed)) {
        return {birthdate: null, gender: null};
    }

    const yy = Number.parseInt(trimmed.slice(0, 2), 10);
    const mm = Number.parseInt(trimmed.slice(2, 4), 10);
    const dd = Number.parseInt(trimmed.slice(4, 6), 10);

    if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) {
        return {birthdate: null, gender: null};
    }

    const currentYear = new Date().getFullYear();
    const currentYY = currentYear % 100;
    const fullYear = yy <= currentYY ? 2000 + yy : 1900 + yy;

    const birthdate = new Date(fullYear, mm - 1, dd);
    if (Number.isNaN(birthdate.getTime())) {
        return {birthdate: null, gender: null};
    }

    const lastDigit = Number.parseInt(trimmed.slice(-1), 10);
    const gender = Number.isNaN(lastDigit) ? null : lastDigit % 2 === 0 ? "Female" : "Male";

    return {birthdate, gender};
};
