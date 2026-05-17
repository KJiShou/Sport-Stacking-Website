import type {FormInstance} from "@arco-design/web-react";
import dayjs from "dayjs";

type SmartDate = {
    hour(value?: number): number | SmartDate;
    minute(value?: number): number | SmartDate;
    second(value?: number): number | SmartDate;
    subtract(value: number, unit: string): SmartDate;
    isBefore(date: unknown, unit?: string): boolean;
    toDate(): Date;
};

const asSmartDate = (value: unknown): SmartDate => value as SmartDate;
const setTimePart = (value: number | SmartDate): SmartDate => value as SmartDate;

export function useSmartDateHandlers(form: FormInstance) {
    const handleTournamentDateChange = (_: string[], dates: unknown[]) => {
        if (!dates || dates.length !== 2) return;

        const [startDate, endDate] = dates.map(asSmartDate);

        const today = dayjs();

        // 👉 先智能修正 start/end 时间
        const fixedStart =
            startDate.hour() === 0 && startDate.minute() === 0 && startDate.second() === 0
                ? setTimePart(setTimePart(setTimePart(startDate.hour(8)).minute(0)).second(0))
                : startDate;

        const fixedEnd =
            endDate.hour() === 0 && endDate.minute() === 0 && endDate.second() === 0
                ? setTimePart(setTimePart(setTimePart(endDate.hour(18)).minute(0)).second(0))
                : endDate;

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

        const [start, end] = dates.map(asSmartDate);

        const fixedStart =
            start.hour() === 0 && start.minute() === 0 && start.second() === 0
                ? setTimePart(setTimePart(setTimePart(start.hour(8)).minute(0)).second(0))
                : start;

        const fixedEnd =
            end.hour() === 0 && end.minute() === 0 && end.second() === 0
                ? setTimePart(setTimePart(setTimePart(end.hour(18)).minute(0)).second(0))
                : end;

        form.setFieldValue(fieldName, [fixedStart.toDate(), fixedEnd.toDate()]);
    };

    return {handleTournamentDateChange, handleRangeChangeSmart};
}
