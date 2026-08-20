import {createHash, randomUUID} from "node:crypto";
import {
    type DocumentData,
    type Firestore,
    type QueryDocumentSnapshot,
    Timestamp,
    type Transaction,
    type WriteBatch,
} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

export type ImportIdentityType = "MYKAD" | "PASSPORT" | "NONE";
export type ImportGender = "Male" | "Female";

export type ImportAthleteInput = {
    workbookKey: string;
    name: string;
    identityType: ImportIdentityType;
    identityNumber: string | null;
    identityKey: string | null;
    passportCountry: string | null;
    birthdate: Date;
    gender: ImportGender;
    country: [string, string];
    sourceSheet: string;
    sourceRow: number;
    parentOnly: boolean;
    userDocId?: string;
    globalId?: string;
};

export type ImportTeamInput = {
    eventId: string;
    eventType: string;
    sheetName: string;
    sourceRow: number;
    name: string;
    members: string[];
};

export type ParsedWorkbookInput = {
    athletes: Map<string, ImportAthleteInput>;
    invalidAthleteKeys: Set<string>;
    baseRosterKeys: Set<string>;
    registrationsByAthleteKey: Map<string, Set<string>>;
    teams: ImportTeamInput[];
    rows: Array<{
        sheet: string;
        row: number;
        level: "error" | "warning" | "info";
        message: string;
        category?: "errors" | "warnings" | "athletes" | "registrations" | "teams";
    }>;
};

export type ImportPlanSummary = {
    profilesCreated: number;
    profilesReused: number;
    registrationsCreated: number;
    registrationsUpdated: number;
    registrationsUnchanged: number;
    teamsCreated: number;
    teamsUpdated: number;
    teamsUnchanged: number;
    conflicts: number;
};

export type ImportPlan = {
    checksum: string;
    summary: ImportPlanSummary;
    conflicts: string[];
};

export type ImportCommitSummary = ImportPlanSummary & {
    createdRegistrations: number;
    updatedRegistrations: number;
    createdTeams: number;
};

type ExistingProfile = {
    id: string;
    globalId: string;
    data: DocumentData;
};

const normalizeText = (value: string): string =>
    value.normalize("NFKD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();

const normalizeIdentity = (value: unknown): string =>
    String(value ?? "")
        .replace(/[^A-Z0-9]/gi, "")
        .toUpperCase();

const storedIdentityMatches = (data: DocumentData, athlete: ImportAthleteInput): boolean => {
    const storedNumber = normalizeIdentity(data.IC);
    const importedNumber = normalizeIdentity(athlete.identityNumber);
    if (!storedNumber || storedNumber !== importedNumber) return false;

    const storedType = String(data.identity_type ?? "").toUpperCase();
    const inferredType = /^\d{12}$/.test(storedNumber) ? "MYKAD" : "PASSPORT";
    const effectiveType = storedType || inferredType;
    if (athlete.identityType === "MYKAD") return effectiveType === "MYKAD";
    if (effectiveType === "MYKAD") return false;

    const storedCountry = normalizeIdentity(data.passport_country ?? normalizedCountry(data.country)[0]);
    const importedCountry = normalizeIdentity(athlete.passportCountry ?? athlete.country[0]);
    return !storedCountry || !importedCountry || storedCountry === importedCountry;
};

const normalizeEventType = (value: string): string => {
    const normalized = normalizeText(value).replace(/&/g, "and");
    const aliases: Record<string, string> = {
        double: "double",
        doubles: "double",
        "stack up champion": "stackout champion",
        "stack out champion": "stackout champion",
        "stackout champion": "stackout champion",
        "time relay": "team relay",
        "team relay": "team relay",
    };
    return aliases[normalized] ?? normalized;
};

const canonicalize = (value: unknown): unknown => {
    if (value instanceof Timestamp) return {__timestamp: value.toDate().toISOString()};
    if (value instanceof Date) return {__date: value.toISOString()};
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, entry]) => [key, canonicalize(entry)]),
        );
    }
    return value;
};

export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

export const stableChecksum = (value: unknown): string => sha256(JSON.stringify(canonicalize(value)));

export const importIdentityKey = (athlete: ImportAthleteInput): string => {
    const material = athlete.identityKey?.trim()
        ? `IDENTITY:${athlete.identityKey.trim().toUpperCase()}`
        : [
              "NO_ID",
              normalizeText(athlete.name),
              athlete.birthdate.toISOString().slice(0, 10),
              normalizeText(athlete.gender),
              ...athlete.country.map(normalizeText),
          ].join("|");
    return sha256(material);
};

