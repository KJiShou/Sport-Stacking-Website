// src/services/firebase/authService.ts
import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut,
    signInWithPopup,
    GoogleAuthProvider,
} from "firebase/auth";
import {db, auth} from "./config";
import {collection, query, where, getDocs, doc, setDoc} from "firebase/firestore";
import type {FirestoreUser, User} from "../../schema/UserSchema";

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
export const register = async (userData: Omit<User, "id"> & {password: string}) => {
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
