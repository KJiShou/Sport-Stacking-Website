import type {Team} from "./TeamSchema";

export interface TeamRow extends Team {
    registrationId: string;
}