export const registrationIdentityKey = (tournamentId: string, profileId: string): string =>
    sha256(`registration|${tournamentId.trim()}|${profileId.trim()}`);

export const importedTeamIdentityKey = (tournamentId: string, eventId: string, globalIds: readonly string[]): string =>
    sha256(`team|${tournamentId.trim()}|${eventId.trim()}|${[...globalIds].sort().join("|")}`);

const timestampDate = (value: unknown): Date | null => {
    if (value instanceof Timestamp) return value.toDate();
    if (value instanceof Date) return value;
    if (typeof value === "string" || typeof value === "number") {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
};

const normalizedCountry = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === "string").map(normalizeText);

const profileMatchesNoIdAthlete = (data: DocumentData, athlete: ImportAthleteInput): boolean => {
    const birthdate = timestampDate(data.birthdate);
    if (!birthdate || birthdate.toISOString().slice(0, 10) !== athlete.birthdate.toISOString().slice(0, 10)) return false;
    if (normalizeText(String(data.name ?? "")) !== normalizeText(athlete.name)) return false;
    if (normalizeText(String(data.gender ?? "")) !== normalizeText(athlete.gender)) return false;
    const storedCountry = normalizedCountry(data.country);
    const importedCountry = athlete.country.map(normalizeText);
    return importedCountry.every((entry, index) => storedCountry[index] === entry);
};

const findExistingProfileCandidates = async (
    database: Firestore,
    athlete: ImportAthleteInput,
    identityHash: string,
): Promise<QueryDocumentSnapshot[]> => {
    const identityIndex = await database.collection("profile_identity_keys").doc(identityHash).get();
    if (identityIndex.exists) {
        const profileId = String(identityIndex.data()?.profile_id ?? "");
        if (!profileId) throw new HttpsError("failed-precondition", "A profile identity key has no profile mapping.");
        const profile = await database.collection("users").doc(profileId).get();
        if (!profile.exists) throw new HttpsError("failed-precondition", "A profile identity key points to a missing profile.");
        return [profile as QueryDocumentSnapshot];
    }

    if (athlete.identityKey) {
        const keyed = await database.collection("users").where("identity_key", "==", athlete.identityKey).limit(3).get();
        if (!keyed.empty) return keyed.docs;

        const candidates = new Map<string, QueryDocumentSnapshot>();
        for (const identityNumber of [athlete.identityNumber?.trim(), normalizeIdentity(athlete.identityNumber)]) {
            if (!identityNumber) continue;
            const legacy = await database.collection("users").where("IC", "==", identityNumber).limit(3).get();
            for (const snapshot of legacy.docs) {
                if (storedIdentityMatches(snapshot.data(), athlete)) candidates.set(snapshot.id, snapshot);
            }
        }
        return [...candidates.values()];
    }

    const indexed = await database.collection("users").where("import_identity_key", "==", identityHash).limit(3).get();
    if (!indexed.empty) return indexed.docs;

    const nameSearches = new Set([normalizeText(athlete.name), athlete.name.trim().replace(/\s+/g, " ").toLowerCase()]);
    const sameName = new Map<string, QueryDocumentSnapshot>();
    for (const nameSearch of nameSearches) {
        const matches = await database.collection("users").where("name_search", "==", nameSearch).get();
        for (const snapshot of matches.docs) sameName.set(snapshot.id, snapshot);
    }
    return [...sameName.values()].filter((snapshot) => profileMatchesNoIdAthlete(snapshot.data(), athlete));
};

const profileFromSnapshot = (snapshot: QueryDocumentSnapshot): ExistingProfile => ({
    id: snapshot.id,
    globalId: String(snapshot.data().global_id ?? ""),
    data: snapshot.data(),
});

const registrationBelongsToProfile = (data: DocumentData, profile: ExistingProfile): boolean =>
    data.profile_id === profile.id ||
    data.user_id === profile.id ||
    data.global_id === profile.globalId ||
    data.user_global_id === profile.globalId;

const isImportManaged = (data: DocumentData): boolean =>
    data.registration_source === "admin_import" || typeof data.import_batch_id === "string";

const sortedStrings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : [])
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .sort();

