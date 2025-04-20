// src/context/AuthContext.tsx
import type React from "react";
import {createContext, useContext, useEffect, useState} from "react";
import {onAuthStateChanged, type User} from "firebase/auth";
import {auth} from "../services/firebase/config";

interface AuthContextType {
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
});

export const AuthProvider = ({children}: {children: React.ReactNode}) => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            setUser(firebaseUser);
            setLoading(false);
        });

        return () => unsubscribe(); // Clean up
    }, []);

    return <AuthContext.Provider value={{user, loading}}>{children}</AuthContext.Provider>;
};

export const useAuthContext = () => useContext(AuthContext);
