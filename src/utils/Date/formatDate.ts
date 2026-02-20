import type {Timestamp} from "@firebase/firestore";
import dayjs, {type Dayjs} from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
export const formatDate = (date: Timestamp | Date | Dayjs | string | null | undefined): string => {
    if (!date) return "-";
    if (typeof (date as Timestamp).toDate === "function") {
        return dayjs((date as Timestamp).toDate()).format("DD/MM/YYYY HH:mm");
    }
    if (dayjs.isDayjs(date)) {
        return date.format("DD/MM/YYYY HH:mm");
    }
    if (date instanceof Date) {
        return dayjs(date).format("DD/MM/YYYY HH:mm");
    }
    if (typeof date === "string") {
        return dayjs(date).format("DD/MM/YYYY HH:mm");
    }
    return "-";
};
