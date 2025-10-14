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
import {createTeam, fetchTournamentById} from "@/services/firebase/tournamentsService";
import {formatDate} from "@/utils/Date/formatDate";
import {sendProtectedEmail} from "@/utils/SenderGrid/sendMail";
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

    const buildTeamEntries = (eventIds: string[]): TeamEntry[] =>
        eventIds.map((eventId) => {
            const event = findEventByKey(eventId);
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
                if (!team.looking_for_team_members && leaderId && memberIds.includes(leaderId)) {
                    Message.error(`In team "${team.name}", team leader cannot be included in team members.`);
                    setLoading(false);
                    throw new Error(`Team leader ${leaderId} cannot be a member in team ${teamId}`);
                }

                const userInTeam = leaderId === user.global_id || memberIds.includes(user.global_id ?? "");
                if (!team.looking_for_team_members && !userInTeam) {
                    Message.error(`In team "${team.name}", you must be either leader or one of the members.`);
                    setLoading(false);
                    throw new Error(`User ${user.global_id} is not in team ${teamId}`);
                }
            }

            const expandedEventSelections = new Set<string>();
            for (const eventId of values.events_registered ?? []) {
                expandedEventSelections.add(eventId);
                const eventDetails = findEventByKey(eventId);
                if (eventDetails) {
                    expandedEventSelections.add(eventDetails.type);
                    for (const code of sanitizeEventCodes(eventDetails.codes)) {
                        expandedEventSelections.add(code);
                        expandedEventSelections.add(`${code}-${eventDetails.type}`);
                    }
                }
            }

            const registrationData: Registration = {
                tournament_id: tournamentId,
                user_id: user?.global_id ?? "",
                user_name: values.user_name,
                age: form.getFieldValue("age"),
                country: user?.country?.[0] ?? "",
                phone_number: values.phone_number,
                organizer: values.organizer ?? "",
                events_registered: Array.from(expandedEventSelections),
                registrationFee: tournament.registration_fee,
                memberRegistrationFee: tournament.member_registration_fee,
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
                    .map((id) => (id ? {global_id: id, verified: false} : null))
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
                let largest_age = 0;

                if (ages.length > 0) {
                    if (eventType.includes("team relay")) {
                        // Team relay: use average age
                        largest_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (eventType.includes("double")) {
                        // Double: use average age but check 10-year range constraint
                        const minAge = Math.min(...ages);
                        const maxAge = Math.max(...ages);
                        if (maxAge - minAge > 10) {
                            throw new Error(`Double event age range cannot exceed 10 years (current range: ${minAge}-${maxAge})`);
                        }
                        largest_age = Math.round(ages.reduce((sum, age) => sum + age, 0) / ages.length);
                    } else if (eventType.includes("parent") && eventType.includes("child")) {
                        // Parent & Child: use child's age (registrant's age)
                        const registrantAge =
                            user?.birthdate && tournament?.start_date
                                ? getAgeAtTournament(user.birthdate, tournament.start_date)
                                : 0;
                        largest_age = registrantAge;
                    } else {
                        // Default: use largest age (for backward compatibility)
                        largest_age = Math.max(...ages);
                    }
                }

                // Create the team first
                const teamId = await createTeam(tournamentId, {
                    name: teamData.name,
                    leader_id: teamData.leader,
                    members,
                    event_ids: [eventId],
                    events: Array.from(teamEventKeys),
                    registration_id: registrationId,
                    largest_age,
                    looking_for_member: false, // We handle recruitment separately now
                });

                // If looking for members, create a recruitment record
                if (teamData.looking_for_team_members) {
                    await createTeamRecruitment({
                        team_id: teamId,
                        tournament_id: tournamentId,
                        team_name: teamData.name,
                        leader_id: teamData.leader,
                        events: Array.from(teamEventKeys),
                        requirements: "", // You can add form fields for these if needed
                        max_members_needed: 3, // You can add form fields for these if needed
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
                            await sendProtectedEmail(email, tournamentId, teamId, globalId);
                        }
                    } catch (err) {
                        console.error(`❌ Failed to send verification to ${globalId}`, err);
                    }
                }
            }

            // Handle individual recruitment if user is looking for teams
            if (lookingForTeams.length > 0) {
                try {
                    await createIndividualRecruitment({
                        participant_id: user.global_id ?? "",
                        tournament_id: tournamentId,
                        participant_name: user.name ?? "",
                        age: getAgeAtTournament(user.birthdate ?? new Date(), tournament.start_date ?? new Date()),
                        gender: (registrationData.gender ?? "Male") as "Male" | "Female",
                        country: registrationData.country ?? "",
                        events_interested: lookingForTeams,
                        phone_number: registrationData.phone_number,
                        additional_info: `Participant is looking for teams in the following events: ${lookingForTeams
                            .map((eventId) => getEventLabel(findEventByKey(eventId)))
                            .join(", ")}`,
                    });
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
        const fetch = async () => {
            if (!tournamentId) return;
            setLoading(true);
            try {
                const comp = await fetchTournamentById(tournamentId);
                const age = user?.birthdate && comp?.start_date ? getAgeAtTournament(user.birthdate, comp.start_date) : 0;

                // Filter events by age brackets and keep them as grouped events
                const availableGroupedEvents: ExpandedEvent[] = [];
                for (const event of comp?.events ?? []) {
                    // Filter events by age brackets first
                    const isAgeEligible = event.age_brackets?.some((bracket) => age >= bracket.min_age && age <= bracket.max_age);
                    if (isAgeEligible && event.codes) {
                        // Keep event as grouped with all codes
                        availableGroupedEvents.push({
                            ...event,
                            code: event.codes.join(", "), // Display all codes joined for compatibility
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
                setHaveTeam(buildTeamEntries(requiredEventIds));

                setRequiredKeys(requiredEventIds); // 存起来供后续使用
            } catch (e) {
                setError("Failed to load tournament.");
                console.error(e);
            } finally {
                setLoading(false);
            }
        };
        fetch();
    }, [tournamentId]);

    // Remove the problematic useEffect since we handle team updates in onChange

    if (error) return <Result status="error" title="Error" subTitle={error} />;
    return (
        <div className="flex flex-col md:flex-col h-full bg-ghostwhite relative overflow-auto p-0 md:p-6 xl:p-10 gap-6 items-stretch">
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
                                onChange={(value) => {
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
                                            🔍 Looking for Teammates?
                                        </Title>
                                        <Paragraph type="secondary" className="mb-3 text-sm">
                                            If you need help finding teammates for team events, check the events below. Tournament
                                            organizers will help connect you with other participants.
                                        </Paragraph>

                                        <div className="space-y-2">
                                            {teamEvents.map((event) => {
                                                const eventId = getEventKey(event);
                                                const eventLabel = getEventLabel(event);
                                                return (
                                                    <Checkbox
                                                        key={`individual-looking-${eventId}`}
                                                        checked={lookingForTeams.includes(eventId)}
                                                        onChange={(checked) => {
                                                            if (checked) {
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
                                                        return (
                                                            <Form.Item
                                                                field={`teams.${eventId}.leader`}
                                                                label="Team Leader Global ID"
                                                                rules={isLookingTopLevel ? [] : [{required: true}]}
                                                                initialValue={!isLookingTopLevel ? (user?.global_id ?? "") : ""}
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
                                                                                isParentChild
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
                                                                rules={
                                                                    isLookingTopLevel
                                                                        ? []
                                                                        : [
                                                                              {required: true},
                                                                              {
                                                                                  validator: (value, callback) => {
                                                                                      if (!value || value.length === 0) {
                                                                                          const memberType = isParentChild
                                                                                              ? "parent"
                                                                                              : "team members";
                                                                                          callback(`Please enter ${memberType}`);
                                                                                          return;
                                                                                      }
                                                                                      if (
                                                                                          lowerEventType === "team relay" &&
                                                                                          (value.length < 3 || value.length > 4)
                                                                                      ) {
                                                                                          callback(
                                                                                              "Team relay must have 3 to 4 members",
                                                                                          );
                                                                                          return;
                                                                                      }
                                                                                      if (
                                                                                          lowerEventType === "double" &&
                                                                                          value.length !== 1
                                                                                      ) {
                                                                                          callback(
                                                                                              "Double must have exactly 1 member",
                                                                                          );
                                                                                          return;
                                                                                      }
                                                                                      if (isParentChild && value.length !== 1) {
                                                                                          callback(
                                                                                              "Parent & Child must have exactly 1 parent",
                                                                                          );
                                                                                          return;
                                                                                      }
                                                                                      callback();
                                                                                  },
                                                                              },
                                                                          ]
                                                                }
                                                            >
                                                                <Select
                                                                    mode="multiple"
                                                                    allowCreate={{
                                                                        formatter: (inputValue, creating) => ({
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
                                                        onChange={() => {
                                                            // Don't clear form fields anymore
                                                            // Just let the checkbox state manage itself via Form.Item field
                                                            // The form validation will handle required/optional fields based on checked state
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
                                customRequest={async (option) => {
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