const sameStrings = (left: unknown, right: readonly string[]): boolean =>
    JSON.stringify(sortedStrings(left)) === JSON.stringify([...right].sort());

const teamParticipantIds = (data: DocumentData): string[] =>
    [
        typeof data.leader_id === "string" ? data.leader_id : "",
        ...(Array.isArray(data.members)
            ? data.members.map((member: unknown) =>
                  member && typeof member === "object" && typeof (member as {global_id?: unknown}).global_id === "string"
                      ? ((member as {global_id: string}).global_id ?? "")
                      : "",
              )
            : []),
    ].filter(Boolean);

const parsedProfileEntries = (parsed: ParsedWorkbookInput): [string, ImportAthleteInput][] =>
    [...parsed.athletes.entries()].sort(([left], [right]) => left.localeCompare(right));

const parsedRegistrationEntries = (parsed: ParsedWorkbookInput): [string, ImportAthleteInput][] =>
    [...parsed.athletes.entries()]
        .filter(([, athlete]) => !athlete.parentOnly)
        .sort(([left], [right]) => left.localeCompare(right));

const resolveProfilesForPlan = async (
    database: Firestore,
    parsed: ParsedWorkbookInput,
): Promise<{profiles: Map<string, ExistingProfile | null>; conflicts: string[]; conflictedKeys: Set<string>}> => {
    const profiles = new Map<string, ExistingProfile | null>();
    const conflicts: string[] = [];
    const conflictedKeys = new Set<string>();
    for (const [athleteKey, athlete] of parsedProfileEntries(parsed)) {
        const matches = await findExistingProfileCandidates(database, athlete, importIdentityKey(athlete));
        if (matches.length > 1) {
            conflicts.push(`${athlete.name}: multiple profiles match the imported identity.`);
            conflictedKeys.add(athleteKey);
            profiles.set(athleteKey, null);
            continue;
        }
        profiles.set(athleteKey, matches[0] ? profileFromSnapshot(matches[0]) : null);
    }
    return {profiles, conflicts, conflictedKeys};
};

const desiredTeamIdentity = (
    tournamentId: string,
    team: ImportTeamInput,
    profiles: Map<string, ExistingProfile | null>,
): string | null => {
    const ids = team.members.map((memberKey) => profiles.get(memberKey)?.globalId ?? "");
    return ids.some((value) => !value) ? null : importedTeamIdentityKey(tournamentId, team.eventId, ids);
};

