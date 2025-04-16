import {db} from "./config";
import {collection, addDoc, getDocs} from "firebase/firestore";
import { CompetitionSchema } from "../../schema";

// Function to add an athlete to Firestore
export const addAthlete = async (athlete) => {
    try {
        const docRef = await addDoc(collection(db, "athletes"), athlete);
        console.log("📌 Document written with ID:", docRef.id);
    } catch (error) {
        console.error("❌ Error adding document:", error);
    }
};

export const getAthletes = async () => {
    try {
        const querySnapshot = await getDocs(collection(db, "athletes"));
        return querySnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));
    } catch (error) {
        console.error("❌ Error fetching documents:", error);
        return [];
    }
};