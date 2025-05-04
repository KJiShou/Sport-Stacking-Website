import dayjs, {type Dayjs} from "dayjs";
import type {FormInstance} from "@arco-design/web-react";

export function useSmartDateHandlers(form: FormInstance) {
    const handleCompetitionDateChange = (_: string[], dates: Dayjs[]) => {
        if (!dates || dates.length !== 2) return;

        const [startDate, endDate] = dates;

        const today = dayjs();

        // 👉 先智能修正 start/end 时间
        const fixedStart =
            startDate.hour() === 0 && startDate.minute() === 0 && startDate.second() === 0
                ? startDate.hour(8).minute(0).second(0)
                : startDate;

        const fixedEnd =
            endDate.hour() === 0 && endDate.minute() === 0 && endDate.second() === 0
                ? endDate.hour(18).minute(0).second(0)
                : endDate;

        const oneMonthBefore = fixedStart.subtract(1, "month");
        const oneWeekBefore = fixedEnd.subtract(7, "day");

        const registrationStart = oneMonthBefore.isBefore(today) ? today : oneMonthBefore;
        const registrationEnd = oneWeekBefore;

        form.setFieldValue("date_range", [fixedStart.toDate(), fixedEnd.toDate()]);

        // 👉 只有当 registration_date_range 还没选过的时候才自动 set
        const currentRegistration = form.getFieldValue("registration_date_range");
        if (!currentRegistration || currentRegistration.length !== 2) {
            form.setFieldValue("registration_date_range", [registrationStart.toDate(), registrationEnd.toDate()]);
        }
    };

    const handleRangeChangeSmart = (fieldName: string) => (_: string[], dates: Dayjs[]) => {
        if (!dates || dates.length !== 2) return;

        const [start, end] = dates;

        const fixedStart =
            start.hour() === 0 && start.minute() === 0 && start.second() === 0 ? start.hour(8).minute(0).second(0) : start;

        const fixedEnd = end.hour() === 0 && end.minute() === 0 && end.second() === 0 ? end.hour(18).minute(0).second(0) : end;

        form.setFieldValue(fieldName, [fixedStart.toDate(), fixedEnd.toDate()]);
    };

    return {handleCompetitionDateChange, handleRangeChangeSmart};
}
