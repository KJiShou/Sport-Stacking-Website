import type {
    AggregationContext,
    Registration,
    ShareBracketSection,
    ShareEventSection,
    ShareRound,
    ShareScoreSheetPayload,
    Team,
    Tournament,
    TournamentEvent,
    TournamentRecord,
    TournamentTeamRecord,
} from "@/schema";
import {getTournamentFinalRecords, getTournamentPrelimRecords} from "@/services/firebase/recordService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTeamsByTournament, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {buildFinalistClassificationMap} from "@/utils/tournament/finalistStyling";
import {isTeamFullyVerified} from "@/utils/teamVerification";
import {getEventTypeOrderIndex, isScoreTrackedEvent} from "@/utils/tournament/eventUtils";
import {computeEventBracketResults} from "@/utils/tournament/resultAggregation";

const isTeamRecord = (record: TournamentRecord | TournamentTeamRecord): record is TournamentTeamRecord =>
    (record as TournamentTeamRecord).team_id !== undefined;

const getTeamId = (record: Partial<TournamentTeamRecord>): string | undefined =>
    record.team_id ?? (record as {teamId?: string}).teamId ?? (record as {participantId?: string}).participantId;

const buildAggregationContext = (
    records: Array<TournamentRecord | TournamentTeamRecord>,
    registrations: Registration[],
    teams: Team[],
): AggregationContext => {
    const registrationMap = registrations.reduce(
        (acc, reg) => {
            acc[reg.user_id] = reg;
            return acc;
        },
        {} as Record<string, Registration>,
    );

    const teamMap = teams.reduce(
        (acc, team) => {
            acc[team.id] = team;
            return acc;
        },
        {} as Record<string, Team>,
    );

    const nameMap = registrations.reduce(
        (acc, reg) => {
            acc[reg.user_id] = reg.user_name;
            return acc;
        },
        {} as Record<string, string>,
    );

    const ageMap = registrations.reduce(
        (acc, reg) => {
            acc[reg.user_id] = reg.age;
            return acc;
        },
        {} as Record<string, number>,
    );

    const teamNameMap = teams.reduce(
        (acc, team) => {
            acc[team.id] = team.name;
            return acc;
        },
        {} as Record<string, string>,
    );

    return {
        allRecords: records,
        registrations,
        registrationMap,
        teams,
        teamMap,
        nameMap,
        ageMap,
        teamNameMap,
    };
};

const toShareRows = (
    rows: ReturnType<typeof computeEventBracketResults>,
    scope: {eventId: string; bracketName: string; classification?: string},
) =>
    rows
        .map((row) => {
            const baseId = String(row.id ?? row.participant_id ?? row.participantId ?? row.teamId ?? row.name ?? crypto.randomUUID());
            return {
                ...row,
                id: `${scope.eventId}::${scope.bracketName}::${scope.classification ?? "all"}::${baseId}`,
                rank: typeof row.rank === "number" ? row.rank : 0,
                name: typeof row.name === "string" ? row.name : "N/A",
                bestTime: typeof row.bestTime === "number" ? row.bestTime : Number.POSITIVE_INFINITY,
            };
        })
        .filter((row) => Number.isFinite(row.bestTime));

export const getShareScoreSheetData = async (tournamentId: string, round: ShareRound): Promise<ShareScoreSheetPayload | null> => {
    const tournament = await fetchTournamentById(tournamentId);
    if (!tournament) {
        return null;
    }

    const [events, registrations, fetchedTeams, fetchedRecords] = await Promise.all([
        fetchTournamentEvents(tournamentId),
        fetchRegistrations(tournamentId),
        fetchTeamsByTournament(tournamentId),
        round === "prelim" ? getTournamentPrelimRecords(tournamentId) : getTournamentFinalRecords(tournamentId),
    ]);

    const scoringEvents = events
        .filter((event) => isScoreTrackedEvent(event))
        .sort((a, b) => {
            const orderDiff = getEventTypeOrderIndex(a.type) - getEventTypeOrderIndex(b.type);
            if (orderDiff !== 0) return orderDiff;
            return a.type.localeCompare(b.type);
        });

    const verifiedTeams = fetchedTeams.filter((team) => isTeamFullyVerified(team));
    const verifiedTeamIds = new Set(verifiedTeams.map((team) => team.id));

    const records = (fetchedRecords as Array<TournamentRecord | TournamentTeamRecord>).filter((record) => {
        if (!isTeamRecord(record)) {
            return true;
        }
        const teamId = getTeamId(record);
        return teamId ? verifiedTeamIds.has(teamId) : false;
    });

    const context = buildAggregationContext(records, registrations, verifiedTeams);

    const sections: ShareEventSection[] = scoringEvents.map((event) => {
        const brackets: ShareBracketSection[] = (event.age_brackets ?? []).flatMap((bracket): ShareBracketSection[] => {
            if (round === "final") {
                const criteria = bracket.final_criteria ?? [];
                if (criteria.length === 0) {
                    return [];
                }

                return criteria.map((criterion) => ({
                    bracket,
                    classification: criterion.classification,
                    rows: toShareRows(computeEventBracketResults(event, bracket, context, criterion.classification), {
                        eventId: event.id ?? event.type,
                        bracketName: bracket.name,
                        classification: criterion.classification,
                    }),
                }));
            }

            const rows = toShareRows(computeEventBracketResults(event, bracket, context), {
                eventId: event.id ?? event.type,
                bracketName: bracket.name,
            });
            const finalistClassificationMap = buildFinalistClassificationMap(rows, event.codes, bracket.final_criteria ?? []);

            return [
                {
                    bracket,
                    classification: undefined,
                    rows: rows.map((row) => ({
                        ...row,
                        finalClassification: finalistClassificationMap[row.id],
                    })),
                },
            ];
        });

        return {
            event,
            brackets,
        };
    });

    return {
        round,
        tournament: tournament as Tournament,
        events: scoringEvents as TournamentEvent[],
        sections,
    };
};