export const buildImportPlan = async (
    database: Firestore,
    tournamentId: string,
    parsed: ParsedWorkbookInput,
    workbookSha256: string,
): Promise<ImportPlan> => {
    const [{profiles, conflicts, conflictedKeys}, registrations, teams] = await Promise.all([
        resolveProfilesForPlan(database, parsed),
        database.collection("registrations").where("tournament_id", "==", tournamentId).get(),
        database.collection("teams").where("tournament_id", "==", tournamentId).get(),
    ]);
    const summary: ImportPlanSummary = {
        profilesCreated: 0,
        profilesReused: 0,
        registrationsCreated: 0,
        registrationsUpdated: 0,
        registrationsUnchanged: 0,
        teamsCreated: 0,
        teamsUpdated: 0,
        teamsUnchanged: 0,
        conflicts: 0,
    };
    const planEntries: unknown[] = [];

    for (const [athleteKey, athlete] of parsedProfileEntries(parsed)) {
        const profile = profiles.get(athleteKey) ?? null;
        if (profile) summary.profilesReused += 1;
        else if (!conflictedKeys.has(athleteKey)) summary.profilesCreated += 1;
        const desiredEvents = [...(parsed.registrationsByAthleteKey.get(athleteKey) ?? [])].sort();
        const matches = !athlete.parentOnly && profile
            ? registrations.docs.filter((snapshot) => registrationBelongsToProfile(snapshot.data(), profile))
            : [];
        if (!athlete.parentOnly) {
            if (matches.length > 1) {
                conflicts.push(`${athlete.name}: multiple registrations already exist for this tournament.`);
            } else if (matches.length === 1 && !isImportManaged(matches[0].data())) {
                conflicts.push(`${athlete.name}: an existing member/admin registration will not be overwritten.`);
            } else if (matches.length === 0) {
                summary.registrationsCreated += 1;
            } else if (sameStrings(matches[0].data().events_registered ?? matches[0].data().event_ids, desiredEvents)) {
                summary.registrationsUnchanged += 1;
            } else {
                summary.registrationsUpdated += 1;
            }
        }
        planEntries.push({
            athleteKey,
            identityKey: importIdentityKey(athlete),
            profileId: profile?.id ?? null,
            globalId: profile?.globalId ?? null,
            registrationId: matches[0]?.id ?? null,
            registrationSource: matches[0]?.data().registration_source ?? null,
            events: desiredEvents,
        });
    }

    const desiredTeamKeys = new Set<string>();
    for (const team of parsed.teams) {
        const key = desiredTeamIdentity(tournamentId, team, profiles);
        if (!key) {
            summary.teamsCreated += 1;
            continue;
        }
        desiredTeamKeys.add(key);
        const matchingTeams = teams.docs.filter((snapshot) => {
            const data = snapshot.data();
            return importedTeamIdentityKey(tournamentId, String(data.event_id ?? ""), teamParticipantIds(data)) === key;
        });
        if (matchingTeams.length > 1) {
            conflicts.push(`${team.name || team.eventType}: multiple teams contain the same participants.`);
        } else if (matchingTeams.length === 0) {
            summary.teamsCreated += 1;
        } else if (!isImportManaged(matchingTeams[0].data())) {
            conflicts.push(`${team.name || team.eventType}: a manual team already contains the same participants.`);
        } else if (String(matchingTeams[0].data().name ?? "") === String(team.name || "")) {
            summary.teamsUnchanged += 1;
        } else {
            summary.teamsUpdated += 1;
        }
    }

    summary.conflicts = conflicts.length;
    const planMaterial = {
        tournamentId,
        workbookSha256,
        entries: planEntries,
        teams: [...desiredTeamKeys].sort(),
        existingTeamIds: teams.docs.map((document) => document.id).sort(),
        conflicts: [...conflicts].sort(),
    };
    return {checksum: stableChecksum(planMaterial), summary, conflicts};
};

export const appendImportPlanRows = (rows: ParsedWorkbookInput["rows"], plan: ImportPlan): void => {
    rows.push({
        sheet: "Import plan",
        row: 0,
        level: "info",
        category: "registrations",
        message: `Profiles: ${plan.summary.profilesCreated} new / ${plan.summary.profilesReused} reused; registrations: ${plan.summary.registrationsCreated} new / ${plan.summary.registrationsUpdated} updated / ${plan.summary.registrationsUnchanged} unchanged; teams: ${plan.summary.teamsCreated} new / ${plan.summary.teamsUpdated} updated / ${plan.summary.teamsUnchanged} unchanged.`,
    });
    for (const conflict of plan.conflicts) {
        rows.push({sheet: "Import plan", row: 0, level: "error", category: "errors", message: conflict});
    }
};

export const nextAllowedGlobalIdNumber = (current: number): number => {
    let candidate = Math.max(0, Math.floor(current)) + 1;
    while (String(candidate).includes("4")) candidate += 1;
    return candidate;
};

const reserveNextGlobalId = async (
    database: Firestore,
    transaction: Transaction,
    counterData: DocumentData | undefined,
): Promise<{globalId: string; numericId: number}> => {
    let numericId = nextAllowedGlobalIdNumber(Number(counterData?.count ?? 0));
    for (;;) {
        const globalId = String(numericId).padStart(5, "0");
        const [existingProfile, retired] = await Promise.all([
            transaction.get(database.collection("users").where("global_id", "==", globalId).limit(1)),
            transaction.get(database.collection("retired_global_ids").doc(globalId)),
        ]);
        if (existingProfile.empty && !retired.exists) return {globalId, numericId};
        numericId = nextAllowedGlobalIdNumber(numericId);
    }
};

const ageAtTournament = (birthdate: Date, startDate: Date): number => {
    let age = startDate.getUTCFullYear() - birthdate.getUTCFullYear();
    const birthday = new Date(Date.UTC(startDate.getUTCFullYear(), birthdate.getUTCMonth(), birthdate.getUTCDate()));
    if (startDate.getTime() < birthday.getTime()) age -= 1;
    return age;
};

