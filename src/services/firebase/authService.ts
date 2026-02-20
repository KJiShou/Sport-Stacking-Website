// src/services/firebase/authService.ts
import type {User} from "firebase/auth";
import {
    EmailAuthProvider,
    GoogleAuthProvider,
    createUserWithEmailAndPassword,
    deleteUser,
    reauthenticateWithCredential,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updatePassword,
} from "firebase/auth";
import type {DocumentData, Query, QueryDocumentSnapshot, QuerySnapshot} from "firebase/firestore";
import {
    Timestamp,
    collection,
    deleteDoc,
    doc,
    documentId,
    getDoc,
    getDocs,
    increment,
    limit,
    orderBy,
    query,
    runTransaction,
    setDoc,
    startAfter,
    updateDoc,
    writeBatch,
    where,
} from "firebase/firestore";
import {httpsCallable} from "firebase/functions";
import {deleteObject, ref} from "firebase/storage";
import type {FirestoreUser} from "../../schema";
import {FirestoreUserSchema} from "../../schema";
import type {UserTournamentHistory} from "../../schema/UserHistorySchema";
import type {UserRegistrationRecord} from "../../schema/UserSchema";
import {auth, db, functions, storage} from "./config";

const ensureAuthReady = (uid: string): Promise<void> =>
    new Promise((resolve, reject) => {
        if (auth.currentUser?.uid === uid) {
            resolve();
            return;
        }
        const unsubscribe = auth.onIdTokenChanged(
            (current) => {
                if (current?.uid === uid) {
                    unsubscribe();
                    resolve();
                }
            },
            (error) => {
                unsubscribe();
                reject(error);
            },
        );
    });

async function getNextGlobalId(): Promise<string> {
    const counterRef = doc(db, "counters", "userCounter");
    const newCount = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        const nextAvailableCount = (current: number) => {
            let next = current + 1;
            while (String(next).includes("4")) {
                next += 1;
            }
            return next;
        };
        if (!snap.exists()) {
            const initialCount = 0;
            const next = nextAvailableCount(initialCount);
            tx.set(counterRef, {count: next});
            return next;
        }
        const current = (snap.data().count as number) ?? 0;
        const next = nextAvailableCount(current);
        tx.update(counterRef, {count: next});
        return next;
    });
    return String(newCount).padStart(5, "0");
}

type UserRoles = NonNullable<FirestoreUser["roles"]>;

function extractActiveRoles(roles: FirestoreUser["roles"] | null | undefined): Partial<UserRoles> | null {
    if (!roles) {
        return null;
    }

    const definedRoles = roles as UserRoles;
    const activeRoles: Partial<UserRoles> = {};
    const roleKeys: Array<keyof UserRoles> = ["edit_tournament", "record_tournament", "modify_admin", "verify_record"];

    for (const key of roleKeys) {
        if (definedRoles[key]) {
            activeRoles[key] = true;
        }
    }

    return Object.keys(activeRoles).length > 0 ? activeRoles : null;
}

export function normalizeNameSearch(value: string): string {
    return value.trim().toLowerCase();
}

// Login user
export const login = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password);

// Logout user
export const logout = () => signOut(auth);

// Sign in with Google
export const signInWithGoogle = () => {
    const provider = new GoogleAuthProvider();
    return signInWithPopup(auth, provider);
};

export const cacheGoogleAvatar = async (photoURL: string): Promise<string> => {
    const callable = httpsCallable(functions, "cacheGoogleAvatarCallable");
    const result = await callable({photoURL});
    const data = result.data as {url?: string};
    if (!data?.url) {
        throw new Error("Failed to cache Google avatar.");
    }
    return data.url;
};

