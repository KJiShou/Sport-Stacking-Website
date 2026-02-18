import type {User} from "firebase/auth";
import type {Dispatch, SetStateAction} from "react";
import type {FirestoreUser} from "./UserSchema";

export interface AuthContextValue {
    user: FirestoreUser | null;
    loading: boolean;
    firebaseUser: User | null;
    setUser: Dispatch<SetStateAction<FirestoreUser | null>>;
}
