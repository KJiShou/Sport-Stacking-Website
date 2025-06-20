import type {Timestamp} from "@firebase/firestore";
import dayjs, {type Dayjs} from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
export const formatDate = (date: Timestamp | Date | Dayjs | string | null | undefined): string => {
    if (!date) return "-";
    if (typeof (date as Timestamp).toDate === "function") {
        return (date as Timestamp).toDate().toLocaleString();
    }
    if (dayjs.isDayjs(date)) {
        return date.format("YYYY-MM-DD HH:mm");
    }
    if (date instanceof Date) {
        return date.toLocaleString();
    }
    if (typeof date === "string") {
        return new Date(date).toLocaleString();
    }
    return "-";
};