// Register and create user in Firestore
export const register = async (userData: Omit<FirestoreUser, "id"> & {password: string}) => {
    const {email, password, IC, ...rest} = userData;

    // ✅ 1. Check if IC already exists
    const q = query(collection(db, "users"), where("IC", "==", IC));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        const matchingDocs = snapshot.docs.filter((docSnap) => (docSnap.data() as FirestoreUser).email === email);
        if (matchingDocs.length === 0) {
            throw new Error("This IC is already registered with another email.");
        }

        try {
            const credential = await signInWithEmailAndPassword(auth, email, password);
            await deleteUser(credential.user);
        } catch (error) {
            console.error("Failed to reset existing account:", error);
            throw new Error("This account already exists. Please log in with the correct password.");
        }

        await Promise.all(matchingDocs.map((docSnap) => deleteDoc(docSnap.ref)));
    }

    // ✅ 2. Proceed with Firebase Auth user creation
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    await signInWithEmailAndPassword(auth, email, password);
    await ensureAuthReady(uid);
    await auth.currentUser?.getIdToken(true);
    const global_id = await getNextGlobalId();

    const newUser: FirestoreUser = {
        id: uid,
        email,
        global_id,
        name_search: normalizeNameSearch(rest.name ?? ""),
        IC,
        registration_records: [],
        created_at: Timestamp.now(),
        ...rest,
    };

    await setDoc(doc(db, "users", uid), newUser);
    return uid;
};

export const registerWithGoogle = async (
    firebaseUser: User,
    extraData: Omit<FirestoreUser, "id" | "email" | "image_url">,
    imageFile?: string,
) => {
    if (!firebaseUser.email) {
        throw new Error("Google account does not have an email");
    }

    const uid = firebaseUser.uid;

    // ✅ 1. Check if IC already exists
    const q = query(collection(db, "users"), where("IC", "==", extraData.IC));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        const matchingDocs = snapshot.docs.filter((docSnap) => (docSnap.data() as FirestoreUser).email === firebaseUser.email);
        if (matchingDocs.length === 0) {
            throw new Error("This IC is already registered with another email.");
        }
        await Promise.all(matchingDocs.map((docSnap) => deleteDoc(docSnap.ref)));
    }

    // ✅ 2. Check if Firestore record already exists for this UID
    const userRef = doc(db, "users", uid);
    const existing = await getDoc(userRef);
    if (existing.exists()) {
        const existingData = existing.data() as FirestoreUser;
        if (existingData.email && existingData.email !== firebaseUser.email) {
            throw new Error("This user is already registered.");
        }
        await deleteDoc(userRef);
    }

    const imageUrl = imageFile ?? "";

    await ensureAuthReady(uid);
    const global_id = await getNextGlobalId();

    // ✅ 3. Prepare new user
    const userDoc = {
        id: firebaseUser.uid,
        global_id,
        name_search: normalizeNameSearch(extraData.name ?? ""),
        email: firebaseUser.email,
        image_url: imageUrl,
        registration_records: [],
        created_at: Timestamp.now(),
        ...extraData,
    };

    await setDoc(userRef, userDoc);
};

export async function fetchAllUsers(): Promise<FirestoreUser[]> {
    const colRef = collection(db, "users");
    const snap = await getDocs(colRef);

    return snap.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
            id: docSnap.id,
            global_id: data.global_id,
            name_search: data.name_search ?? null,
            memberId: data.memberId ?? null,
            name: data.name,
            IC: data.IC,
            email: data.email,
            birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
            gender: data.gender,
            country: data.country,
            image_url: data.image_url,
            roles: data.roles ?? null,
            school: data.school ?? null,
            phone_number: data.phone_number ?? null,
            registration_records: data.registration_records ?? [],
            best_times: data.best_times ?? {},
        } as FirestoreUser;
    });
}

export async function fetchUsersByIds(userIds: string[]): Promise<Record<string, FirestoreUser>> {
    const ids = userIds.filter((id) => id && id.trim().length > 0);
    if (ids.length === 0) {
        return {};
    }

    const results: Record<string, FirestoreUser> = {};
    const batchSize = 10;

    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const q = query(collection(db, "users"), where("id", "in", batch));
        const snapshot = await getDocs(q);
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const user = {
                id: docSnap.id,
                global_id: data.global_id ?? null,
                name_search: data.name_search ?? null,
                memberId: data.memberId ?? null,
                name: data.name,
                IC: data.IC,
                email: data.email,
                birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
                gender: data.gender,
                country: data.country,
                image_url: data.image_url,
                roles: data.roles ?? null,
                school: data.school ?? null,
                phone_number: data.phone_number ?? null,
                registration_records: data.registration_records ?? [],
                best_times: data.best_times ?? {},
            } as FirestoreUser;

            results[user.id] = user;
        }
    }

    return results;
}

