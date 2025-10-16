import type {TournamentRecord, TournamentTeamRecord} from "./RecordSchema";
import type {Registration} from "./RegistrationSchema";
import type {Team} from "./TeamSchema";

export interface AggregationContext {
    allRecords: (TournamentRecord | TournamentTeamRecord)[];
    registrations: Registration[];
    registrationMap: Record<string, Registration>;
    teams: Team[];
    teamMap: Record<string, Team>;
    nameMap: Record<string, string>;
    ageMap: Record<string, number>;
    teamNameMap: Record<string, string>;
}
