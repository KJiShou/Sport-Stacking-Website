import type {FormInstance} from "@arco-design/web-react";
import type {Tournament} from "@/schema";
import dayjs from "dayjs";
import {Timestamp} from "firebase/firestore";

export function useTournamentFormPrefill(form: FormInstance) {
    return (tournament: Tournament) => {
        form.setFieldsValue({
            name: tournament.name,
            country: tournament.country,
            address: tournament.address,
            max_participants: tournament.max_participants,
            date_range: [
                tournament.start_date instanceof Timestamp
                    ? dayjs(tournament.start_date.toDate())
                    : dayjs(tournament.start_date),
                tournament.end_date instanceof Timestamp ? dayjs(tournament.end_date.toDate()) : dayjs(tournament.end_date),
            ],
            registration_date_range: [
                tournament.registration_start_date instanceof Timestamp
                    ? dayjs(tournament.registration_start_date.toDate())
                    : dayjs(tournament.registration_start_date),
                tournament.registration_end_date instanceof Timestamp
                    ? dayjs(tournament.registration_end_date.toDate())
                    : dayjs(tournament.registration_end_date),
            ],
            events: tournament.events,
            final_criteria: tournament.final_criteria,
            final_categories: tournament.final_categories,
        });
    };
}
