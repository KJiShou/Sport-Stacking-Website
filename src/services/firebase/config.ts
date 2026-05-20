// Import the functions you need from the SDKs you need
import type {FirebaseConfig} from "@/schema";
import {initializeApp} from "firebase/app";
import {ReCaptchaV3Provider, initializeAppCheck} from "firebase/app-check";
import {getAuth} from "firebase/auth";
import {getFirestore} from "firebase/firestore";
import {connectFunctionsEmulator, getFunctions} from "firebase/functions";
import {getStorage} from "firebase/storage";

const firebaseConfig: FirebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const isLocalhost = typeof window !== "undefined" && ["localhost", "127.0.0.1", "0.0.0.0"].includes(window.location.hostname);
if (!isLocalhost) {
    initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider("6LcRC_0rAAAAADINnR7-KKu56U_F-QiCt0I0I0QQ"),
        isTokenAutoRefreshEnabled: true,
    });
}
const firestoreDatabaseId = import.meta.env.VITE_FIRESTORE_DATABASE_ID?.trim();
export const db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
const functionsRegion = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION?.trim() || "asia-southeast1";
export const functions = getFunctions(app, functionsRegion);

const useFunctionsEmulator = import.meta.env.DEV && import.meta.env.VITE_USE_FUNCTIONS_EMULATOR === "true";
if (useFunctionsEmulator) {
    const emulatorHost =
        import.meta.env.VITE_FUNCTIONS_EMULATOR_HOST?.trim() ||
        (typeof window !== "undefined" ? window.location.hostname : "127.0.0.1");
    const defaultEmulatorPort = typeof window !== "undefined" && window.location.port ? window.location.port : "5000";
    const emulatorPort = Number.parseInt(import.meta.env.VITE_FUNCTIONS_EMULATOR_PORT ?? defaultEmulatorPort, 10);
    connectFunctionsEmulator(functions, emulatorHost, Number.isFinite(emulatorPort) ? emulatorPort : 5000);
}