export async function fetchUsersByGlobalIds(globalIds: string[]): Promise<Record<string, FirestoreUser>> {
    const ids = globalIds.filter((id) => id && id.trim().length > 0);
    if (ids.length === 0) {
        return {};
    }

    const results: Record<string, FirestoreUser> = {};
    const batchSize = 10;

    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const q = query(collection(db, "users"), where("global_id", "in", batch));
        const snapshot = await getDocs(q);
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const user = {
                id: docSnap.id,
                global_id: data.global_id ?? null,
                name_search: data.name_search ?? null,
                memberId: data.memberId ?? null,
                name: data.name,
                IC: data.IC,
                email: data.email,
                birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
                gender: data.gender,
                country: data.country,
                image_url: data.image_url,
                roles: data.roles ?? null,
                school: data.school ?? null,
                phone_number: data.phone_number ?? null,
                registration_records: data.registration_records ?? [],
                best_times: data.best_times ?? {},
            } as FirestoreUser;

            if (user.global_id) {
                results[user.global_id] = user;
            }
        }
    }

    return results;
}

export async function fetchUserByID(id: string): Promise<FirestoreUser | null> {
    // Build a query on the "users" collection where the field "id" equals the passed-in id
    const q = query(collection(db, "users"), where("id", "==", id));

    // Execute the query
    const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);

    // If there's no matching document, return null
    if (snapshot.empty) {
        return null;
    }

    // Take the first matching document
    const docSnap: QueryDocumentSnapshot<DocumentData> = snapshot.docs[0];
    const data = docSnap.data();

    // Map Firestore types to your User interface
    return {
        id: docSnap.id,
        global_id: data.global_id ?? null,
        name_search: data.name_search ?? null,
        memberId: data.memberId ?? null,
        name: data.name,
        IC: data.IC,
        email: data.email,
        birthdate: data.birthdate.toDate(), // convert Firestore Timestamp
        gender: data.gender,
        country: data.country,
        school: data.school,
        phone_number: data.phone_number,
        image_url: data.image_url,
        roles: data.roles,
        best_times: data.best_times,
        registration_records: data.registration_records ?? [],
    };
}

export async function searchUsersByNameOrGlobalIdPrefix(keyword: string, limitCount = 10): Promise<FirestoreUser[]> {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return [];
    }

    const normalizedKeyword = normalizeNameSearch(trimmedKeyword);
    const maxResults = Math.max(1, Math.min(limitCount, 20));
    const usersRef = collection(db, "users");

    const [globalIdSnapshot, nameSnapshot] = await Promise.all([
        getDocs(
            query(
                usersRef,
                where("global_id", ">=", trimmedKeyword),
                where("global_id", "<=", `${trimmedKeyword}\uf8ff`),
                limit(maxResults),
            ),
        ),
        getDocs(
            query(
                usersRef,
                where("name_search", ">=", normalizedKeyword),
                where("name_search", "<=", `${normalizedKeyword}\uf8ff`),
                limit(maxResults),
            ),
        ),
    ]);

    const mergedUsers = new Map<string, FirestoreUser>();
    for (const snapshot of [globalIdSnapshot, nameSnapshot]) {
        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const user = {
                id: docSnap.id,
                global_id: data.global_id ?? null,
                name_search: data.name_search ?? null,
                memberId: data.memberId ?? null,
                name: data.name,
                IC: data.IC,
                email: data.email,
                birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
                gender: data.gender,
                country: data.country,
                image_url: data.image_url,
                roles: data.roles ?? null,
                school: data.school ?? null,
                phone_number: data.phone_number ?? null,
                registration_records: data.registration_records ?? [],
                best_times: data.best_times ?? {},
            } as FirestoreUser;

            const uniqueKey = user.global_id ?? user.id;
            mergedUsers.set(uniqueKey, user);
        }
    }

    return Array.from(mergedUsers.values()).slice(0, maxResults);
}

