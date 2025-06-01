import type { FormInstance } from "@arco-design/web-react";
import type { Competition } from "@/schema";
import dayjs from "dayjs";
import { Timestamp } from "firebase/firestore";

export function useCompetitionFormPrefill(form: FormInstance) {
    return (competition: Competition) => {
        form.setFieldsValue({
            name: competition.name,
            country: competition.country,
            address: competition.address,
            max_participants: competition.max_participants,
            date_range: [
                competition.start_date instanceof Timestamp
                    ? dayjs(competition.start_date.toDate())
                    : dayjs(competition.start_date),
                competition.end_date instanceof Timestamp ? dayjs(competition.end_date.toDate()) : dayjs(competition.end_date),
            ],
            registration_date_range: [
                competition.registration_start_date instanceof Timestamp
                    ? dayjs(competition.registration_start_date.toDate())
                    : dayjs(competition.registration_start_date),
                competition.registration_end_date instanceof Timestamp
                    ? dayjs(competition.registration_end_date.toDate())
                    : dayjs(competition.registration_end_date),
            ],
            events: competition.events,
            final_criteria: competition.final_criteria,
            final_categories: competition.final_categories,
        });
    };
}
