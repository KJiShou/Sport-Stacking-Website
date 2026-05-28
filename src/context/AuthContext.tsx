import type {AuthContextValue, FirestoreUser} from "@/schema";
import {type User, getRedirectResult, onAuthStateChanged} from "firebase/auth";
import {collection, doc, getDoc, getDocs, query, where} from "firebase/firestore";
// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useMemo, useState} from "react";
import {
    type GoogleSignInIntent,
    clearGoogleSignInIntent,
    getGoogleSignInIntent,
    hasGoogleProvider,
    isGoogleOnlyUser,
} from "../services/firebase/authService";
import {auth, db} from "../services/firebase/config";
import {parseBirthdate} from "../utils/birthdate";

let redirectResultPromise: Promise<User | null> | null = null;
let redirectResultUserCache: User | null | undefined;

const resolveRedirectUserOnce = async (): Promise<User | null> => {
    if (redirectResultUserCache !== undefined) {
        return redirectResultUserCache;
    }

    redirectResultPromise ??= getRedirectResult(auth)
        .then((redirectResult) => {
            redirectResultUserCache = redirectResult?.user ?? null;
            return redirectResultUserCache;
        })
        .catch((err) => {
            redirectResultUserCache = null;
            throw err;
        });

    return redirectResultPromise;
};

const AuthContext = createContext<AuthContextValue>({
    user: null,
    profiles: [],
    activeProfileId: null,
    setActiveProfileId: () => {
        // default no-op function
    },
    refreshProfiles: async () => {
        // default no-op function
    },
    loading: true,
    firebaseUser: null,
    hasProfile: false,
    isGoogleOnlyAuth: false,
    isGoogleRegistrationPending: false,
    googleSignInIntent: null,
    setUser: () => {
        // default no-op function
    },
});

const ACTIVE_PROFILE_ID_KEY = "active-profile-id";

const getStoredActiveProfileId = (): string | null => {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return null;
    }
    return window.localStorage.getItem(ACTIVE_PROFILE_ID_KEY);
};

const storeActiveProfileId = (profileId: string): void => {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return;
    }
    window.localStorage.setItem(ACTIVE_PROFILE_ID_KEY, profileId);
};

const clearStoredActiveProfileId = (): void => {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
        return;
    }
    window.localStorage.removeItem(ACTIVE_PROFILE_ID_KEY);
};

const isProfileOwnedByUid = (docId: string, data: FirestoreUser, uid: string): boolean => {
    if (Array.isArray(data.owner_uids)) {
        return data.owner_uids.includes(uid);
    }

    return docId === uid;
};