const resolveAthleteProfile = async (
    database: Firestore,
    athlete: ImportAthleteInput,
    importBatchId: string,
): Promise<ExistingProfile> => {
    const identityHash = importIdentityKey(athlete);
    const candidates = await findExistingProfileCandidates(database, athlete, identityHash);
    if (candidates.length > 1) {
        throw new HttpsError("failed-precondition", `${athlete.name} matches multiple profiles and requires review.`);
    }
    const candidateId = candidates[0]?.id ?? null;
    const identityRef = database.collection("profile_identity_keys").doc(identityHash);
    const counterRef = database.collection("counters").doc("userCounter");

    const resolved = await database.runTransaction(async (transaction) => {
        const [identitySnapshot, counterSnapshot] = await Promise.all([
            transaction.get(identityRef),
            transaction.get(counterRef),
        ]);
        const mappedProfileId = identitySnapshot.exists ? String(identitySnapshot.data()?.profile_id ?? "") : "";
        const selectedProfileId = mappedProfileId || candidateId;
        const selectedProfile = selectedProfileId
            ? await transaction.get(database.collection("users").doc(selectedProfileId))
            : null;
        if (mappedProfileId && !selectedProfile?.exists) {
            throw new HttpsError("failed-precondition", "The imported identity points to a missing profile.");
        }

        const now = Timestamp.now();
        const profileId = selectedProfile?.id ?? randomUUID();
        let globalId = selectedProfile?.exists ? String(selectedProfile.data()?.global_id ?? "") : "";
        let numericId: number | null = null;
        if (!globalId) {
            const reserved = await reserveNextGlobalId(database, transaction, counterSnapshot.data());
            globalId = reserved.globalId;
            numericId = reserved.numericId;
        }
        const existing = selectedProfile?.data() ?? {};
        const isUnclaimed = !selectedProfile?.exists || (existing.account_status ?? "unclaimed") === "unclaimed";
        const stored: DocumentData = {
            ...existing,
            id: profileId,
            global_id: globalId,
            name: isUnclaimed ? athlete.name : existing.name,
            name_search: isUnclaimed
                ? normalizeText(athlete.name)
                : (existing.name_search ?? normalizeText(String(existing.name ?? ""))),
            IC: existing.IC ?? athlete.identityNumber,
            email: existing.email ?? null,
            phone_number: existing.phone_number ?? null,
            birthdate: isUnclaimed ? Timestamp.fromDate(athlete.birthdate) : existing.birthdate,
            gender: isUnclaimed ? athlete.gender : existing.gender,
            country: isUnclaimed ? athlete.country : existing.country,
            image_url: existing.image_url ?? "",
            owner_uids: Array.isArray(existing.owner_uids) ? existing.owner_uids : [],
            primary_owner_email: existing.primary_owner_email ?? null,
            account_status: existing.account_status ?? "unclaimed",
            source: existing.source ?? "admin_import",
            identity_type: existing.identity_type ?? athlete.identityType,
            identity_key: existing.identity_key ?? athlete.identityKey,
            import_identity_key: identityHash,
            passport_country: existing.passport_country ?? athlete.passportCountry,
            import_batch_id: existing.import_batch_id ?? importBatchId,
            last_import_batch_id: importBatchId,
            claim_method: existing.claim_method ?? (athlete.identityType === "NONE" ? "admin_review" : "identity_match"),
            roles: existing.roles ?? null,
            school: existing.school ?? null,
            best_times: existing.best_times ?? {},
            registration_records: Array.isArray(existing.registration_records) ? existing.registration_records : [],
            created_at: existing.created_at ?? now,
            updated_at: now,
        };
        transaction.set(database.collection("users").doc(profileId), stored);
        transaction.set(
            identityRef,
            {
                profile_id: profileId,
                global_id: globalId,
                identity_type: athlete.identityType,
                created_at: identitySnapshot.data()?.created_at ?? now,
                updated_at: now,
            },
            {merge: true},
        );
        if (numericId !== null) transaction.set(counterRef, {count: numericId, updated_at: now}, {merge: true});
        return {id: profileId, globalId, data: stored};
    });
    athlete.userDocId = resolved.id;
    athlete.globalId = resolved.globalId;
    return resolved;
};

const registrationMatches = (data: DocumentData, profileId: string, globalId: string): boolean =>
    data.profile_id === profileId ||
    data.user_id === profileId ||
    data.global_id === globalId ||
    data.user_global_id === globalId;

