import {useAuthContext} from "@/context/AuthContext";
import type {FirestoreUser, Tournament, TournamentEvent} from "@/schema";
import {
    type AdminTeamAssignment,
    createAdminTournamentRegistration,
    isEligibleAdminMember,
} from "@/services/firebase/adminRegistrationService";
import {searchUsersByNameOrGlobalIdPrefix} from "@/services/firebase/authService";
import {fetchRegistrations} from "@/services/firebase/registerService";
import {fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {parseBirthdate} from "@/utils/birthdate";
import {getEventLabel, isTeamEvent} from "@/utils/tournament/eventUtils";
import {Button, Checkbox, Empty, Form, Input, Message, Result, Select, Spin, Tag, Typography} from "@arco-design/web-react";
import {useEffect, useMemo, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";

type TeamDraft = {teamName: string; memberGlobalIds: string[]};

const getAgeAtTournament = (birthdate: unknown, startDate: unknown): number | null => {
    const birth = parseBirthdate(birthdate);
    const start = parseBirthdate(startDate);
    if (!birth || !start) return null;
    return Math.max(
        0,
        start.getFullYear() -
            birth.getFullYear() -
            (start < new Date(start.getFullYear(), birth.getMonth(), birth.getDate()) ? 1 : 0),
    );
};

const isEventEligible = (event: TournamentEvent, member: FirestoreUser, tournament: Tournament): boolean => {
    if (event.gender !== "Mixed" && event.gender !== member.gender) return false;
    if (isTeamEvent(event)) return true;
    const age = getAgeAtTournament(member.birthdate, tournament.start_date);
    return (
        age !== null &&
        (event.age_brackets.length === 0 ||
            event.age_brackets.some((bracket) => age >= bracket.min_age && age <= bracket.max_age))
    );
};

const teamSizeForEvent = (event: TournamentEvent): number =>
    event.teamSize ?? (event.type === "Double" || event.type === "Parent & Child" ? 2 : 4);

const getAgeLabel = (event: TournamentEvent): string =>
    event.age_brackets.length > 0
        ? event.age_brackets.map((bracket) => `${bracket.min_age}-${bracket.max_age}`).join(", ")
        : "All ages";

const getGenderLabel = (gender?: string | null): string => {
    const normalizedGender = gender === "Both" || !gender ? "Mixed" : gender;
    return normalizedGender === "Mixed" ? "Mixed gender" : normalizedGender;
};

export default function AdminRegisterMemberPage() {
    const {tournamentId} = useParams();
    const {user} = useAuthContext();
    const navigate = useNavigate();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [events, setEvents] = useState<TournamentEvent[]>([]);
    const [registeredKeys, setRegisteredKeys] = useState<Set<string>>(new Set());
    const [members, setMembers] = useState<FirestoreUser[]>([]);
    const [member, setMember] = useState<FirestoreUser | null>(null);
    const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
    const [teamDrafts, setTeamDrafts] = useState<Record<string, TeamDraft>>({});
    const [teamMemberOptions, setTeamMemberOptions] = useState<Record<string, FirestoreUser[]>>({});
    const [teamSearchLoading, setTeamSearchLoading] = useState<Record<string, boolean>>({});
    const [teamSearchErrors, setTeamSearchErrors] = useState<Record<string, string | null>>({});
    const [teamSearchTerms, setTeamSearchTerms] = useState<Record<string, string>>({});
    const [searching, setSearching] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadingData, setLoadingData] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [keyword, setKeyword] = useState("");
    const [memberSearchError, setMemberSearchError] = useState<string | null>(null);
    const [duplicateMemberFound, setDuplicateMemberFound] = useState(false);

    const canManage = Boolean(
        user &&
            (user.roles?.modify_admin === true ||
                user.roles?.edit_tournament === true ||
                user.global_id === tournament?.editor ||
                user.global_id === tournament?.recorder),
    );
    const eligibleEvents = useMemo(
        () => (member && tournament ? events.filter((event) => isEventEligible(event, member, tournament)) : []),
        [events, member, tournament],
    );
    const individualEvents = useMemo(() => eligibleEvents.filter((event) => !isTeamEvent(event)), [eligibleEvents]);
    const teamEvents = useMemo(() => eligibleEvents.filter((event) => isTeamEvent(event)), [eligibleEvents]);
    const selectedTeamEvents = useMemo(
        () => eligibleEvents.filter((event) => selectedEventIds.includes(event.id ?? "") && isTeamEvent(event)),
        [eligibleEvents, selectedEventIds],
    );
    const requiredIndividualEvents = useMemo(
        () => eligibleEvents.filter((event) => event.type === "Individual"),
        [eligibleEvents],
    );
    const allRequiredIndividualEventsSelected = requiredIndividualEvents.every((event) =>
        selectedEventIds.includes(event.id ?? ""),
    );
    const teamDetailsComplete = selectedTeamEvents.every((event) => {
        const draft = teamDrafts[event.id ?? ""];
        return Boolean(draft?.teamName.trim()) && draft?.memberGlobalIds.length === teamSizeForEvent(event) - 1;
    });
    const canSubmit = Boolean(
        member && selectedEventIds.length > 0 && allRequiredIndividualEventsSelected && teamDetailsComplete,
    );
    const memberAge = member && tournament ? getAgeAtTournament(member.birthdate, tournament.start_date) : null;

    useEffect(() => {
        if (!tournamentId) {
            setLoadingData(false);
            setLoadError("Tournament ID is missing.");
            return;
        }
        setLoadingData(true);
        setLoadError(null);
        Promise.all([fetchTournamentById(tournamentId), fetchTournamentEvents(tournamentId), fetchRegistrations(tournamentId)])
            .then(([nextTournament, nextEvents, registrations]) => {
                if (!nextTournament) throw new Error("Tournament not found.");
                setTournament(nextTournament);
                setEvents(nextEvents.filter((event) => Boolean(event.id)));
                setRegisteredKeys(
                    new Set(
                        registrations
                            .flatMap((registration) => [registration.user_id, registration.user_global_id])
                            .filter((value): value is string => Boolean(value)),
                    ),
                );
            })
            .catch((error) =>
                setLoadError(error instanceof Error ? error.message : "Failed to load tournament registration data."),
            )
            .finally(() => setLoadingData(false));
    }, [tournamentId]);

    useEffect(() => {
        const value = keyword.trim();
        if (value.length < 2) {
            setMembers([]);
            setMemberSearchError(null);
            setDuplicateMemberFound(false);
            setSearching(false);
            return;
        }

        let cancelled = false;
        const timer = window.setTimeout(async () => {
            setSearching(true);
            setMemberSearchError(null);
            setDuplicateMemberFound(false);
            try {
                const results = await searchUsersByNameOrGlobalIdPrefix(value, 20);
                if (cancelled) return;
                const eligibleResults = results.filter(isEligibleAdminMember);
                setDuplicateMemberFound(
                    eligibleResults.some(
                        (candidate) => registeredKeys.has(candidate.id) || registeredKeys.has(candidate.global_id ?? ""),
                    ),
                );
                setMembers(
                    eligibleResults.filter(
                        (candidate) =>
                            !registeredKeys.has(candidate.id) &&
                            !registeredKeys.has(candidate.global_id ?? "") &&
                            Boolean(candidate.global_id),
                    ),
                );
            } catch {
                if (!cancelled) {
                    setMembers([]);
                    setMemberSearchError("Failed to search members. Please try again.");
                }
            } finally {
                if (!cancelled) setSearching(false);
            }
        }, 300);
        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [keyword, registeredKeys]);

    useEffect(() => {
        setSelectedEventIds([]);
        setTeamDrafts({});
        setTeamMemberOptions({});
        setTeamSearchErrors({});
        setTeamSearchTerms({});
    }, [member?.id]);

    const updateTeamDraft = (eventId: string, update: Partial<TeamDraft>) => {
        setTeamDrafts((previous) => ({
            ...previous,
            [eventId]: {
                teamName: previous[eventId]?.teamName ?? "",
                memberGlobalIds: previous[eventId]?.memberGlobalIds ?? [],
                ...update,
            },
        }));
    };

    const toggleEvent = (eventId: string, checked: boolean) => {
        setSelectedEventIds((previous) =>
            checked ? Array.from(new Set([...previous, eventId])) : previous.filter((id) => id !== eventId),
        );
        if (!checked) {
            setTeamDrafts((previous) => {
                const next = {...previous};
                delete next[eventId];
                return next;
            });
            setTeamMemberOptions((previous) => {
                const next = {...previous};
                delete next[eventId];
                return next;
            });
        }
    };

    const searchTeamMembers = async (eventId: string, value: string) => {
        const trimmedValue = value.trim();
        setTeamSearchTerms((previous) => ({...previous, [eventId]: trimmedValue}));
        if (trimmedValue.length < 2) {
            setTeamMemberOptions((previous) => ({...previous, [eventId]: []}));
            setTeamSearchErrors((previous) => ({...previous, [eventId]: null}));
            return;
        }
        setTeamSearchLoading((previous) => ({...previous, [eventId]: true}));
        setTeamSearchErrors((previous) => ({...previous, [eventId]: null}));
        try {
            const results = await searchUsersByNameOrGlobalIdPrefix(trimmedValue, 20);
            const event = events.find((candidate) => candidate.id === eventId);
            const eventGender = String(event?.gender ?? "Mixed") === "Both" ? "Mixed" : (event?.gender ?? "Mixed");
            setTeamMemberOptions((previous) => ({
                ...previous,
                [eventId]: results.filter(
                    (candidate) =>
                        isEligibleAdminMember(candidate) &&
                        Boolean(candidate.global_id) &&
                        candidate.global_id !== member?.global_id &&
                        candidate.id !== member?.id &&
                        (event?.type === "Parent & Child" || eventGender === "Mixed" || candidate.gender === eventGender),
                ),
            }));
        } catch {
            setTeamMemberOptions((previous) => ({...previous, [eventId]: []}));
            setTeamSearchErrors((previous) => ({...previous, [eventId]: "Failed to search members. Please try again."}));
        } finally {
            setTeamSearchLoading((previous) => ({...previous, [eventId]: false}));
        }
    };

    const submit = async () => {
        if (!member || !tournamentId) {
            Message.warning("Select a member first.");
            return;
        }
        if (selectedEventIds.length === 0) {
            Message.warning("Select at least one event.");
            return;
        }
        if (!allRequiredIndividualEventsSelected) {
            Message.warning("Select all eligible individual events before submitting.");
            return;
        }

        const teamAssignments: AdminTeamAssignment[] = [];
        for (const event of selectedTeamEvents) {
            const eventId = event.id ?? "";
            const draft = teamDrafts[eventId];
            const requiredMembers = teamSizeForEvent(event) - 1;
            if (!draft?.teamName.trim() || draft.memberGlobalIds.length !== requiredMembers) {
                Message.warning(`${event.type} requires a team name and exactly ${requiredMembers} member(s).`);
                return;
            }
            teamAssignments.push({eventId, teamName: draft.teamName.trim(), memberGlobalIds: draft.memberGlobalIds});
        }

        setSaving(true);
        try {
            await createAdminTournamentRegistration({
                tournamentId,
                targetUserId: member.id,
                eventIds: selectedEventIds,
                teamAssignments,
            });
            Message.success("Member registration and team invitations created.");
            navigate(`/tournaments/${tournamentId}/registrations`);
        } catch (error) {
            const callableError = error as {message?: string};
            Message.error(callableError.message ?? "Failed to register member.");
        } finally {
            setSaving(false);
        }
    };

    if (loadingData) return <Spin loading className="w-full min-h-[320px]" />;
    if (loadError) return <Result status="error" title="Unable to load registration data" subTitle={loadError} />;
    if (!canManage)
        return (
            <Result
                status="403"
                title="Not authorized"
                subTitle="You do not have permission to register members for this tournament."
            />
        );
    if (!tournamentId || !tournament) return <Result status="404" title="Tournament not found" />;
    if (events.length === 0)
        return (
            <Result
                status="info"
                title="No tournament events"
                subTitle="Create at least one event before registering a member."
            />
        );

    return (
        <div className="relative flex flex-auto bg-ghostwhite p-0 md:p-6 xl:p-10">
            <div className="flex h-fit w-full flex-col gap-4 bg-white p-4 shadow-lg md:rounded-lg md:p-8 xl:p-10">
                <Typography.Title heading={3} className="mb-1 text-center">
                    Register Member
                </Typography.Title>
                <Typography.Paragraph type="secondary" className="mx-auto mb-4 w-full max-w-3xl text-center">
                    An administrator can register an existing member for this tournament. Choose the member, select eligible
                    events, and send invitations for any additional team members.
                </Typography.Paragraph>

                <Form
                    layout="vertical"
                    onSubmit={() => void submit()}
                    requiredSymbol={false}
                    className="mx-auto w-full max-w-3xl"
                >
                    <section className="mb-8">
                        <Typography.Title heading={5} className="mb-1">
                            Member Information
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" className="mb-4">
                            Search for an existing member by Global ID or name.
                        </Typography.Paragraph>
                        <Form.Item label="Search Member" required>
                            <Select
                                showSearch
                                allowClear
                                value={member?.id}
                                loading={searching}
                                placeholder="Search by Global ID or name"
                                onSearch={setKeyword}
                                onChange={(value) => {
                                    const nextMember = members.find((candidate) => candidate.id === value) ?? null;
                                    setMember(nextMember);
                                    if (!nextMember) setKeyword("");
                                }}
                                filterOption={false}
                                notFoundContent={null}
                            >
                                {members.map((candidate) => (
                                    <Select.Option key={candidate.id} value={candidate.id}>
                                        <div className="flex items-center justify-between gap-3">
                                            <span>
                                                {candidate.global_id} - {candidate.name}
                                            </span>
                                            <Tag color="green">Member</Tag>
                                        </div>
                                    </Select.Option>
                                ))}
                            </Select>
                        </Form.Item>
                        {keyword.trim().length < 2 && !member && (
                            <Typography.Text type="secondary">
                                Enter at least 2 characters to search for a member.
                            </Typography.Text>
                        )}
                        {searching && <Typography.Text type="secondary">Searching members…</Typography.Text>}
                        {memberSearchError && <Typography.Text type="error">{memberSearchError}</Typography.Text>}
                        {!searching && !memberSearchError && keyword.trim().length >= 2 && members.length === 0 && (
                            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3">
                                <Empty
                                    description={
                                        duplicateMemberFound
                                            ? "No available members found. Members already registered for this tournament are excluded."
                                            : "No eligible members found."
                                    }
                                />
                            </div>
                        )}
                        {duplicateMemberFound && members.length > 0 && (
                            <Typography.Text type="warning">
                                Members already registered for this tournament are excluded from the results.
                            </Typography.Text>
                        )}
                        {member && (
                            <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <Typography.Text bold className="text-base">
                                        {member.name}
                                    </Typography.Text>
                                    <Tag color="green">Member</Tag>
                                </div>
                                <div className="grid gap-3 text-sm text-gray-600 sm:grid-cols-3">
                                    <div>
                                        <div className="text-xs uppercase tracking-wide text-gray-400">Global ID</div>
                                        <div className="font-medium text-gray-700">{member.global_id || "—"}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-wide text-gray-400">Gender</div>
                                        <div className="font-medium text-gray-700">{member.gender}</div>
                                    </div>
                                    <div>
                                        <div className="text-xs uppercase tracking-wide text-gray-400">Age at tournament</div>
                                        <div className="font-medium text-gray-700">{memberAge === null ? "—" : memberAge}</div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    <section className="mb-8">
                        <Typography.Title heading={5} className="mb-1">
                            Select Events
                        </Typography.Title>
                        <Typography.Paragraph type="secondary" className="mb-4">
                            Select the events for this member. Events are filtered by the member&apos;s eligibility, and no event
                            is selected by default.
                        </Typography.Paragraph>
                        {!member ? (
                            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3">
                                <Empty description="Select a member to see eligible events." />
                            </div>
                        ) : eligibleEvents.length === 0 ? (
                            <div className="rounded-lg border border-dashed border-gray-300 px-4 py-3">
                                <Empty description="This member is not eligible for any events." />
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {individualEvents.length > 0 && (
                                    <div>
                                        <Typography.Text bold className="mb-3 block text-base">
                                            Individual Events
                                        </Typography.Text>
                                        <div className="grid gap-3">
                                            {individualEvents.map((event) => {
                                                const eventId = event.id ?? "";
                                                const selected = selectedEventIds.includes(eventId);
                                                return (
                                                    <label
                                                        key={eventId}
                                                        htmlFor={`individual-event-${eventId}`}
                                                        className={`flex cursor-pointer rounded-lg border p-4 transition-colors ${
                                                            selected
                                                                ? "border-blue-500 bg-blue-50/60"
                                                                : "border-gray-200 hover:border-blue-300"
                                                        }`}
                                                    >
                                                        <Checkbox
                                                            id={`individual-event-${eventId}`}
                                                            checked={selected}
                                                            onChange={(checked) => toggleEvent(eventId, checked)}
                                                        />
                                                        <div className="ml-3 min-w-0">
                                                            <Typography.Text bold>{getEventLabel(event)}</Typography.Text>
                                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                                                <span>Age: {getAgeLabel(event)}</span>
                                                                <span>Gender: {getGenderLabel(event.gender)}</span>
                                                                <span>Individual event</span>
                                                            </div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        {requiredIndividualEvents.length > 0 && (
                                            <Typography.Text type="secondary" className="mt-2 block text-sm">
                                                All eligible Individual events must be selected for this member.
                                            </Typography.Text>
                                        )}
                                    </div>
                                )}
                                {teamEvents.length > 0 && (
                                    <div>
                                        <Typography.Text bold className="mb-3 block text-base">
                                            Team Events
                                        </Typography.Text>
                                        <div className="grid gap-3">
                                            {teamEvents.map((event) => {
                                                const eventId = event.id ?? "";
                                                const selected = selectedEventIds.includes(eventId);
                                                return (
                                                    <label
                                                        key={eventId}
                                                        htmlFor={`team-event-${eventId}`}
                                                        className={`flex cursor-pointer rounded-lg border p-4 transition-colors ${
                                                            selected
                                                                ? "border-blue-500 bg-blue-50/60"
                                                                : "border-gray-200 hover:border-blue-300"
                                                        }`}
                                                    >
                                                        <Checkbox
                                                            id={`team-event-${eventId}`}
                                                            checked={selected}
                                                            onChange={(checked) => toggleEvent(eventId, checked)}
                                                        />
                                                        <div className="ml-3 min-w-0">
                                                            <Typography.Text bold>{getEventLabel(event)}</Typography.Text>
                                                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500">
                                                                <span>Age: {getAgeLabel(event)}</span>
                                                                <span>Gender: {getGenderLabel(event.gender)}</span>
                                                                <span>Team size: {teamSizeForEvent(event)} participants</span>
                                                            </div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    {selectedTeamEvents.length > 0 && (
                        <section className="mb-8">
                            <Typography.Title heading={5} className="mb-1">
                                Team Details
                            </Typography.Title>
                            <Typography.Paragraph type="secondary" className="mb-4">
                                Complete the team information for each selected team event. The selected member will serve as the
                                team leader for that event, while the other members will receive invitations.
                            </Typography.Paragraph>
                            <div className="space-y-4">
                                {selectedTeamEvents.map((event) => {
                                    const eventId = event.id ?? "";
                                    const draft = teamDrafts[eventId] ?? {teamName: "", memberGlobalIds: []};
                                    const requiredMembers = teamSizeForEvent(event) - 1;
                                    const memberCountComplete = draft.memberGlobalIds.length === requiredMembers;
                                    const searchTerm = teamSearchTerms[eventId] ?? "";
                                    const searchOptions = teamMemberOptions[eventId] ?? [];
                                    return (
                                        <div key={eventId} className="rounded-lg border border-gray-200 p-4 md:p-5">
                                            <Typography.Text bold className="block text-base">
                                                {getEventLabel(event)}
                                            </Typography.Text>
                                            <Typography.Text type="secondary" className="mt-1 block text-sm">
                                                {teamSizeForEvent(event)} participants total, including the selected member.
                                            </Typography.Text>
                                            <Form.Item label="Team Name" required className="mt-4">
                                                <Input
                                                    value={draft.teamName}
                                                    placeholder={`${member?.name ?? "Member"}'s ${event.type} team`}
                                                    onChange={(value) => updateTeamDraft(eventId, {teamName: value})}
                                                />
                                            </Form.Item>
                                            <Form.Item label="Invite Members" required>
                                                <Select
                                                    mode="multiple"
                                                    showSearch
                                                    allowClear
                                                    filterOption={false}
                                                    loading={teamSearchLoading[eventId]}
                                                    value={draft.memberGlobalIds}
                                                    placeholder="Search by Global ID or name"
                                                    onSearch={(value) => void searchTeamMembers(eventId, value)}
                                                    onChange={(value) => {
                                                        const nextValues = (Array.isArray(value) ? value : []).slice(
                                                            0,
                                                            requiredMembers,
                                                        );
                                                        if (Array.isArray(value) && value.length > requiredMembers) {
                                                            Message.warning(
                                                                `This team can include only ${requiredMembers} other member(s).`,
                                                            );
                                                        }
                                                        updateTeamDraft(eventId, {memberGlobalIds: nextValues});
                                                    }}
                                                >
                                                    {searchOptions.map((candidate) => (
                                                        <Select.Option
                                                            key={candidate.global_id}
                                                            value={candidate.global_id ?? ""}
                                                        >
                                                            {candidate.global_id} - {candidate.name}
                                                        </Select.Option>
                                                    ))}
                                                </Select>
                                            </Form.Item>
                                            <div className="flex flex-col gap-1 text-sm">
                                                <Typography.Text type={memberCountComplete ? "success" : "warning"}>
                                                    Selected {draft.memberGlobalIds.length} of {requiredMembers} other member(s)
                                                </Typography.Text>
                                                {searchTerm.length < 2 && (
                                                    <Typography.Text type="secondary">
                                                        Enter at least 2 characters to search for a member.
                                                    </Typography.Text>
                                                )}
                                                {teamSearchLoading[eventId] && (
                                                    <Typography.Text type="secondary">Searching members…</Typography.Text>
                                                )}
                                                {teamSearchErrors[eventId] && (
                                                    <Typography.Text type="error">{teamSearchErrors[eventId]}</Typography.Text>
                                                )}
                                                {!teamSearchLoading[eventId] &&
                                                    !teamSearchErrors[eventId] &&
                                                    searchTerm.length >= 2 &&
                                                    searchOptions.length === 0 && (
                                                        <Typography.Text type="secondary">
                                                            No eligible members found.
                                                        </Typography.Text>
                                                    )}
                                                <Typography.Text type="secondary">
                                                    Members who have not registered for this tournament will receive an invitation
                                                    and must register before verification.
                                                </Typography.Text>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </section>
                    )}

                    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                        <Button
                            className="w-full sm:w-auto"
                            onClick={() => navigate(`/tournaments/${tournamentId}/registrations`)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={saving}
                            disabled={!canSubmit}
                            className="w-full sm:w-auto"
                        >
                            Register Member &amp; Send Invitations
                        </Button>
                    </div>
                </Form>
            </div>
        </div>
    );
}
