import type {FirestoreUser, Profile} from "@/schema";
import type {UserRegistrationRecord} from "@/schema/UserSchema";
import {ProfileSchema} from "@/schema/ProfileSchema";
import {Timestamp, addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where} from "firebase/firestore";
import {getNextGlobalId} from "./authService";
import {db} from "./config";

const profileCollection = collection(db, "profiles");

const normalizeBirthdate = (value: unknown): Date | Timestamp | null => {
    if (!value) return null;
    if (value instanceof Timestamp) return value;
    if (value instanceof Date) return value;
    if (typeof value === "object" && value !== null && "toDate" in value && typeof value.toDate === "function") {
        const converted = value.toDate();
        if (converted instanceof Date) {
            return converted;
        }
    }
    if (typeof value === "string") {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed;
        }
    }
    return null;
};

const normalizeProfileDates = (data: Profile): Profile => ({
    ...data,
    birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
});

export async function fetchProfilesByOwner(ownerUid: string): Promise<Profile[]> {
    if (!ownerUid) return [];
    const q = query(profileCollection, where("owner_uid", "==", ownerUid));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => normalizeProfileDates({...docSnap.data(), id: docSnap.id} as Profile));
}

export async function fetchAllProfiles(): Promise<Profile[]> {
    const snapshot = await getDocs(profileCollection);
    return snapshot.docs.map((docSnap) => normalizeProfileDates({...docSnap.data(), id: docSnap.id} as Profile));
}

export async function fetchProfileById(profileId: string): Promise<Profile | null> {
    if (!profileId) return null;
    const docSnap = await getDoc(doc(db, "profiles", profileId));
    if (!docSnap.exists()) return null;
    return normalizeProfileDates({...docSnap.data(), id: docSnap.id} as Profile);
}