const commitRegistration = async (
    database: Firestore,
    tournamentId: string,
    tournamentStartDate: Date,
    athlete: ImportAthleteInput,
    eventIds: readonly string[],
    importBatchId: string,
): Promise<"created" | "updated" | "unchanged"> => {
    if (!athlete.userDocId || !athlete.globalId) {
        throw new HttpsError("internal", "Imported profile resolution is incomplete.");
    }
    const allRegistrations = await database.collection("registrations").where("tournament_id", "==", tournamentId).get();
    const matches = allRegistrations.docs.filter((snapshot) =>
        registrationMatches(snapshot.data(), athlete.userDocId as string, athlete.globalId as string),
    );
    if (matches.length > 1) {
        throw new HttpsError("failed-precondition", `${athlete.name} has duplicate registrations.`);
    }
    if (matches[0] && !isImportManaged(matches[0].data())) {
        throw new HttpsError(
            "failed-precondition",
            `${athlete.name} has a member/admin registration that cannot be overwritten.`,
        );
    }

    const key = registrationIdentityKey(tournamentId, athlete.userDocId);
    const uniqueRef = database.collection("registration_unique_keys").doc(key);
    const desiredId = matches[0]?.id ?? `import-${key}`;
    const registrationRef = database.collection("registrations").doc(desiredId);
    const userRef = database.collection("users").doc(athlete.userDocId);
    const desiredEvents = [...new Set(eventIds)].sort();

    return database.runTransaction(async (transaction) => {
        const [unique, current, user] = await Promise.all([
            transaction.get(uniqueRef),
            transaction.get(registrationRef),
            transaction.get(userRef),
        ]);
        if (unique.exists && String(unique.data()?.registration_id ?? "") !== registrationRef.id) {
            throw new HttpsError("already-exists", `${athlete.name} already has a registration uniqueness mapping.`);
        }
        if (!user.exists) throw new HttpsError("failed-precondition", `${athlete.name}'s profile disappeared during import.`);
        const now = Timestamp.now();
        const existing = current.data() ?? {};
        if (current.exists && !isImportManaged(existing)) {
            throw new HttpsError("failed-precondition", `${athlete.name}'s registration is no longer import-managed.`);
        }
        const unchanged =
            current.exists &&
            sameStrings(existing.events_registered ?? existing.event_ids, desiredEvents) &&
            existing.registration_status === "approved";
        const payload = {
            ...existing,
            id: registrationRef.id,
            tournament_id: tournamentId,
            profile_id: athlete.userDocId,
            user_id: athlete.userDocId,
            global_id: athlete.globalId,
            user_global_id: athlete.globalId,
            user_name: athlete.name,
            age: ageAtTournament(athlete.birthdate, tournamentStartDate),
            gender: athlete.gender,
            country: athlete.country[0],
            phone_number: existing.phone_number ?? "",
            organizer: existing.organizer ?? "",
            event_ids: desiredEvents,
            events_registered: desiredEvents,
            payment_proof_path: existing.payment_proof_path ?? null,
            payment_proof_url: existing.payment_proof_url ?? null,
            registration_status: "approved",
            status: "confirmed",
            rejection_reason: null,
            final_status: existing.final_status ?? null,
            registration_source: "admin_import",
            import_batch_id: importBatchId,
            created_at: existing.created_at ?? now,
            updated_at: now,
        };
        transaction.set(registrationRef, payload);
        transaction.set(
            uniqueRef,
            {
                tournament_id: tournamentId,
                profile_id: athlete.userDocId,
                global_id: athlete.globalId,
                registration_id: registrationRef.id,
                source: "admin_import",
                created_at: unique.data()?.created_at ?? now,
                updated_at: now,
            },
            {merge: true},
        );
        const existingRecords = Array.isArray(user.data()?.registration_records) ? user.data()?.registration_records : [];
        transaction.update(userRef, {
            registration_records: [
                ...existingRecords.filter(
                    (record: unknown) =>
                        !record ||
                        typeof record !== "object" ||
                        (record as {tournament_id?: unknown}).tournament_id !== tournamentId,
                ),
                {
                    tournament_id: tournamentId,
                    events: desiredEvents,
                    registration_date: existing.created_at ?? now,
                    status: "approved",
                    rejection_reason: null,
                    created_at: existing.created_at ?? now,
                    updated_at: now,
                },
            ],
            updated_at: now,
        });
        return current.exists ? (unchanged ? "unchanged" : "updated") : "created";
    });
};