export async function backfillUserNameSearchField(): Promise<number> {
    const usersSnapshot = await getDocs(collection(db, "users"));
    let updatedCount = 0;
    let batch = writeBatch(db);
    let batchOperations = 0;

    for (const docSnap of usersSnapshot.docs) {
        const userData = docSnap.data() as {name?: unknown; name_search?: unknown};
        if (typeof userData.name !== "string") {
            continue;
        }

        const normalizedName = normalizeNameSearch(userData.name);
        const currentNameSearch = typeof userData.name_search === "string" ? userData.name_search : "";
        if (currentNameSearch === normalizedName) {
            continue;
        }

        batch.update(docSnap.ref, {name_search: normalizedName, updated_at: Timestamp.now()});
        updatedCount += 1;
        batchOperations += 1;

        if (batchOperations === 400) {
            await batch.commit();
            batch = writeBatch(db);
            batchOperations = 0;
        }
    }

    if (batchOperations > 0) {
        await batch.commit();
    }

    return updatedCount;
}

export async function getUserByGlobalId(globalId: string) {
    const q = query(collection(db, "users"), where("global_id", "==", globalId));
    const snap = await getDocs(q);
    if (snap.empty) {
        return undefined;
    }

    const getTimestampMillis = (value: unknown): number => {
        if (!value) return 0;
        if (value instanceof Timestamp) return value.toMillis();
        if (value instanceof Date) return value.getTime();
        if (typeof value === "string" || typeof value === "number") {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
        }
        return 0;
    };

    const getBestTimesCount = (value: unknown): number => {
        if (!value || typeof value !== "object") {
            return 0;
        }
        const bestTimes = value as Record<string, {time?: unknown} | null | undefined>;
        const events = ["3-3-3", "3-6-3", "Cycle", "Overall"];
        return events.reduce((count, event) => {
            const time = bestTimes[event]?.time;
            return typeof time === "number" && Number.isFinite(time) && time > 0 ? count + 1 : count;
        }, 0);
    };

    const getRegistrationCount = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

    const bestDoc = [...snap.docs].sort((a, b) => {
        const dataA = a.data() as Record<string, unknown>;
        const dataB = b.data() as Record<string, unknown>;

        const bestTimesDiff = getBestTimesCount(dataB.best_times) - getBestTimesCount(dataA.best_times);
        if (bestTimesDiff !== 0) {
            return bestTimesDiff;
        }

        const updatedDiff = getTimestampMillis(dataB.updated_at) - getTimestampMillis(dataA.updated_at);
        if (updatedDiff !== 0) {
            return updatedDiff;
        }

        return getRegistrationCount(dataB.registration_records) - getRegistrationCount(dataA.registration_records);
    })[0];

    return bestDoc.data() as FirestoreUser;
}

export async function getUserEmailByGlobalId(globalId: string) {
    const q = query(collection(db, "users"), where("global_id", "==", globalId));
    const snap = await getDocs(q);
    return snap.docs[0]?.data() as {email: string} | undefined;
}

export async function updateUserProfile(id: string, data: Partial<Omit<FirestoreUser, "email" | "IC" | "id">>): Promise<void> {
    // 1. 校验允许更新的字段
    const UpdateSchema = FirestoreUserSchema.partial().omit({email: true, IC: true, id: true});
    const validated = UpdateSchema.parse(data);

    // 2. 附加 updated_at 字段
    const payload: Partial<FirestoreUser> & {updated_at: Timestamp} = {
        ...validated,
        ...(typeof validated.name === "string" ? {name_search: normalizeNameSearch(validated.name)} : {}),
        updated_at: Timestamp.now(),
    };

    // 3. 更新数据库
    const userRef = doc(db, "users", id);
    await updateDoc(userRef, payload);
}

export async function updateUserRoles(userId: string, roles: FirestoreUser["roles"]): Promise<void> {
    const userRef = doc(db, "users", userId);
    const temp_roles = extractActiveRoles(roles);
    await updateDoc(userRef, {
        roles: temp_roles,
        updated_at: Timestamp.now(),
    });
}

/**
 * 增加单条 registration_records（常用）
 */
