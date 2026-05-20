import type {FormInstance} from "@arco-design/web-react";
import dayjs from "dayjs";

type DateRangeValue = {
    hour: (value?: number) => number | DateRangeValue;
    minute: (value?: number) => number | DateRangeValue;
    second: (value?: number) => number | DateRangeValue;
    subtract: (value: number, unit: string) => DateRangeValue;
    isBefore: (value: unknown, unit?: string) => boolean;
    toDate: () => Date;
};

const isDateRangeValue = (value: unknown): value is DateRangeValue =>
    typeof value === "object" &&
    value !== null &&
    "hour" in value &&
    "minute" in value &&
    "second" in value &&
    "subtract" in value &&
    "isBefore" in value &&
    "toDate" in value;

const setTime = (value: DateRangeValue, hour: number): DateRangeValue => {
    const withHour = value.hour(hour);
    if (!isDateRangeValue(withHour)) {
        return value;
    }
    const withMinute = withHour.minute(0);
    if (!isDateRangeValue(withMinute)) {
        return withHour;
    }
    const withSecond = withMinute.second(0);
    return isDateRangeValue(withSecond) ? withSecond : withMinute;
};

export function useSmartDateHandlers(form: FormInstance) {
    const handleTournamentDateChange = (_: string[], dates: unknown[]) => {
        if (!dates || dates.length !== 2) return;

        const [startDate, endDate] = dates;
        if (!isDateRangeValue(startDate) || !isDateRangeValue(endDate)) return;

        const today = dayjs();

        // 👉 先智能修正 start/end 时间
        const fixedStart =
            startDate.hour() === 0 && startDate.minute() === 0 && startDate.second() === 0 ? setTime(startDate, 8) : startDate;

        const fixedEnd =
            endDate.hour() === 0 && endDate.minute() === 0 && endDate.second() === 0 ? setTime(endDate, 18) : endDate;

        const oneMonthBefore = fixedStart.subtract(1, "month");
        const twoWeekBefore = fixedEnd.subtract(14, "day");

        const registrationStart = oneMonthBefore.isBefore(today) ? today : oneMonthBefore;
        const registrationEnd = twoWeekBefore;

        form.setFieldValue("date_range", [fixedStart.toDate(), fixedEnd.toDate()]);

        // 👉 只有当 registration_date_range 还没选过的时候才自动 set
        const currentRegistration = form.getFieldValue("registration_date_range");
        if (!currentRegistration || currentRegistration.length !== 2) {
            form.setFieldValue("registration_date_range", [registrationStart.toDate(), registrationEnd.toDate()]);
        }
    };

    const handleRangeChangeSmart = (fieldName: string) => (_: string[], dates: unknown[]) => {
        if (!dates || dates.length !== 2) return;

        const [start, end] = dates;
        if (!isDateRangeValue(start) || !isDateRangeValue(end)) return;

        const fixedStart =
            start.hour() === 0 && start.minute() === 0 && start.second() === 0 ? setTime(start, 8) : start;

        const fixedEnd =
            end.hour() === 0 && end.minute() === 0 && end.second() === 0 ? setTime(end, 18) : end;

        form.setFieldValue(fieldName, [fixedStart.toDate(), fixedEnd.toDate()]);
    };

    return {handleTournamentDateChange, handleRangeChangeSmart};
}