const commitTeams = async (
    database: Firestore,
    tournamentId: string,
    tournamentStartDate: Date,
    parsed: ParsedWorkbookInput,
    importBatchId: string,
): Promise<{created: number; updated: number; unchanged: number}> => {
    const [existingTeams, registrations] = await Promise.all([
        database.collection("teams").where("tournament_id", "==", tournamentId).get(),
        database.collection("registrations").where("tournament_id", "==", tournamentId).get(),
    ]);
    const desired = parsed.teams.map((team) => {
        const athletes = team.members
            .map((memberKey) => parsed.athletes.get(memberKey))
            .filter((value): value is ImportAthleteInput => Boolean(value?.globalId && value.userDocId));
        if (athletes.length !== team.members.length) throw new HttpsError("internal", "A team member was not resolved.");
        const ids = athletes.map((athlete) => athlete.globalId as string);
        return {team, athletes, ids, key: importedTeamIdentityKey(tournamentId, team.eventId, ids)};
    });
    const desiredKeys = new Set(desired.map((entry) => entry.key));
    const presentByEvent = new Map<string, Set<string>>();
    for (const entry of desired) {
        const ids = presentByEvent.get(entry.team.eventId) ?? new Set<string>();
        for (const id of entry.ids) ids.add(id);
        presentByEvent.set(entry.team.eventId, ids);
    }

    const operations: Array<(batch: WriteBatch) => void> = [];
    const existingByKey = new Map<string, QueryDocumentSnapshot>();
    for (const snapshot of existingTeams.docs) {
        const data = snapshot.data();
        const key = importedTeamIdentityKey(tournamentId, String(data.event_id ?? ""), teamParticipantIds(data));
        if (existingByKey.has(key)) throw new HttpsError("failed-precondition", "Duplicate teams require review before import.");
        existingByKey.set(key, snapshot);
        const presentIds = presentByEvent.get(String(data.event_id ?? ""));
        const touchesPresent = presentIds && teamParticipantIds(data).some((id) => presentIds.has(id));
        if (!touchesPresent || desiredKeys.has(key)) continue;
        if (!isImportManaged(data)) {
            throw new HttpsError("failed-precondition", `Manual team ${snapshot.id} conflicts with the corrected workbook.`);
        }
        operations.push((batch) => batch.delete(snapshot.ref));
        operations.push((batch) => batch.delete(database.collection("team_import_keys").doc(key)));
    }

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    for (const entry of desired) {
        const existing = existingByKey.get(entry.key);
        if (existing && !isImportManaged(existing.data())) {
            throw new HttpsError("failed-precondition", `Manual team ${existing.id} cannot be overwritten.`);
        }
        const leader = entry.athletes[0];
        const registration = registrations.docs.find((snapshot) =>
            registrationMatches(snapshot.data(), leader.userDocId as string, leader.globalId as string),
        );
        if (!registration) throw new HttpsError("internal", "A team leader registration is missing.");
        const ages = entry.athletes.map((athlete) => ageAtTournament(athlete.birthdate, tournamentStartDate));
        const normalizedType = normalizeEventType(entry.team.eventType);
        const teamAge =
            normalizedType === "team relay" || normalizedType === "double"
                ? Math.round(ages.reduce((sum, age) => sum + age, 0) / Math.max(1, ages.length))
                : ages[0];
        const name = entry.team.name || entry.athletes.map((athlete) => athlete.name).join(" & ");
        const now = Timestamp.now();
        const teamRef = existing?.ref ?? database.collection("teams").doc(`import-${entry.key}`);
        const payload = {
            ...(existing?.data() ?? {}),
            id: teamRef.id,
            name,
            tournament_id: tournamentId,
            registration_id: registration.id,
            leader_id: leader.globalId,
            members: entry.athletes.slice(1).map((athlete) => ({global_id: athlete.globalId, verified: true})),
            event_id: entry.team.eventId,
            event: [entry.team.eventType],
            team_age: teamAge,
            looking_for_member: false,
            registration_source: "admin_import",
            import_batch_id: importBatchId,
            created_at: existing?.data().created_at ?? now,
            updated_at: now,
        };
        if (!existing) created += 1;
        else if (String(existing.data().name ?? "") === name) unchanged += 1;
        else updated += 1;
        operations.push((batch) => batch.set(teamRef, payload));
        operations.push((batch) =>
            batch.set(
                database.collection("team_import_keys").doc(entry.key),
                {
                    tournament_id: tournamentId,
                    event_id: entry.team.eventId,
                    participant_global_ids: [...entry.ids].sort(),
                    team_id: teamRef.id,
                    updated_at: now,
                },
                {merge: true},
            ),
        );
    }

    for (let offset = 0; offset < operations.length; offset += 400) {
        const batch = database.batch();
        for (const apply of operations.slice(offset, offset + 400)) apply(batch);
        await batch.commit();
    }
    return {created, updated, unchanged};
};

