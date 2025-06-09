// src/services/firebase/authService.ts
import type {User} from "firebase/auth";
import {
    createUserWithEmailAndPassword,
    deleteUser,
    EmailAuthProvider,
    GoogleAuthProvider,
    reauthenticateWithCredential,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updatePassword,
} from "firebase/auth";
import type {DocumentData, QueryDocumentSnapshot, QuerySnapshot} from "firebase/firestore";
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    runTransaction,
    setDoc,
    Timestamp,
    updateDoc,
    where,
} from "firebase/firestore";
import type {FirestoreUser} from "../../schema";
import {FirestoreUserSchema} from "../../schema";
import {auth, db, storage} from "./config";
import {deleteObject, ref} from "firebase/storage";
import type {UserRegistrationRecord} from "../../schema/UserSchema";

async function getNextGlobalId(): Promise<string> {
    const counterRef = doc(db, "counters", "userCounter");
    const newCount = await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (!snap.exists()) {
            tx.set(counterRef, {count: 1});
            return 1;
        }
        // 用客户端的 increment 辅助函数自增
        tx.update(counterRef, {count: increment(1)});
        // 注意：increment 不会马上返回新值，所以我们手动读取
        const updated = (snap.data().count as number) + 1;
        return updated;
    });
    return String(newCount).padStart(5, "0");
}

function extractActiveRoles(roles: FirestoreUser["roles"]): FirestoreUser["roles"] | null {
    const activeRoles: Partial<FirestoreUser["roles"]> = {};

    for (const [key, value] of Object.entries(roles) as [keyof FirestoreUser["roles"], boolean][]) {
        if (value) {
            activeRoles[key] = true;
        }
    }

    return Object.keys(activeRoles).length > 0 ? activeRoles : null;
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

// Register and create user in Firestore
export const register = async (userData: Omit<FirestoreUser, "id"> & {password: string}) => {
    const {email, password, IC, ...rest} = userData;

    // ✅ 1. Check if IC already exists
    const q = query(collection(db, "users"), where("IC", "==", IC));
    const snapshot = await getDocs(q);

    if (!snapshot.empty) {
        throw new Error("This IC is already registered.");
    }

    // ✅ 2. Proceed with Firebase Auth user creation
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const uid = userCredential.user.uid;

    const global_id = await getNextGlobalId();

    const newUser: FirestoreUser = {
        id: uid,
        email,
        global_id,
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
        throw new Error("This IC is already registered.");
    }

    // ✅ 2. Check if Firestore record already exists for this UID
    const userRef = doc(db, "users", uid);
    const existing = await getDoc(userRef);
    if (existing.exists()) {
        throw new Error("This user is already registered.");
    }

    const imageUrl = imageFile ?? firebaseUser.photoURL;

    const global_id = await getNextGlobalId();

    // ✅ 3. Prepare new user
    const userDoc = {
        id: firebaseUser.uid,
        global_id,
        email: firebaseUser.email,
        image_url: imageUrl,
        registeration_records: [],
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
            name: data.name,
            IC: data.IC,
            email: data.email,
            birthdate: data.birthdate instanceof Timestamp ? data.birthdate.toDate() : data.birthdate,
            gender: data.gender,
            country: data.country,
            image_url: data.image_url,
            roles: data.roles ?? null,
            school: data.school ?? null,
            registration_records: data.registration_records ?? [],
            best_times: data.best_times ?? {},
        } as FirestoreUser;
    });
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
        name: data.name,
        IC: data.IC,
        email: data.email,
        birthdate: data.birthdate.toDate(), // convert Firestore Timestamp
        gender: data.gender,
        country: data.country,
        school: data.school,
        image_url: data.image_url,
        roles: data.roles,
        best_times: data.best_times,
        registration_records: data.registration_records ?? [],
    };
}

export async function updateUserProfile(id: string, data: Partial<Omit<FirestoreUser, "email" | "IC" | "id">>): Promise<void> {
    // 1. 校验允许更新的字段
    const UpdateSchema = FirestoreUserSchema.partial().omit({email: true, IC: true, id: true});
    const validated = UpdateSchema.parse(data);

    // 2. 附加 updated_at 字段
    const payload = {
        ...validated,
        updated_at: Timestamp.now(),
    };

    // 3. 更新数据库
    const userRef = doc(db, "users", id);
    await updateDoc(userRef, payload);
}

export async function updateUserRoles(userId: string, roles: FirestoreUser["roles"]): Promise<void> {
    const userRef = doc(db, "users", userId);
    console.log(roles);
    roles = extractActiveRoles(roles);
    await updateDoc(userRef, {
        roles,
        updated_at: Timestamp.now(),
    });
}

/**
 * 增加单条 registration_records（常用）
 */
export async function addUserRegistrationRecord(userId: string, newRecord: UserRegistrationRecord): Promise<void> {
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
        confirmation_date: newRecord.confirmation_date
            ? newRecord.confirmation_date instanceof Timestamp
                ? newRecord.confirmation_date
                : Timestamp.fromDate(newRecord.confirmation_date)
            : null,
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
