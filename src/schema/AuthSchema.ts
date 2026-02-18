import type {User} from "firebase/auth";
import type {Dispatch, SetStateAction} from "react";
import type {Profile} from "./ProfileSchema";
import type {FirestoreUser} from "./UserSchema";

export interface AuthContextValue {
    user: FirestoreUser | null;
    currentProfile: Profile | null;
    userProfiles: Profile[];
    loading: boolean;
    firebaseUser: User | null;
    last_selected_profile_id?: string | null;
    setUser: Dispatch<SetStateAction<FirestoreUser | null>>;
    setCurrentProfile: Dispatch<SetStateAction<Profile | null>>;
    refreshProfiles: () => Promise<void>;
}
