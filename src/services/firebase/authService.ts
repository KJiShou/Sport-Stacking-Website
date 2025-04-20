// src/services/firebase/authService.ts
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    signInWithPopup,
    GoogleAuthProvider,
} from "firebase/auth";
import type {User} from "firebase/auth";
import {db, auth} from "./config";
import {collection, query, where, getDocs, doc, setDoc, getDoc} from "firebase/firestore";
import type {FirestoreUser} from "../../schema";

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

    const newUser: FirestoreUser = {
        id: uid,
        email,
        IC,
        ...rest,
    };

    await setDoc(doc(db, "users", uid), newUser);
};

export const registerWithGoogle = async (firebaseUser: User, extraData: Omit<FirestoreUser, "id" | "email" | "image_url">) => {
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

    // ✅ 3. Prepare new user
    const newUser: FirestoreUser = {
        id: uid,
        email: firebaseUser.email,
        image_url: firebaseUser.photoURL || "https://default.image", // default fallback
        ...extraData,
    };

    await setDoc(userRef, newUser);
};