export async function fetchProfileByGlobalId(globalId: string): Promise<Profile | null> {
    if (!globalId) return null;
    const q = query(profileCollection, where("global_id", "==", globalId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const docSnap = snapshot.docs[0];
    return normalizeProfileDates({...docSnap.data(), id: docSnap.id} as Profile);
}

export async function getProfileContactEmailByGlobalId(globalId: string): Promise<string | null> {
    const profile = await fetchProfileByGlobalId(globalId);
    if (!profile) return null;
    return profile.contact_email ?? profile.owner_email ?? null;
}

export async function createProfile(
    payload: Omit<Profile, "id" | "global_id" | "created_at" | "updated_at"> & {global_id?: string | null},
): Promise<Profile> {
    const existingProfileQuery = query(profileCollection, where("IC", "==", payload.IC));
    const existingProfileSnapshot = await getDocs(existingProfileQuery);
    if (!existingProfileSnapshot.empty) {
        throw new Error("This IC is already registered.");
    }

    const existingUserQuery = query(collection(db, "users"), where("IC", "==", payload.IC));
    const existingUserSnapshot = await getDocs(existingUserQuery);
    if (!existingUserSnapshot.empty) {
        const matchingUser = existingUserSnapshot.docs[0].data() as FirestoreUser;
        if (!payload.owner_uid || matchingUser.id !== payload.owner_uid) {
            throw new Error("This IC is already registered.");
        }
    }

    const global_id = payload.global_id || (await getNextGlobalId());
    const now = Timestamp.now();
    const normalizedBirthdate = normalizeBirthdate(payload.birthdate);
    if (!normalizedBirthdate) {
        throw new Error("Birthdate must be a valid date.");
    }

    const profileData: Profile = ProfileSchema.parse({
        ...payload,
        global_id,
        birthdate: normalizedBirthdate,
        status: payload.owner_uid ? "claimed" : "unclaimed",
        created_at: now,
        updated_at: now,
    });

    const ref = await addDoc(profileCollection, {
        ...profileData,
        created_at: profileData.created_at ?? now,
        updated_at: profileData.updated_at ?? now,
    });
    await updateDoc(ref, {id: ref.id});

    return normalizeProfileDates({...profileData, id: ref.id});
}

export async function createProfilesForUsersWithoutProfile(): Promise<{created: number; skipped: number}> {
    const usersSnapshot = await getDocs(collection(db, "users"));
    const allUsers = usersSnapshot.docs.map((docSnap) => ({...(docSnap.data() as FirestoreUser), id: docSnap.id}));

    const profilesSnapshot = await getDocs(profileCollection);
    const allProfiles = profilesSnapshot.docs.map((docSnap) => ({...(docSnap.data() as Profile), id: docSnap.id}));

    const ownerIds = new Set(allProfiles.map((profile) => profile.owner_uid).filter(Boolean) as string[]);
    const profileIcs = new Set(allProfiles.map((profile) => profile.IC).filter(Boolean));

    let created = 0;
    let skipped = 0;

    for (const entry of allUsers) {
        if (!entry?.id || !entry.IC) {
            skipped += 1;
            continue;
        }
        if (ownerIds.has(entry.id) || profileIcs.has(entry.IC)) {
            skipped += 1;
            continue;
        }
        try {
            await createProfile({
                owner_uid: entry.id,
                owner_email: entry.email ?? null,
                name: entry.name,
                IC: entry.IC,
                birthdate: entry.birthdate,
                gender: entry.gender,
                country: entry.country ?? null,
                phone_number: entry.phone_number ?? null,
                school: entry.school ?? null,
                contact_email: entry.email ?? null,
                image_url: entry.image_url ?? null,
                roles: entry.roles ?? null,
                best_times: entry.best_times ?? null,
                registration_records: entry.registration_records ?? null,
                created_by_admin_id: null,
                status: "claimed",
            });
            created += 1;
        } catch (error) {
            console.warn("Skipping user profile creation:", entry.id, error);
            skipped += 1;
        }
    }

    return {created, skipped};
}

export async function syncProfilesWithUsers(): Promise<{created: number; updated: number; skipped: number}> {
    const usersSnapshot = await getDocs(collection(db, "users"));
    const allUsers = usersSnapshot.docs.map((docSnap) => ({...(docSnap.data() as FirestoreUser), id: docSnap.id}));

    const profilesSnapshot = await getDocs(profileCollection);
    const allProfiles = profilesSnapshot.docs.map((docSnap) => ({...(docSnap.data() as Profile), id: docSnap.id}));

    const profilesByOwner = new Map<string, Profile[]>();
    for (const profile of allProfiles) {
        if (!profile.owner_uid) continue;
        const list = profilesByOwner.get(profile.owner_uid) ?? [];
        list.push(profile);
        profilesByOwner.set(profile.owner_uid, list);
    }

    const profilesByIc = new Map<string, Profile>();
    for (const profile of allProfiles) {
        if (profile.IC) {
            profilesByIc.set(profile.IC, profile);
        }
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const entry of allUsers) {
        if (!entry?.id || !entry.IC) {
            skipped += 1;
            continue;
        }

        const ownedProfiles = profilesByOwner.get(entry.id) ?? [];
        const profileUpdates: Partial<Profile> = {
            owner_uid: entry.id,
            owner_email: entry.email ?? null,
            global_id: entry.global_id ?? undefined,
            name: entry.name,
            IC: entry.IC,
            birthdate: entry.birthdate,
            gender: entry.gender,
            country: entry.country ?? null,
            phone_number: entry.phone_number ?? null,
            school: entry.school ?? null,
            contact_email: entry.email ?? null,
            image_url: entry.image_url ?? null,
            roles: entry.roles ?? null,
            best_times: entry.best_times ?? null,
            registration_records: entry.registration_records ?? null,
            status: "claimed",
        };

        if (ownedProfiles.length > 0) {
            await Promise.all(
                ownedProfiles
                    .map((profile) => profile.id)
                    .filter((profileId): profileId is string => Boolean(profileId))
                    .map((profileId) => updateProfile(profileId, profileUpdates)),
            );
            updated += ownedProfiles.length;
            continue;
        }

        const matchingProfile = profilesByIc.get(entry.IC);
        if (matchingProfile?.id) {
            await updateProfile(matchingProfile.id, profileUpdates);
            updated += 1;
            continue;
        }

        try {
            const createPayload = {
                owner_uid: entry.id,
                owner_email: entry.email ?? null,
                global_id: entry.global_id ?? undefined,
                name: entry.name,
                IC: entry.IC,
                birthdate: entry.birthdate,
                gender: entry.gender,
                country: entry.country ?? null,
                phone_number: entry.phone_number ?? null,
                school: entry.school ?? null,
                contact_email: entry.email ?? null,
                image_url: entry.image_url ?? null,
                roles: entry.roles ?? null,
                best_times: entry.best_times ?? null,
                registration_records: entry.registration_records ?? null,
                created_by_admin_id: null,
                status: "claimed" as const,
            };
            await createProfile({
                ...createPayload,
            });
            created += 1;
        } catch (error) {
            console.warn("Skipping user profile sync:", entry.id, error);
            skipped += 1;
        }
    }

    return {created, updated, skipped};
}

export async function deleteProfile(profileId: string): Promise<void> {
    if (!profileId) return;
    await deleteDoc(doc(db, "profiles", profileId));
}

export async function updateProfile(profileId: string, updates: Partial<Profile>): Promise<void> {
    if (!profileId) return;
    await updateDoc(doc(db, "profiles", profileId), {
        ...updates,
        updated_at: Timestamp.now(),
    });
}

export async function updateProfilesByGlobalId(globalId: string, updates: Partial<Profile>): Promise<void> {
    if (!globalId) return;
    const q = query(profileCollection, where("global_id", "==", globalId));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return;
    await Promise.all(
        snapshot.docs.map((docSnap) =>
            updateDoc(docSnap.ref, {
                ...updates,
                updated_at: Timestamp.now(),
            }),
        ),
    );
}

export async function updateProfilesForUser(
    user: Pick<FirestoreUser, "id" | "global_id" | "IC">,
    updates: Partial<Profile>,
): Promise<void> {
    if (!user?.id) return;
    const profiles = await fetchProfilesByOwner(user.id);
    if (profiles.length === 0) return;

    const matchedProfiles = profiles.filter(
        (profile) => (user.global_id && profile.global_id === user.global_id) || (user.IC && profile.IC === user.IC),
    );
    const targetProfiles = matchedProfiles.length > 0 ? matchedProfiles : profiles;

    await Promise.all(
        targetProfiles
            .map((profile) => profile.id)
            .filter((profileId): profileId is string => Boolean(profileId))
            .map((profileId) =>
                updateDoc(doc(db, "profiles", profileId), {
                    ...updates,
                    updated_at: Timestamp.now(),
                }),
            ),
    );
}

export async function claimProfile(profileId: string, ownerUid: string, ownerEmail?: string | null): Promise<void> {
    if (!profileId || !ownerUid) return;
    await updateDoc(doc(db, "profiles", profileId), {
        owner_uid: ownerUid,
        owner_email: ownerEmail ?? null,
        status: "claimed",
        updated_at: Timestamp.now(),
    });
}

export async function addProfileRegistrationRecord(profileId: string, newRecord: UserRegistrationRecord): Promise<void> {
    if (!profileId) {
        throw new Error("Profile id is required.");
    }
    if (!newRecord.tournament_id) {
        throw new Error("Tournament id is required.");
    }

    const profileRef = doc(db, "profiles", profileId);
    const profileSnap = await getDoc(profileRef);

    if (!profileSnap.exists()) {
        throw new Error("Profile not found");
    }

    const profileData = profileSnap.data() as Profile;
    const existingRecords: UserRegistrationRecord[] = profileData.registration_records ?? [];

    const validatedRecord: UserRegistrationRecord = {
        ...newRecord,
        registration_date:
            newRecord.registration_date instanceof Timestamp
                ? newRecord.registration_date
                : Timestamp.fromDate(newRecord.registration_date),
        created_at: newRecord.created_at
            ? newRecord.created_at instanceof Timestamp
                ? newRecord.created_at
                : Timestamp.fromDate(newRecord.created_at)
            : Timestamp.now(),
        updated_at: Timestamp.now(),
    };

    const updatedRecords = [...existingRecords, validatedRecord];

    await updateDoc(profileRef, {
        registration_records: updatedRecords,
        updated_at: Timestamp.now(),
    });
}

export async function updateProfileRegistrationRecord(
    profileId: string,
    recordId: string,
    updatedFields: Partial<UserRegistrationRecord>,
): Promise<void> {
    if (!profileId) {
        throw new Error("Profile id is required.");
    }

    const profileRef = doc(db, "profiles", profileId);
    const profileSnap = await getDoc(profileRef);

    if (!profileSnap.exists()) {
        throw new Error("Profile not found");
    }

    const profileData = profileSnap.data() as Profile;
    const existingRecords: UserRegistrationRecord[] = profileData.registration_records ?? [];

    const recordIndex = existingRecords.findIndex((record) => record.tournament_id === recordId);
    if (recordIndex === -1) {
        throw new Error("Registration record not found");
    }

    const existingRecord = existingRecords[recordIndex];
    const validatedUpdates: Partial<UserRegistrationRecord> = {
        ...updatedFields,
    };

    if (updatedFields.registration_date) {
        validatedUpdates.registration_date =
            updatedFields.registration_date instanceof Timestamp
                ? updatedFields.registration_date
                : Timestamp.fromDate(updatedFields.registration_date);
    }

    if (updatedFields.created_at) {
        validatedUpdates.created_at =
            updatedFields.created_at instanceof Timestamp
                ? updatedFields.created_at
                : Timestamp.fromDate(updatedFields.created_at);
    }

    validatedUpdates.updated_at = Timestamp.now();

    const updatedRecord: UserRegistrationRecord = {
        ...existingRecord,
        ...validatedUpdates,
    };

    const updatedRecords = [...existingRecords];
    updatedRecords[recordIndex] = updatedRecord;

    await updateDoc(profileRef, {
        registration_records: updatedRecords,
        updated_at: Timestamp.now(),
    });
}

export async function ensureDefaultProfileFromUser(user: FirestoreUser): Promise<Profile | null> {
    if (!user?.id) return null;
    const existing = await fetchProfilesByOwner(user.id);
    if (existing.length > 0) {
        return existing[0];
    }
    return createProfile({
        owner_uid: user.id,
        owner_email: user.email ?? null,
        global_id: user.global_id,
        name: user.name,
        IC: user.IC,
        birthdate: user.birthdate,
        gender: user.gender,
        country: user.country ?? null,
        phone_number: user.phone_number ?? null,
        school: user.school ?? null,
        contact_email: user.email ?? null,
        image_url: user.image_url ?? null,
        roles: user.roles ?? null,
        best_times: user.best_times ?? null,
        registration_records: user.registration_records ?? null,
        created_by_admin_id: null,
        status: "claimed",
    });
}
