import type {AuthContextValue, FirestoreUser, Profile} from "@/schema";
import {ensureDefaultProfileFromUser, fetchProfilesByOwner} from "@/services/firebase/profileService";
import {type User, onAuthStateChanged} from "firebase/auth";
import {doc, getDoc, updateDoc} from "firebase/firestore";
// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useState} from "react";
import {auth, db} from "../services/firebase/config";
const AuthContext = createContext<AuthContextValue>({
    user: null,
    currentProfile: null,
    userProfiles: [],
    loading: true,
    firebaseUser: null,
    setUser: () => undefined,
    setCurrentProfile: () => undefined,
    refreshProfiles: async () => Promise.resolve(),
});

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [currentProfile, _setCurrentProfile] = useState<Profile | null>(null);
    const [userProfiles, setUserProfiles] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);

    const setCurrentProfile: React.Dispatch<React.SetStateAction<Profile | null>> = (
        value: Profile | null | ((prevState: Profile | null) => Profile | null),
    ) => {
        _setCurrentProfile((prev) => {
            const newValue = typeof value === "function" ? value(prev) : value;
            if (newValue && user?.id) {
                // Persist selection
                updateDoc(doc(db, "users", user.id), {
                    last_selected_profile_id: newValue.id,
                }).catch((err) => console.error("Failed to persist profile selection", err));
            }
            return newValue;
        });
    };

    const refreshProfiles = async () => {
        if (!user) return;
        try {
            const profiles = await fetchProfilesByOwner(user.id);
            setUserProfiles(profiles);

            // Logic to determine which profile to select
            let profileToSelect = currentProfile;

            // If we have a persisted choice and no current selection (or a forced refresh scenario), try to use it
            if (!profileToSelect && user.last_selected_profile_id) {
                profileToSelect = profiles.find((p) => p.id === user.last_selected_profile_id) ?? null;
            }

            // Fallback to first profile if selection is invalid or missing
            if ((!profileToSelect || !profiles.find((p) => p.id === profileToSelect?.id)) && profiles.length > 0) {
                profileToSelect = profiles[0];
            }

            if (profileToSelect) {
                // Update state directly without persisting to avoid double-write loops if relevant
                _setCurrentProfile(profileToSelect);
            } else {
                _setCurrentProfile(null);
            }
        } catch (error) {
            console.error("Failed to refresh profiles:", error);
        }
    };

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setLoading(true);
            setFirebaseUser(firebaseUser);

            if (firebaseUser) {
                try {
                    const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                    if (userDoc.exists()) {
                        const fetchedUser = userDoc.data() as FirestoreUser;
                        fetchedUser.id = userDoc.id; // Ensure ID is present
                        setUser(fetchedUser);

                        // Fetch profiles immediately after getting user logic
                        try {
                            // Ensure default profile exists first
                            await ensureDefaultProfileFromUser(fetchedUser);
                            // Then fetch all profiles
                            const profiles = await fetchProfilesByOwner(fetchedUser.id);
                            setUserProfiles(profiles);

                            // Determine initial profile
                            let initialProfile: Profile | null = null;
                            if (fetchedUser.last_selected_profile_id) {
                                initialProfile = profiles.find((p) => p.id === fetchedUser.last_selected_profile_id) ?? null;
                            }

                            if (!initialProfile && profiles.length > 0) {
                                initialProfile = profiles[0];
                            }

                            _setCurrentProfile(initialProfile);
                        } catch (error) {
                            console.warn("Failed to manage profiles:", error);
                        }
                    } else {
                        console.warn("No Firestore user found for:", firebaseUser.email);
                        setUser(null);
                        _setCurrentProfile(null);
                        setUserProfiles([]);
                    }
                } catch (err) {
                    console.error("Failed to fetch Firestore user:", err);
                    setUser(null);
                }
            } else {
                setUser(null);
                _setCurrentProfile(null);
                setUserProfiles([]);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return (
        <AuthContext.Provider
            value={{user, currentProfile, userProfiles, loading, firebaseUser, setUser, setCurrentProfile, refreshProfiles}}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);
