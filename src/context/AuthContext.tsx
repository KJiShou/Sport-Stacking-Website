import type {FirestoreUser} from "@/schema/UserSchema";
import {type User, onAuthStateChanged} from "firebase/auth";
import {doc, getDoc} from "firebase/firestore";
// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useState} from "react";
import {auth, db} from "../services/firebase/config";

interface AuthContextType {
    user: FirestoreUser | null;
    loading: boolean;
    firebaseUser: User | null;
    setUser: React.Dispatch<React.SetStateAction<FirestoreUser | null>>;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    firebaseUser: null,
    setUser: () => {
        // default no-op function
    },
});

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            setFirebaseUser(firebaseUser);

            if (firebaseUser) {
                try {
                    const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
                    if (userDoc.exists()) {
                        setUser(userDoc.data() as FirestoreUser);
                    } else {
                        console.warn("No Firestore user found for:", firebaseUser.email);
                        setUser(null);
                    }
                } catch (err) {
                    console.error("Failed to fetch Firestore user:", err);
                    setUser(null);
                }
            } else {
                setUser(null);
            }

            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    return <AuthContext.Provider value={{user, loading, firebaseUser, setUser}}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => useContext(AuthContext);
