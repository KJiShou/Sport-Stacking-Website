import type {FirestoreUser, Profile} from "@/schema";
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

export async function createProfile(payload: Omit<Profile, "id" | "global_id" | "created_at" | "updated_at">): Promise<Profile> {
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

    const global_id = await getNextGlobalId();
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

export async function claimProfile(profileId: string, ownerUid: string, ownerEmail?: string | null): Promise<void> {
    if (!profileId || !ownerUid) return;
    await updateDoc(doc(db, "profiles", profileId), {
        owner_uid: ownerUid,
        owner_email: ownerEmail ?? null,
        status: "claimed",
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
        name: user.name,
        IC: user.IC,
        birthdate: user.birthdate,
        gender: user.gender,
        country: user.country ?? null,
        phone_number: user.phone_number ?? null,
        school: user.school ?? null,
        contact_email: user.email ?? null,
        created_by_admin_id: null,
        status: "claimed",
    });
}
