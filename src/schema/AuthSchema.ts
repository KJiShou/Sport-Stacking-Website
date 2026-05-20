import type {GoogleSignInIntent} from "@/services/firebase/authService";
import type {User} from "firebase/auth";
import type {Dispatch, SetStateAction} from "react";
import type {FirestoreUser} from "./UserSchema";

export interface AuthContextValue {
    user: FirestoreUser | null;
    loading: boolean;
    firebaseUser: User | null;
    hasProfile: boolean;
    isGoogleOnlyAuth: boolean;
    isGoogleRegistrationPending: boolean;
    googleSignInIntent: GoogleSignInIntent | null;
    setUser: Dispatch<SetStateAction<FirestoreUser | null>>;
}
