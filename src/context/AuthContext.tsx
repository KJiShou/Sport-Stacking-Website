// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useState} from "react";
import {onAuthStateChanged, type User} from "firebase/auth";
import {auth} from "../services/firebase/config";
import type {FirestoreUser} from "@/schema/UserSchema";

interface AuthContextType {
    user: FirestoreUser | null;
    loading: boolean;
    firebaseUser: User | null;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
    firebaseUser: null,
});

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<FirestoreUser | null>(null);
    const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setFirebaseUser(firebaseUser);
            setUser(null);
            setLoading(false);
        });

        return () => unsubscribe(); // Clean up
    }, []);

    return <AuthContext.Provider value={{user, loading, firebaseUser}}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => useContext(AuthContext);
