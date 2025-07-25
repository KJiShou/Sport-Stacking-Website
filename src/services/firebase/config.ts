// Import the functions you need from the SDKs you need
import {initializeApp} from "firebase/app";
import {getAuth} from "firebase/auth";
import {getFirestore} from "firebase/firestore";
import {getStorage} from "firebase/storage";

interface FirebaseConfig {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId: string;
}

const firebaseConfig: FirebaseConfig = {
    apiKey: "AIzaSyASIxz9tcaoo7_Bdoyfpgdc1akUjjTCGNU",
    authDomain: "sport-stacking-website.firebaseapp.com",
    projectId: "sport-stacking-website",
    storageBucket: "sport-stacking-website.firebasestorage.app",
    messagingSenderId: "439583771971",
    appId: "1:439583771971:web:41c9e41be1cb6bbeb373f6",
    measurementId: "G-Y70B9ETF5D",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