const normalizeProfile = (docId: string, data: FirestoreUser): FirestoreUser => ({
    ...data,
    id: data.id || docId,
    birthdate: parseBirthdate(data.birthdate) ?? data.birthdate,
    owner_uids: data.owner_uids ?? (docId ? [docId] : []),
    account_status: data.account_status ?? "claimed",
    source: data.source ?? "legacy",
});

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [profiles, setProfiles] = useState<FirestoreUser[]>([]);
    const [activeProfileId, setActiveProfileIdState] = useState<string | null>(() => getStoredActiveProfileId());
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [googleSignInIntent, setGoogleSignInIntentState] = useState<GoogleSignInIntent | null>(() => getGoogleSignInIntent());
    const [isHydratingAuth, setIsHydratingAuth] = useState(true);
    const [isResolvingRedirect, setIsResolvingRedirect] = useState(true);

    const setActiveProfileId = (profileId: string) => {
        if (profileId === activeProfileId) {
            return;
        }

        storeActiveProfileId(profileId);
        setActiveProfileIdState(profileId);
        const nextProfile = profiles.find((profile) => profile.id === profileId) ?? null;
        setUser(nextProfile);

        if (typeof window !== "undefined") {
            window.location.reload();
        }
    };

    const hydrateProfile = async (nextFirebaseUser: User | null, preferredProfileId?: string) => {
        setFirebaseUser(nextFirebaseUser);
        setGoogleSignInIntentState(getGoogleSignInIntent());

        if (!nextFirebaseUser) {
            setUser(null);
            setProfiles([]);
            setActiveProfileIdState(null);
            clearStoredActiveProfileId();
            return;
        }

        try {
            const [legacyUserDoc, ownedProfilesSnapshot] = await Promise.all([
                getDoc(doc(db, "users", nextFirebaseUser.uid)),
                getDocs(query(collection(db, "users"), where("owner_uids", "array-contains", nextFirebaseUser.uid))),
            ]);
            const profileMap = new Map<string, FirestoreUser>();

            if (legacyUserDoc.exists()) {
                const legacyData = legacyUserDoc.data() as FirestoreUser;
                if (isProfileOwnedByUid(legacyUserDoc.id, legacyData, nextFirebaseUser.uid)) {
                    profileMap.set(legacyUserDoc.id, normalizeProfile(legacyUserDoc.id, legacyData));
                }
            }

            for (const profileDoc of ownedProfilesSnapshot.docs) {
                profileMap.set(profileDoc.id, normalizeProfile(profileDoc.id, profileDoc.data() as FirestoreUser));
            }

            const nextProfiles = Array.from(profileMap.values()).sort((a, b) => {
                const left = a.global_id ?? a.id;
                const right = b.global_id ?? b.id;
                return left.localeCompare(right);
            });

            setProfiles(nextProfiles);

            if (nextProfiles.length > 0) {
                const storedProfileId = getStoredActiveProfileId();
                const selectedProfile =
                    nextProfiles.find((profile) => profile.id === preferredProfileId) ??
                    nextProfiles.find((profile) => profile.id === storedProfileId) ??
                    nextProfiles.find((profile) => profile.id === nextFirebaseUser.uid) ??
                    nextProfiles[0];
                setUser(selectedProfile);
                setActiveProfileIdState(selectedProfile.id);
                storeActiveProfileId(selectedProfile.id);
                clearGoogleSignInIntent();
                setGoogleSignInIntentState(null);
            } else {
                console.warn("No Firestore user found for:", nextFirebaseUser.email);
                setUser(null);
                setProfiles([]);
                setActiveProfileIdState(null);
                clearStoredActiveProfileId();
            }
        } catch (err) {
            console.error("Failed to fetch Firestore user:", err);
            setUser(null);
            setProfiles([]);
            setActiveProfileIdState(null);
            clearStoredActiveProfileId();
        }
    };

    const refreshProfiles = async (preferredProfileId?: string): Promise<void> => {
        setIsHydratingAuth(true);
        try {
            await hydrateProfile(auth.currentUser, preferredProfileId);
        } finally {
            setIsHydratingAuth(false);
        }
    };

    useEffect(() => {
        let isActive = true;

        const resolveRedirectResult = async () => {
            try {
                const redirectUser = await resolveRedirectUserOnce();
                if (isActive && redirectUser) {
                    setIsHydratingAuth(true);
                    await hydrateProfile(redirectUser);
                    setIsHydratingAuth(false);
                }
            } catch (err) {
                console.error("Failed to resolve Google redirect result:", err);
            } finally {
                if (isActive) {
                    setGoogleSignInIntentState(getGoogleSignInIntent());
                    setIsResolvingRedirect(false);
                }
            }
        };

        resolveRedirectResult();

        return () => {
            isActive = false;
        };
    }, []);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setIsHydratingAuth(true);
            await hydrateProfile(firebaseUser);
            setIsHydratingAuth(false);
        });

        return () => unsubscribe();
    }, []);

    const hasProfile = user !== null;
    const isGoogleOnlyAuth = isGoogleOnlyUser(firebaseUser);
    const isGoogleRegistrationPending = Boolean(firebaseUser && !hasProfile && hasGoogleProvider(firebaseUser));
    const loading = isResolvingRedirect || isHydratingAuth;
    const contextValue = useMemo(
        () => ({
            user,
            profiles,
            activeProfileId,
            setActiveProfileId,
            refreshProfiles,
            loading,
            firebaseUser,
            hasProfile,
            isGoogleOnlyAuth,
            isGoogleRegistrationPending,
            googleSignInIntent,
            setUser,
        }),
        [
            activeProfileId,
            firebaseUser,
            googleSignInIntent,
            hasProfile,
            isGoogleOnlyAuth,
            isGoogleRegistrationPending,
            loading,
            profiles,
            refreshProfiles,
            user,
        ],
    );

    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => useContext(AuthContext);
