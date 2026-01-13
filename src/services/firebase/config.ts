// Import the functions you need from the SDKs you need
import type {FirebaseConfig} from "@/schema";
import {initializeApp} from "firebase/app";
import {ReCaptchaV3Provider, initializeAppCheck} from "firebase/app-check";
import {getAuth} from "firebase/auth";
import {getFirestore} from "firebase/firestore";
import {getFunctions} from "firebase/functions";
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
const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider("6LcRC_0rAAAAADINnR7-KKu56U_F-QiCt0I0I0QQ"),
    isTokenAutoRefreshEnabled: true,
});
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
const functionsRegion = import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION;
export const functions = functionsRegion ? getFunctions(app, functionsRegion) : getFunctions(app);