export async function addUserRegistrationRecord(userId: string, newRecord: UserRegistrationRecord): Promise<void> {
    if (!newRecord.tournament_id) {
        throw new Error("Tournament id is required.");
    }

    const tournamentRef = doc(db, "tournaments", newRecord.tournament_id);
    const tournamentSnap = await getDoc(tournamentRef);
    if (!tournamentSnap.exists()) {
        throw new Error("Tournament not found");
    }
    const tournamentData = tournamentSnap.data() as {max_participants?: number | null; participants?: number | null};
    const maxParticipants = tournamentData.max_participants ?? null;
    const participants = tournamentData.participants ?? null;
    if (
        typeof maxParticipants === "number" &&
        maxParticipants > 0 &&
        typeof participants === "number" &&
        participants >= maxParticipants
    ) {
        throw new Error("Tournament registration is full.");
    }

    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        throw new Error("User not found");
    }

    const userData = userSnap.data();
    const existingRecords: UserRegistrationRecord[] = userData.registration_records ?? [];

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

    await updateDoc(userRef, {
        registration_records: updatedRecords,
        updated_at: Timestamp.now(),
    });
}

export async function updateUserRegistrationRecord(
    userId: string,
    recordId: string,
    updatedFields: Partial<UserRegistrationRecord>,
): Promise<void> {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        throw new Error("User not found");
    }

    const userData = userSnap.data();
    const existingRecords: UserRegistrationRecord[] = userData.registration_records ?? [];

    // Find the record to update
    const recordIndex = existingRecords.findIndex((record) => record.tournament_id === recordId);

    if (recordIndex === -1) {
        throw new Error("Registration record not found");
    }

    const existingRecord = existingRecords[recordIndex];

    // Validate and convert date fields if they exist in updatedFields
    const validatedUpdates: Partial<UserRegistrationRecord> = {
        ...updatedFields,
    };

    // Handle registration_date conversion
    if (updatedFields.registration_date) {
        validatedUpdates.registration_date =
            updatedFields.registration_date instanceof Timestamp
                ? updatedFields.registration_date
                : Timestamp.fromDate(updatedFields.registration_date);
    }

    // Handle created_at conversion (though this shouldn't typically be updated)
    if (updatedFields.created_at) {
        validatedUpdates.created_at =
            updatedFields.created_at instanceof Timestamp
                ? updatedFields.created_at
                : Timestamp.fromDate(updatedFields.created_at);
    }

    // Always update the updated_at timestamp
    validatedUpdates.updated_at = Timestamp.now();

    // Create the updated record
    const updatedRecord: UserRegistrationRecord = {
        ...existingRecord,
        ...validatedUpdates,
    };

    // Replace the record in the array
    const updatedRecords = [...existingRecords];
    updatedRecords[recordIndex] = updatedRecord;

    // Update the document
    await updateDoc(userRef, {
        registration_records: updatedRecords,
        updated_at: Timestamp.now(),
    });
}

export async function changeUserPassword(currentPassword: string, newPassword: string): Promise<void> {
    const user = auth.currentUser;

    if (!user || !user.email) {
        throw new Error("No authenticated user found.");
    }

    try {
        // Step 1: Reauthenticate
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        // Step 2: Update password
        await updatePassword(user, newPassword);

        // Step 3: Optionally update Firestore user profile timestamp
        await updateDoc(doc(db, "users", user.uid), {
            updated_at: Timestamp.now(),
        });
    } catch (error) {
        console.error("Failed to change password:", error);
        throw error;
    }
}

/**
 * Remove user registration records for a specific tournament
 */