const eventMatchesRegistration = (event: DocumentData, registration: DocumentData): boolean => {
    const accepted = new Set(
        [event.id, event.type, ...(Array.isArray(event.codes) ? event.codes : [])]
            .filter((entry): entry is string => typeof entry === "string")
            .map(normalizeText),
    );
    return sortedStrings(registration.events_registered ?? registration.event_ids).some((entry) =>
        accepted.has(normalizeText(entry)),
    );
};

const recomputeCapacity = async (database: Firestore, tournamentId: string): Promise<void> => {
    const [registrations, events] = await Promise.all([
        database.collection("registrations").where("tournament_id", "==", tournamentId).get(),
        database.collection("events").where("tournament_id", "==", tournamentId).get(),
    ]);
    const approved = registrations.docs.filter((snapshot) => {
        const data = snapshot.data();
        return data.registration_status === "approved" || data.status === "confirmed";
    });
    const counts = events.docs.map((event) => ({
        snapshot: event,
        count: approved.filter((registration) => eventMatchesRegistration({id: event.id, ...event.data()}, registration.data()))
            .length,
    }));
    for (const {snapshot, count} of counts) {
        const maximum = Number(snapshot.data().max_participants ?? 0);
        if (maximum > 0 && count > maximum) {
            throw new HttpsError("resource-exhausted", `${String(snapshot.data().type ?? "Event")} exceeds capacity.`);
        }
    }
    const now = Timestamp.now();
    const batch = database.batch();
    batch.set(
        database.collection("tournaments").doc(tournamentId),
        {participants: approved.length, updated_at: now},
        {merge: true},
    );
    for (const {snapshot, count} of counts) {
        batch.set(snapshot.ref, {approved_participants: count, updated_at: now}, {merge: true});
    }
    await batch.commit();
};

export const commitIdempotentImport = async (
    database: Firestore,
    tournamentId: string,
    tournamentStartDate: Date,
    parsed: ParsedWorkbookInput,
    importBatchId: string,
): Promise<ImportCommitSummary> => {
    const profilesBefore = new Map<string, boolean>();
    for (const [athleteKey, athlete] of parsedProfileEntries(parsed)) {
        const matches = await findExistingProfileCandidates(database, athlete, importIdentityKey(athlete));
        if (matches.length > 1) {
            throw new HttpsError("failed-precondition", `${athlete.name} matches multiple profiles and requires review.`);
        }
        profilesBefore.set(athleteKey, matches.length === 1);
        await resolveAthleteProfile(database, athlete, importBatchId);
    }

    let registrationsCreated = 0;
    let registrationsUpdated = 0;
    let registrationsUnchanged = 0;
    for (const [athleteKey, athlete] of parsedRegistrationEntries(parsed)) {
        const events = [...(parsed.registrationsByAthleteKey.get(athleteKey) ?? [])];
        const result = await commitRegistration(database, tournamentId, tournamentStartDate, athlete, events, importBatchId);
        if (result === "created") registrationsCreated += 1;
        else if (result === "updated") registrationsUpdated += 1;
        else registrationsUnchanged += 1;
    }
    const teamResult = await commitTeams(database, tournamentId, tournamentStartDate, parsed, importBatchId);
    await recomputeCapacity(database, tournamentId);

    const profilesReused = [...profilesBefore.values()].filter(Boolean).length;
    const profilesCreated = profilesBefore.size - profilesReused;
    return {
        profilesCreated,
        profilesReused,
        registrationsCreated,
        registrationsUpdated,
        registrationsUnchanged,
        teamsCreated: teamResult.created,
        teamsUpdated: teamResult.updated,
        teamsUnchanged: teamResult.unchanged,
        conflicts: 0,
        createdRegistrations: registrationsCreated,
        updatedRegistrations: registrationsUpdated,
        createdTeams: teamResult.created,
    };
};
