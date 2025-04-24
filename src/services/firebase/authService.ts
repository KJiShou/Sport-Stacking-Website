// src/services/firebase/authService.ts
import type {User} from "firebase/auth";
import {
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
} from "firebase/auth";
import type {DocumentData, QueryDocumentSnapshot, QuerySnapshot} from "firebase/firestore";
import {collection, doc, getDoc, getDocs, increment, query, runTransaction, setDoc, where, updateDoc} from "firebase/firestore";
import type {FirestoreUser} from "../../schema";
import {FirestoreUserSchema} from "../../schema";
import {auth, db} from "./config";

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
        ...rest,
    };

    await setDoc(doc(db, "users", uid), newUser);
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
        ...extraData,
    };

    await setDoc(userRef, userDoc);
};

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
        state: data.state,
        organizer: data.organizer,
        image_url: data.image_url,
        roles: data.roles,
        best_times: data.best_times,
    };
}

export async function updateUserProfile(id: string, data: Partial<Omit<FirestoreUser, "email" | "IC" | "id">>): Promise<void> {
    // 1. 校验：只允许 FirestoreUserSchema 中声明过的字段，并且所有字段都可选
    const UpdateSchema = FirestoreUserSchema.partial().omit({email: true, IC: true, id: true});
    const validated = UpdateSchema.parse(data);

    // 2. 获取文档引用
    const userRef = doc(db, "users", id);

    // 3. 执行更新
    await updateDoc(userRef, validated);
}