export async function removeUserRegistrationRecordsByTournament(tournamentId: string): Promise<void> {
    try {
        // Get all users who have registration records for this tournament
        const usersQuery = query(collection(db, "users"), where("registration_records", "!=", null));

        const usersSnapshot = await getDocs(usersQuery);

        const updatePromises = usersSnapshot.docs.map(async (userDoc) => {
            const userData = userDoc.data();
            const registrationRecords: UserRegistrationRecord[] = userData.registration_records ?? [];

            // Filter out records for the deleted tournament
            const filteredRecords = registrationRecords.filter((record) => record.tournament_id !== tournamentId);

            // Only update if there were records to remove
            if (filteredRecords.length !== registrationRecords.length) {
                await updateDoc(userDoc.ref, {
                    registration_records: filteredRecords,
                    updated_at: Timestamp.now(),
                });
            }
        });

        await Promise.all(updatePromises);
    } catch (error) {
        console.error("Error cleaning up user registration records:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }
}

/**
 * Remove cached tournament history entries for a specific tournament
 * from user_tournament_history documents.
 */
export async function removeUserTournamentHistoryByTournament(tournamentId: string): Promise<void> {
    try {
        const pageSize = 200;
        const writeConcurrency = 20;
        let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

        while (true) {
            const pageQuery: Query<DocumentData> = lastDoc
                ? query(collection(db, "user_tournament_history"), orderBy(documentId()), startAfter(lastDoc), limit(pageSize))
                : query(collection(db, "user_tournament_history"), orderBy(documentId()), limit(pageSize));

            const historySnapshot: QuerySnapshot<DocumentData> = await getDocs(pageQuery);
            if (historySnapshot.empty) {
                break;
            }

            const docsToUpdate: QueryDocumentSnapshot<DocumentData>[] = [];
            for (const historyDoc of historySnapshot.docs) {
                const historyData = historyDoc.data() as UserTournamentHistory;
                const tournaments = Array.isArray(historyData.tournaments) ? historyData.tournaments : [];
                const filteredTournaments = tournaments.filter((summary) => summary.tournamentId !== tournamentId);
                if (filteredTournaments.length !== tournaments.length) {
                    docsToUpdate.push(historyDoc);
                }
            }

            for (let i = 0; i < docsToUpdate.length; i += writeConcurrency) {
                const chunk = docsToUpdate.slice(i, i + writeConcurrency);
                await Promise.all(
                    chunk.map(async (historyDoc) => {
                        const historyData = historyDoc.data() as UserTournamentHistory;
                        const tournaments = Array.isArray(historyData.tournaments) ? historyData.tournaments : [];
                        const filteredTournaments = tournaments.filter((summary) => summary.tournamentId !== tournamentId);
                        const recordCount = filteredTournaments.reduce((total, summary) => {
                            const results = Array.isArray(summary.results) ? summary.results : [];
                            return total + results.length;
                        }, 0);

                        await updateDoc(historyDoc.ref, {
                            tournaments: filteredTournaments,
                            tournamentCount: filteredTournaments.length,
                            recordCount,
                            updatedAt: Timestamp.now(),
                        });
                    }),
                );
            }

            lastDoc = historySnapshot.docs[historySnapshot.docs.length - 1];
            if (historySnapshot.docs.length < pageSize) {
                break;
            }
        }
    } catch (error) {
        console.error("Error cleaning up user tournament history:", error);
        // Don't throw here as this is cleanup - the main deletion should still succeed
    }
}

export async function deleteAccount(userId: string): Promise<void> {
    try {
        // 1. 删除 Firestore 里的用户资料
        await deleteDoc(doc(db, "users", userId));

        // 2. 删除 Firebase Storage 里的 avatar（如果你存储时用 userId 作为文件名）
        const avatarRef = ref(storage, `avatars/${userId}`);
        await deleteObject(avatarRef).catch((error) => {
            if (error.code !== "storage/object-not-found") {
                throw error;
            }
            // 如果头像不存在，也不算 error
        });

        // 3. 删除 Firebase Authentication 账户（注意：必须当前用户自己执行）
        const currentUser = auth.currentUser;
        if (currentUser && currentUser.uid === userId) {
            await deleteUser(currentUser);
        } else {
            console.warn("Auth user mismatch, cannot delete Auth account");
            throw new Error("Cannot delete Auth account: user mismatch.");
        }
    } catch (error) {
        console.error("Error deleting account:", error);
        throw error;
    }
}

export async function deleteUserProfileAdmin(userId: string): Promise<void> {
    try {
        await deleteDoc(doc(db, "users", userId));
        const avatarRef = ref(storage, `avatars/${userId}`);
        await deleteObject(avatarRef).catch((error) => {
            if (error.code !== "storage/object-not-found") {
                throw error;
            }
        });
    } catch (error) {
        console.error("Error deleting user profile:", error);
        throw error;
    }
}
