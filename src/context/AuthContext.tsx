import type {AuthContextValue, FirestoreUser} from "@/schema";
import {type User, getRedirectResult, onAuthStateChanged} from "firebase/auth";
import {doc, getDoc} from "firebase/firestore";
// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useState} from "react";
import {
    type GoogleSignInIntent,
    clearGoogleSignInIntent,
    getGoogleSignInIntent,
    hasGoogleProvider,
    isGoogleOnlyUser,
} from "../services/firebase/authService";
import {auth, db} from "../services/firebase/config";

let redirectResultPromise: Promise<User | null> | null = null;
let redirectResultUserCache: User | null | undefined;

const resolveRedirectUserOnce = async (): Promise<User | null> => {
    if (redirectResultUserCache !== undefined) {
        return redirectResultUserCache;
    }

    if (!redirectResultPromise) {
        redirectResultPromise = getRedirectResult(auth)
            .then((redirectResult) => {
                redirectResultUserCache = redirectResult?.user ?? null;
                return redirectResultUserCache;
            })
            .catch((err) => {
                redirectResultUserCache = null;
                throw err;
            });
    }

    return redirectResultPromise;
};

const AuthContext = createContext<AuthContextValue>({
    user: null,
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

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [googleSignInIntent, setGoogleSignInIntentState] = useState<GoogleSignInIntent | null>(() => getGoogleSignInIntent());
    const [isHydratingAuth, setIsHydratingAuth] = useState(true);
    const [isResolvingRedirect, setIsResolvingRedirect] = useState(true);

    const hydrateProfile = async (nextFirebaseUser: User | null) => {
        setFirebaseUser(nextFirebaseUser);
        setGoogleSignInIntentState(getGoogleSignInIntent());

        if (!nextFirebaseUser) {
            setUser(null);
            return;
        }

        try {
            const userDoc = await getDoc(doc(db, "users", nextFirebaseUser.uid));
            if (userDoc.exists()) {
                setUser(userDoc.data() as FirestoreUser);
                clearGoogleSignInIntent();
                setGoogleSignInIntentState(null);
            } else {
                console.warn("No Firestore user found for:", nextFirebaseUser.email);
                setUser(null);
            }
        } catch (err) {
            console.error("Failed to fetch Firestore user:", err);
            setUser(null);
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

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                firebaseUser,
                hasProfile,
                isGoogleOnlyAuth,
                isGoogleRegistrationPending,
                googleSignInIntent,
                setUser,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
};

export const useAuthContext = () => useContext(AuthContext);
