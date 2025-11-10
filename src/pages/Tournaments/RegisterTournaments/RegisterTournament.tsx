// src/pages/RegisterTournamentPage.tsx

import {useAuthContext} from "@/context/AuthContext";
import type {ExpandedEvent, Registration, Tournament, TournamentEvent} from "@/schema";
import type {RegistrationForm} from "@/schema/RegistrationSchema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {addUserRegistrationRecord, getUserByGlobalId, getUserEmailByGlobalId} from "@/services/firebase/authService";
import {createIndividualRecruitment} from "@/services/firebase/individualRecruitmentService";
import {createRegistration} from "@/services/firebase/registerService";
import {uploadFile} from "@/services/firebase/storageService";
import {createTeamRecruitment} from "@/services/firebase/teamRecruitmentService";
import {createTeam, fetchTournamentById, fetchTournamentEvents} from "@/services/firebase/tournamentsService";
import {formatDate} from "@/utils/Date/formatDate";
import {sendProtectedEmail} from "@/utils/SenderGrid/sendMail";
import {getCountryFlag} from "@/utils/countryFlags";
import {getEventKey, getEventLabel, isTeamEvent, sanitizeEventCodes} from "@/utils/tournament/eventUtils";
import {
    Button,
    Checkbox,
    Descriptions,
    Divider,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Link,
    Message,
    Modal,
    Result,
    Select,
    Tooltip,
    Typography,
    Upload,
} from "@arco-design/web-react";
import {IconCalendar, IconExclamationCircle, IconLaunch} from "@arco-design/web-react/icon";
import MDEditor from "@uiw/react-md-editor";
import dayjs, {type Dayjs} from "dayjs";
import isSameOrAfter from "dayjs/plugin/isSameOrAfter";
import {Timestamp} from "firebase/firestore";
import {type ReactNode, useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router-dom";
dayjs.extend(isSameOrAfter);
const {Title, Paragraph} = Typography;
const Option = Select.Option;
type TeamEntry = {
    eventId: string;
    label: string;
    requiresTeam: boolean;
    event?: ExpandedEvent;
};

export default function RegisterTournamentPage() {
    const {tournamentId} = useParams();
    const [form] = Form.useForm();
    const {firebaseUser, user} = useAuthContext();
    const navigate = useNavigate();
    const [tournament, setTournament] = useState<Tournament | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [options, setOptions] = useState<ExpandedEvent[]>([]);
    const [availableEvents, setAvailableEvents] = useState<ExpandedEvent[]>([]);
    const [haveTeam, setHaveTeam] = useState<TeamEntry[]>([]);
    const [tournamentData, setTournamentData] = useState<{label?: ReactNode; value?: ReactNode}[]>([]);
    const [requiredKeys, setRequiredKeys] = useState<string[]>(["Individual"]);
    const [paymentProofUrl, setPaymentProofUrl] = useState<string | null>(null);
    const [paymentProofPreview, setPaymentProofPreview] = useState<string | null>(null);
    const [descriptionModalVisible, setDescriptionModalVisible] = useState(false);
    const [price, setPrice] = useState<number | null>(null);
    const [lookingForTeams, setLookingForTeams] = useState<string[]>([]); // Events user is looking for teams

    const findEventByKey = (eventKey: string): ExpandedEvent | undefined =>
        availableEvents.find((event) => getEventKey(event) === eventKey || event.type === eventKey);

    const buildTeamEntries = (eventIds: string[], sourceEvents: ExpandedEvent[] = availableEvents): TeamEntry[] =>
        eventIds.map((eventId) => {
            const event =
                sourceEvents.find((evt) => getEventKey(evt) === eventId || evt.type === eventId) ??
                availableEvents.find((evt) => getEventKey(evt) === eventId || evt.type === eventId);
            return {
                eventId,
                event,
                label: event ? getEventLabel(event) : eventId,
                requiresTeam: event ? isTeamEvent(event) : false,
            };
        });

    const getAgeAtTournament = (birthdate: Timestamp | string | Date, tournamentStart: Timestamp | string | Date) => {
        const birth = birthdate instanceof Timestamp ? dayjs(birthdate.toDate()) : dayjs(birthdate);

        const compStart = tournamentStart instanceof Timestamp ? dayjs(tournamentStart.toDate()) : dayjs(tournamentStart);

        let age = compStart.diff(birth, "year");

        // 如果比赛日期还没到今年生日，减 1 岁
        const hasHadBirthdayThisYear = compStart.isSameOrAfter(birth.add(age, "year"), "day");
        if (!hasHadBirthdayThisYear) {
            age -= 1;
        }

        return age;
    };

    const handleRegister = async (values: RegistrationForm) => {
        if (!tournamentId || !tournament) return;

        const now = dayjs();
        const regEnd =
            tournament.registration_end_date instanceof Timestamp
                ? dayjs(tournament.registration_end_date.toDate())
                : dayjs(tournament.registration_end_date);

        const regStart =
            tournament.registration_start_date instanceof Timestamp
                ? dayjs(tournament.registration_start_date.toDate())
                : dayjs(tournament.registration_start_date);

        if (now.isAfter(regEnd)) {
            Message.error("Registration has closed.");
            return;
        }

        if (now.isBefore(regStart)) {
            Message.error("Registration has not started yet.");
            return;
        }

        setLoading(true);

        try {
            if (!user) {
                Message.error("You must be logged in to register.");
                return;
            }

            type Team = NonNullable<RegistrationForm["teams"]>[number];
            const teamsRaw = (values.teams ?? {}) as Record<string, Team>;

            for (const [teamId, team] of Object.entries(teamsRaw)) {
                const leaderId = team.leader ?? null;
                const memberIds = (team.member ?? []).map((m) => m).filter((id) => id != null) as string[];
                const isLookingForMembers = team.looking_for_team_members === true;
                const isLookingForTeammates = lookingForTeams.includes(teamId);

                if (!isLookingForMembers && leaderId && memberIds.includes(leaderId)) {
                    Message.error(`In team "${team.name}", team leader cannot be included in team members.`);
                    setLoading(false);
                    throw new Error(`Team leader ${leaderId} cannot be a member in team ${teamId}`);
                }

                const userInTeam = leaderId === user.global_id || memberIds.includes(user.global_id ?? "");
                if (!isLookingForMembers && !userInTeam) {
                    Message.error(`In team "${team.name}", you must be either leader or one of the members.`);
                    setLoading(false);
                    throw new Error(`User ${user.global_id} is not in team ${teamId}`);
                }

                // Only check member count if NOT looking for members/teammates
                if (!isLookingForMembers && !isLookingForTeammates) {
                    const relatedEvent = findEventByKey(teamId) ?? availableEvents.find((evt) => evt.type === teamId);
                    const lowerEventType = (relatedEvent?.type ?? "").toLowerCase();
                    const fallbackTeamSize =
                        relatedEvent?.teamSize ??
                        (relatedEvent?.type === "Parent & Child"
                            ? 2
                            : lowerEventType === "double"
                              ? 2
                              : lowerEventType === "team relay"
                                ? 4
                                : undefined);

                    if (fallbackTeamSize !== undefined) {
                        const expectedMembers = Math.max(fallbackTeamSize - 1, 0);
                        const actualMembers = (team.member?.filter(Boolean)?.length ?? 0) + (team.leader ? 1 : 0);
                        if (actualMembers !== fallbackTeamSize) {
                            const eventLabel = team.name || getEventLabel(relatedEvent) || "This event";
                            const participantLabel = fallbackTeamSize === 1 ? "participant" : "participants";
                            const memberLabel = expectedMembers === 1 ? "member" : "members";
                            const additionalMessage = expectedMembers > 0 ? `` : "No additional members should be listed.";

                            Message.error(`${eventLabel} requires ${fallbackTeamSize} ${participantLabel}. ${additionalMessage}`);
                            setLoading(false);
                            throw new Error(`Team ${teamId} has ${actualMembers} participant(s); expected ${fallbackTeamSize}.`);
                        }
                    }
                }
            }

            const registrationData: Registration = {
                tournament_id: tournamentId,
                user_id: user?.id ?? "",
                user_global_id: user?.global_id ?? "",
                user_name: values.user_name,
                age: form.getFieldValue("age"),
                country: user?.country?.[0] ?? "",
                phone_number: values.phone_number,
                gender: values.gender,
                organizer: values.organizer ?? "",
                events_registered: values.events_registered ?? [],
                payment_proof_url: paymentProofUrl,
                registration_status: "pending",
                rejection_reason: null,
                final_status: null,
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
            };

            const registrationId = await createRegistration(user, registrationData);

            for (const [eventId, teamData] of Object.entries(teamsRaw)) {
                if (!teamData.name || !teamData.leader) {
                    continue; // Skip if team name or leader is missing
                }
                const members = (teamData.member ?? [])
                    .map((id) => (id ? {global_id: id, verified: findEventByKey(eventId)?.type.includes("Parent")} : null))
                    .filter((m): m is {global_id: string; verified: boolean} => m !== null);

                const memberIds = members.map((m) => m.global_id);
                if (teamData.leader) {
                    memberIds.push(teamData.leader);
                }

                const memberUsers = await Promise.all(memberIds.map((id) => getUserByGlobalId(id)));

                const ages = memberUsers
                    .map((memberUser) => {
                        if (memberUser?.birthdate && tournament?.start_date) {
                            return getAgeAtTournament(memberUser.birthdate, tournament.start_date);
                        }
                        return 0;
                    })
                    .filter((age) => age > 0);

                // Calculate team age based on event type
                const eventDetails = findEventByKey(eventId) ?? availableEvents.find((evt) => evt.type === teamData.label);
                const eventType = (eventDetails?.type ?? teamData.label ?? "").toLowerCase();
                const teamEventKeys = new Set<string>([eventId]);
                if (eventDetails) {
                    teamEventKeys.add(eventDetails.type);
                    for (const code of sanitizeEventCodes(eventDetails.codes)) {
                        teamEventKeys.add(code);
                        teamEventKeys.add(`${code}-${eventDetails.type}`);
                    }
                }
                let team_age = 0;

                if (ages.length > 0) {
                    if (eventType.includes("team relay")) {
                        // Team relay: use average age
                        team_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (eventType.includes("double")) {
                        // Double: use average age but check 10-year range constraint
                        const minAge = Math.min(...ages);
                        const maxAge = Math.max(...ages);
                        if (maxAge - minAge > 10) {
                            throw new Error(`Double event age range cannot exceed 10 years (current range: ${minAge}-${maxAge})`);
                        }
                        team_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (eventType.includes("parent") && eventType.includes("child")) {
                        // Parent & Child: use child's age (registrant's age)
                        const registrantAge =
                            user?.birthdate && tournament?.start_date
                                ? getAgeAtTournament(user.birthdate, tournament.start_date)
                                : 0;
                        team_age = registrantAge;
                    } else {
                        // Default: use largest age (for backward compatibility)
                        team_age = Math.max(...ages);
                    }
                }

                // Create the team first
                const teamId = await createTeam(tournamentId, {
                    name: teamData.name,
                    leader_id: teamData.leader,
                    members,
                    event_id: eventId,
                    registration_id: registrationId,
                    team_age,
                    looking_for_member: false,
                });

                // If looking for members, create a recruitment record
                if (teamData.looking_for_team_members) {
                    // Calculate how many members are still needed
                    const relatedEvent = findEventByKey(eventId) ?? availableEvents.find((evt) => evt.type === eventId);
                    const fallbackTeamSize =
                        relatedEvent?.teamSize ??
                        (relatedEvent?.type === "Parent & Child"
                            ? 2
                            : relatedEvent?.type?.toLowerCase() === "double"
                              ? 2
                              : relatedEvent?.type?.toLowerCase() === "team relay"
                                ? 4
                                : undefined);
                    const currentCount = (teamData.member?.filter(Boolean)?.length ?? 0) + (teamData.leader ? 1 : 0);
                    const max_members_needed = fallbackTeamSize !== undefined ? Math.max(fallbackTeamSize - currentCount, 0) : 3;
                    await createTeamRecruitment({
                        team_id: teamId,
                        tournament_id: tournamentId,
                        team_name: teamData.name,
                        leader_id: teamData.leader,
                        event_id: eventId,
                        event_name: relatedEvent ? getEventLabel(relatedEvent) : eventId,
                        requirements: "", // You can add form fields for these if needed
                        max_members_needed,
                        registration_id: registrationId,
                    });
                }

                const toNotify: string[] = [];
                if (teamData.leader && teamData.leader !== user.global_id) {
                    toNotify.push(teamData.leader);
                }
                for (const memberId of teamData.member ?? []) {
                    if (memberId && memberId !== user.global_id) {
                        toNotify.push(memberId);
                    }
                }

                for (const globalId of toNotify) {
                    try {
                        const userSnap = await getUserEmailByGlobalId(globalId);
                        const email = userSnap?.email;
                        if (email) {
                            await sendProtectedEmail(email, tournamentId, teamId, globalId, registrationId);
                        }
                    } catch (err) {
                        console.error(`❌ Failed to send verification to ${globalId}`, err);
                    }
                }
            }

            // Handle individual recruitment if user is looking for teams
            if (lookingForTeams.length > 0) {
                try {
                    // Only create one recruitment per event (schema now supports only one event per record)
                    for (const eventId of lookingForTeams) {
                        const eventObj = findEventByKey(eventId);
                        await createIndividualRecruitment({
                            participant_id: user.global_id ?? "",
                            tournament_id: tournamentId,
                            participant_name: user.name ?? "",
                            age: getAgeAtTournament(user.birthdate ?? new Date(), tournament.start_date ?? new Date()),
                            gender: (registrationData.gender ?? "Male") as "Male" | "Female",
                            country: registrationData.country ?? "",
                            event_id: eventId,
                            event_name: eventObj ? getEventLabel(eventObj) : eventId,
                            phone_number: registrationData.phone_number,
                            additional_info: `Participant is looking for a team in event: ${eventObj ? getEventLabel(eventObj) : eventId}`,
                            registration_id: registrationId,
                        });
                    }
                } catch (error) {
                    console.error("Failed to create individual recruitment:", error);
                    // Don't fail the entire registration if this fails
                }
            }

            const registrationRecord: UserRegistrationRecord = {
                status: "pending",
                tournament_id: tournamentId,
                events: registrationData.events_registered,
                registration_date: Timestamp.now(),
                rejection_reason: null,
                created_at: Timestamp.now(),
                updated_at: Timestamp.now(),
            };

            await addUserRegistrationRecord(user.id ?? "", registrationRecord);

            Message.success("Registration successful!");
            navigate("/tournaments");
        } catch (error) {
            console.error(error);
            Message.error("Failed to register.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!tournamentId || !user) return;
        const fetch = async () => {
            setLoading(true);
            try {
                const comp = await fetchTournamentById(tournamentId);
                const fetchedEvents = comp?.events?.length ? comp.events : await fetchTournamentEvents(tournamentId);
                const age = user?.birthdate && comp?.start_date ? getAgeAtTournament(user.birthdate, comp.start_date) : 0;

                // Filter events by age brackets and keep them as grouped events
                const availableGroupedEvents: ExpandedEvent[] = [];
                for (const event of fetchedEvents) {
                    // Filter events by age brackets first
                    const isAgeEligible = event.age_brackets?.some((bracket) => age >= bracket.min_age && age <= bracket.max_age);
                    if (isAgeEligible && event.codes) {
                        // Keep event as grouped with all codes
                        availableGroupedEvents.push({
                            ...event,
                            code: sanitizeEventCodes(event.codes).join(", "),
                        });
                    }
                }

                // 找出 required keys (individual events) - now using the grouped format
                const requiredEventIds = availableGroupedEvents
                    .filter((event) => event.type === "Individual")
                    .map((event) => getEventKey(event));

                // 设置所有可用事件，而不是排除required的
                setAvailableEvents(availableGroupedEvents);
                setOptions(availableGroupedEvents);

                if (comp) {
                    setTournament(comp);
                    const registrationPrice = user?.memberId ? comp.member_registration_fee : comp.registration_fee;
                    setPrice(registrationPrice ?? 0);
                    setTournamentData([
                        {
                            label: "Registration Price",
                            value: <div>RM{registrationPrice}</div>,
                        },
                        {
                            label: "Location",
                            value: (
                                <Link
                                    onClick={() =>
                                        window.open(
                                            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(comp?.address ?? "")}`,
                                            "_blank",
                                        )
                                    }
                                    hoverable={false}
                                >
                                    {comp?.country?.[0] && getCountryFlag(comp.country[0]) && (
                                        <img
                                            src={getCountryFlag(comp.country[0])}
                                            alt={`${comp.country[0]} flag`}
                                            style={{width: 20, height: 15, marginRight: 8, verticalAlign: "middle"}}
                                        />
                                    )}
                                    {comp?.address} ({comp?.country?.join(" / ")}) <IconLaunch />
                                </Link>
                            ),
                        },
                        {
                            label: "Venue",
                            value: <div>{comp?.venue}</div>,
                        },
                        {
                            label: "Date",
                            value: (
                                <div>
                                    {formatDate(comp?.start_date)} - {formatDate(comp?.end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Max Participants",
                            value: <div>{comp?.max_participants === 0 ? "No Limit" : comp?.max_participants}</div>,
                        },
                        {
                            label: "Registration dates",
                            value: (
                                <div>
                                    {formatDate(comp?.registration_start_date)} - {formatDate(comp?.registration_end_date)}
                                </div>
                            ),
                        },
                        {
                            label: "Description",
                            value: (
                                <Button onClick={() => setDescriptionModalVisible(true)} type="text">
                                    <IconExclamationCircle />
                                    view description
                                </Button>
                            ),
                        },
                        {
                            label: "Agenda",
                            value: comp?.agenda ? (
                                <Button type="text" onClick={() => window.open(`${comp?.agenda}`, "_blank")}>
                                    <IconCalendar /> View Agenda
                                </Button>
                            ) : (
                                "-"
                            ),
                        },
                    ]);
                }

                form.setFieldsValue({
                    user_name: user?.name,
                    id: user?.global_id,
                    age: age,
                    gender: user?.gender,
                    events_registered: requiredEventIds, // 一开始强制先选上 required events
                    phone_number: user?.phone_number,
                    organizer: user?.school ?? "",
                });

                // 初始化团队状态
                setHaveTeam(buildTeamEntries(requiredEventIds, availableGroupedEvents));

                setRequiredKeys(requiredEventIds); // 存起来供后续使用
            } catch (e) {
                setError("Failed to load tournament.");
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [tournamentId, user]);

    // Remove the problematic useEffect since we handle team updates in onChange

    if (error) return <Result status="error" title="Error" subTitle={error} />;
    return (
        <div className="flex flex-col md:flex-col bg-ghostwhite relative p-0 md:p-6 xl:p-10 gap-6 items-stretch">
            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                {tournament?.logo && <Image src={tournament.logo} alt="logo" width={200} />}
                <Descriptions
                    column={1}
                    title={
                        <Title style={{textAlign: "center", width: "100%"}} heading={3}>
                            {tournament?.name}
                        </Title>
                    }
                    data={tournamentData}
                    style={{marginBottom: 20}}
                    labelStyle={{textAlign: "right", paddingRight: 36}}
                />
                <Modal
                    title="Tournament Description"
                    visible={descriptionModalVisible}
                    onCancel={() => setDescriptionModalVisible(false)}
                    footer={null}
                    className={`m-10 w-1/2`}
                >
                    <MDEditor.Markdown source={tournament?.description ?? ""} />
                </Modal>
            </div>

            <div className="bg-white flex flex-col w-full h-fit gap-4 items-center p-2 md:p-6 xl:p-10 shadow-lg md:rounded-lg">
                <div className="w-full">
                    <Title heading={5}>Register for Event</Title>
                    <Form requiredSymbol={false} form={form} layout="vertical" onSubmit={handleRegister}>
                        <Form.Item disabled label="ID" field="id" rules={[{required: true}]}>
                            <Input disabled placeholder="Enter your ID" />
                        </Form.Item>
                        <Form.Item label="Name" field="user_name" rules={[{required: true}]}>
                            <Input disabled placeholder="Enter your name" />
                        </Form.Item>
                        <Form.Item disabled label="Age" field="age" rules={[{required: true}]}>
                            <InputNumber disabled placeholder="Enter your age" />
                        </Form.Item>
                        <Form.Item disabled label="Gender" field="gender" rules={[{required: true}]}>
                            <Select disabled placeholder="Update your gender at profile" options={["Male", "Female"]} />
                        </Form.Item>
                        <Form.Item disabled label="Phone Number" field="phone_number" rules={[{required: true}]}>
                            <Input disabled placeholder="Update your phone number at profile" />
                        </Form.Item>
                        <Form.Item disabled label="Organizer" field="organizer">
                            <Input disabled placeholder="Update your organizer at profile" />
                        </Form.Item>
                        <Form.Item
                            label={
                                <div>
                                    Select Event(s)
                                    <Tooltip content="Individual Events are required and cannot be deselected.">
                                        <IconExclamationCircle
                                            style={{
                                                margin: "0 8px",
                                                color: "rgb(var(--arcoblue-6))",
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                            }
                            field="events_registered"
                            rules={[{required: true}]}
                        >
                            <Select
                                placeholder="Select events"
                                style={{width: 345, marginRight: 20}}
                                mode="multiple"
                                defaultValue={requiredKeys}
                                onChange={(value: string[]) => {
                                    if (!availableEvents) return;
                                    // 确保个人赛事项不能被取消选择
                                    const finalValue = Array.from(new Set([...value, ...requiredKeys]));

                                    // 更新表单值
                                    form.setFieldsValue({events_registered: finalValue});

                                    // 更新团队事件的状态
                                    setHaveTeam(buildTeamEntries(finalValue));

                                    // 清理已取消选择的"寻找队伍"记录
                                    setLookingForTeams((prev) => prev.filter((eventId) => finalValue.includes(eventId)));
                                }}
                                notFoundContent={<Empty description="No Available Events" />}
                            >
                                {options?.map((option) => {
                                    const key = getEventKey(option);
                                    const isRequired = requiredKeys.includes(key);
                                    const displayText = getEventLabel(option);
                                    return (
                                        <Option
                                            key={key}
                                            value={key}
                                            disabled={isRequired}
                                            style={{
                                                opacity: isRequired ? 0.6 : 1,
                                                backgroundColor: isRequired ? "#f5f5f5" : "transparent",
                                            }}
                                        >
                                            {displayText} {isRequired && "(Required)"}
                                        </Option>
                                    );
                                })}
                            </Select>
                        </Form.Item>

                        {/* Individual Looking for Teams Section */}
                        <Form.Item shouldUpdate noStyle>
                            {(_, form) => {
                                const selectedEventIds: string[] = form.getFieldValue("events_registered") || [];
                                const teamEvents = selectedEventIds
                                    .map((eventId) => findEventByKey(eventId))
                                    .filter((event): event is ExpandedEvent => Boolean(event) && isTeamEvent(event));

                                if (teamEvents.length === 0) return null;

                                return (
                                    <div className="mb-6 p-4 border border-dashed border-blue-300 rounded-lg bg-blue-50">
                                        <Title heading={6} className="mb-3">
                                            🔍 Looking for Team?
                                        </Title>
                                        <Paragraph type="secondary" className="mb-3 text-sm">
                                            If you need help finding teammates for team events, check the events below. Tournament
                                            organizers will help connect you with other participants.
                                        </Paragraph>

                                        <div className="space-y-2">
                                            {teamEvents.map((event) => {
                                                const eventId = getEventKey(event);
                                                const eventLabel = getEventLabel(event);
                                                const lookingForTeamMembers = form.getFieldValue(
                                                    `teams.${eventId}.looking_for_team_members`,
                                                );
                                                return (
                                                    <Checkbox
                                                        key={`individual-looking-${eventId}`}
                                                        checked={lookingForTeams.includes(eventId)}
                                                        disabled={!!lookingForTeamMembers}
                                                        onChange={(checked: boolean) => {
                                                            if (checked) {
                                                                // Uncheck 'Looking for Team Members' if checked
                                                                form.setFieldValue(
                                                                    `teams.${eventId}.looking_for_team_members`,
                                                                    false,
                                                                );
                                                                setLookingForTeams((prev) =>
                                                                    prev.includes(eventId) ? prev : [...prev, eventId],
                                                                );
                                                            } else {
                                                                setLookingForTeams((prev) => prev.filter((id) => id !== eventId));
                                                            }
                                                        }}
                                                    >
                                                        Looking for teammates in <strong>{eventLabel}</strong>
                                                    </Checkbox>
                                                );
                                            })}
                                        </div>

                                        {lookingForTeams.length > 0 && (
                                            <div className="mt-3 p-2 bg-green-50 rounded text-sm text-green-700">
                                                ✅ We'll help you find teammates for:{" "}
                                                {lookingForTeams
                                                    .map((eventId) => getEventLabel(findEventByKey(eventId)))
                                                    .join(", ")}
                                            </div>
                                        )}
                                    </div>
                                );
                            }}
                        </Form.Item>

                        <Form.Item shouldUpdate noStyle>
                            <div className="flex flex-row w-full gap-10">
                                {haveTeam
                                    .filter((entry) => entry.requiresTeam)
                                    .map((entry) => {
                                        const eventId = entry.eventId;
                                        const eventLabel = entry.label;
                                        const eventType = entry.event?.type ?? "";
                                        const lowerEventType = eventType.toLowerCase();
                                        const isParentChild = eventType === "Parent & Child";
                                        const requiredTeamSize =
                                            entry.event?.teamSize ??
                                            (isParentChild
                                                ? 2
                                                : lowerEventType === "double"
                                                  ? 2
                                                  : lowerEventType === "team relay"
                                                    ? 4
                                                    : undefined);
                                        const requiredMemberCount =
                                            requiredTeamSize !== undefined ? Math.max(requiredTeamSize - 1, 0) : undefined;

                                        return (
                                            <div key={eventId}>
                                                <div className="text-center">{eventLabel}</div>
                                                <Divider />
                                                <Form.Item field={`teams.${eventId}.label`} initialValue={eventLabel} noStyle>
                                                    <Input hidden />
                                                </Form.Item>

                                                {/* Team Name */}
                                                <Form.Item
                                                    shouldUpdate={() =>
                                                        form.getFieldValue(`teams.${eventId}.looking_for_team_members`)
                                                    }
                                                >
                                                    {() => {
                                                        const isLookingTopLevel = lookingForTeams.includes(eventId);
                                                        return (
                                                            <Form.Item
                                                                field={`teams.${eventId}.name`}
                                                                label="Team Name"
                                                                rules={isLookingTopLevel ? [] : [{required: true}]}
                                                            >
                                                                <Input
                                                                    disabled={isLookingTopLevel}
                                                                    placeholder="Please enter team name"
                                                                />
                                                            </Form.Item>
                                                        );
                                                    }}
                                                </Form.Item>

                                                {/* Team Leader */}
                                                <Form.Item
                                                    shouldUpdate={() =>
                                                        form.getFieldValue(`teams.${eventId}.looking_for_team_members`)
                                                    }
                                                >
                                                    {() => {
                                                        const isLookingTopLevel = lookingForTeams.includes(eventId);
                                                        // If looking for teammates, always set leader to current user
                                                        if (isLookingTopLevel && user?.global_id) {
                                                            // Set the field value directly so it is included in submission
                                                            form.setFieldValue(`teams.${eventId}.leader`, user.global_id);
                                                        }
                                                        return (
                                                            <Form.Item
                                                                field={`teams.${eventId}.leader`}
                                                                label="Team Leader Global ID"
                                                                rules={isLookingTopLevel ? [] : [{required: true}]}
                                                                initialValue={user?.global_id ?? ""}
                                                            >
                                                                <Input
                                                                    disabled
                                                                    placeholder="Please enter team leader global ID"
                                                                />
                                                            </Form.Item>
                                                        );
                                                    }}
                                                </Form.Item>

                                                {/* Team Member */}
                                                <Form.Item
                                                    shouldUpdate={() =>
                                                        form.getFieldValue(`teams.${eventId}.looking_for_team_members`)
                                                    }
                                                >
                                                    {() => {
                                                        const isLookingTopLevel = lookingForTeams.includes(eventId);
                                                        return (
                                                            <Form.Item
                                                                field={`teams.${eventId}.member`}
                                                                label={
                                                                    <div>
                                                                        {isParentChild ? "Parent Global ID" : "Team Member"}
                                                                        <Tooltip
                                                                            content={
                                                                                requiredMemberCount !== undefined
                                                                                    ? `Enter ${requiredMemberCount} team member${
                                                                                          requiredMemberCount === 1 ? "" : "s"
                                                                                      } (excluding the leader)`
                                                                                    : isParentChild
                                                                                      ? "Enter Parent's Global ID. You (the child) are automatically the leader."
                                                                                      : "Must Enter Team Member Global ID. Not include Team Leader Global ID"
                                                                            }
                                                                        >
                                                                            <IconExclamationCircle
                                                                                style={{
                                                                                    margin: "0 8px",
                                                                                    color: "rgb(var(--arcoblue-6))",
                                                                                }}
                                                                            />
                                                                        </Tooltip>
                                                                    </div>
                                                                }
                                                            >
                                                                <Select
                                                                    mode="multiple"
                                                                    allowCreate={{
                                                                        formatter: (inputValue: string, creating: boolean) => ({
                                                                            value: inputValue,
                                                                            label: `${creating ? "Enter to create: " : ""}${inputValue}`,
                                                                        }),
                                                                    }}
                                                                    placeholder={
                                                                        isParentChild
                                                                            ? "Input Parent Global ID"
                                                                            : "Input Team Member Global ID"
                                                                    }
                                                                    allowClear
                                                                    disabled={isLookingTopLevel}
                                                                    style={{width: 345, flex: 1}}
                                                                />
                                                            </Form.Item>
                                                        );
                                                    }}
                                                </Form.Item>

                                                {/* Looking for Team Members */}
                                                <Form.Item
                                                    field={`teams.${eventId}.looking_for_team_members`}
                                                    triggerPropName="checked"
                                                >
                                                    <Checkbox
                                                        disabled={lookingForTeams.includes(eventId)}
                                                        onChange={(checked: boolean) => {
                                                            if (checked) {
                                                                // Uncheck 'Looking for Teammates' if checked
                                                                setLookingForTeams((prev) => prev.filter((id) => id !== eventId));
                                                            }
                                                        }}
                                                    >
                                                        Looking for Team Members
                                                    </Checkbox>
                                                </Form.Item>
                                            </div>
                                        );
                                    })}
                            </div>
                        </Form.Item>

                        {/* Payment Methods Section */}
                        {tournament?.payment_methods && tournament.payment_methods.length > 0 && (
                            <div className="mb-6 p-4 border border-solid border-gray-300 rounded-lg bg-gray-50">
                                <Title heading={5} className="mb-3">
                                    💳 Payment Methods
                                </Title>
                                <Paragraph type="secondary" className="mb-4 text-base">
                                    Please use one of the following payment methods to complete your registration fee of{" "}
                                    <strong>RM{price}</strong>
                                </Paragraph>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {tournament.payment_methods.map((method, index) => (
                                        <div
                                            key={method.id || index}
                                            className="border border-solid border-blue-200 rounded-lg p-4 bg-white"
                                        >
                                            <div className="flex flex-col gap-3">
                                                {method.qr_code_image && (
                                                    <div className="flex justify-center">
                                                        <Image
                                                            src={method.qr_code_image}
                                                            alt={`Payment QR Code ${index + 1}`}
                                                            width={200}
                                                            height={200}
                                                            preview
                                                            className="rounded"
                                                        />
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="text-base text-gray-600 mb-1 font-medium">Account Name</div>
                                                    <div className="font-semibold text-lg">{method.account_name}</div>
                                                </div>
                                                <div>
                                                    <div className="text-base text-gray-600 mb-1 font-medium">Account Number</div>
                                                    <div className="font-semibold text-lg font-mono">{method.account_number}</div>
                                                </div>
                                                {method.description && (
                                                    <div>
                                                        <div className="text-base text-gray-600 mb-1 font-medium">Details</div>
                                                        <div className="text-base">{method.description}</div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-4 p-3 bg-yellow-50 rounded text-base text-yellow-800">
                                    ⚠️ <strong>Important:</strong> After making the payment, please upload your payment proof
                                    below.
                                </div>
                            </div>
                        )}

                        <Form.Item
                            label={
                                <div>
                                    Payment Proof
                                    <Tooltip content="Please upload a picture of your payment proof.">
                                        <IconExclamationCircle
                                            style={{
                                                margin: "0 8px",
                                                color: "rgb(var(--arcoblue-6))",
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                            }
                            field="payment_proof"
                            rules={[{required: !paymentProofUrl, message: "Payment proof is required."}]}
                        >
                            <Upload
                                className={"w-full flex flex-col items-center justify-center mb-10"}
                                drag
                                multiple={false}
                                limit={1}
                                accept="image/jpeg,image/png,image/gif"
                                customRequest={async (option: {
                                    file: File;
                                    onSuccess?: (file: File) => void;
                                    onError?: (error: Error) => void;
                                    onProgress?: (progress: number) => void;
                                }) => {
                                    const {file, onSuccess, onError, onProgress} = option;
                                    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
                                    const validTypes = ["image/jpeg", "image/png", "image/gif"];

                                    if (!validTypes.includes(file.type)) {
                                        Message.error("Invalid file type. Please upload a JPG, PNG, or GIF.");
                                        onError?.(new Error("Invalid file type"));
                                        return;
                                    }

                                    if (file.size > MAX_SIZE) {
                                        Message.error("File size exceeds 10MB limit");
                                        onError?.(new Error("File size exceeds 10MB limit"));
                                        return;
                                    }

                                    if (!user?.global_id) {
                                        Message.error("User not authenticated");
                                        onError?.(new Error("User not authenticated"));
                                        return;
                                    }
                                    try {
                                        setLoading(true);
                                        const downloadURL = await uploadFile(
                                            file as File,
                                            `tournaments/${tournamentId}/registrations/payment_proof`,
                                            user.global_id,
                                            (progress) => {
                                                onProgress?.(progress);
                                            },
                                        );
                                        setPaymentProofUrl(downloadURL);
                                        setLoading(false);
                                        onSuccess?.(file);
                                    } catch (err) {
                                        Message.error("Failed to upload file.");
                                        onError?.(err as Error);
                                    }
                                }}
                                tip="Only pictures can be uploaded. (JPG, PNG, GIF)"
                            />
                        </Form.Item>

                        <Form.Item>
                            <Button type="primary" htmlType="submit" long loading={loading} disabled={loading}>
                                Register
                            </Button>
                        </Form.Item>
                    </Form>
                </div>
            </div>
        </div>
    );
}
