import type {User} from "firebase/auth";
import {
    createUserWithEmailAndPassword,
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
    doc,
    getDoc,
    getDocs,
    increment,
    query,
    runTransaction,
    setDoc,
    where,
    updateDoc,
    Timestamp,
    addDoc,
    orderBy,
} from "firebase/firestore";
import type {Competition, FirestoreUser, Registration} from "../../schema";
import {FirestoreUserSchema} from "../../schema";
import {auth, db} from "./config";

export async function createRegistration(user: FirestoreUser, data: Omit<Registration, "id">): Promise<string> {
    if (!user?.roles?.edit_competition) {
        throw new Error("Unauthorized: You do not have permission to create a competition.");
    }

    const docRef = await addDoc(collection(db, `competitions/${data.competition_id}/registrations`), {
        registered_at: Timestamp.now(),
    });

    return docRef.id;
}
