import {
    type DocumentData,
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    orderBy,
    query,
    updateDoc,
    where,
} from "firebase/firestore";
import {deleteObject, getDownloadURL, ref, uploadBytes} from "firebase/storage";
import type {HomeCarouselImage} from "../../schema/HomeCarouselSchema";
import {db, storage} from "./config";

/**
 * Fetch all active carousel images ordered by their order field
 */
export async function getActiveCarouselImages(): Promise<HomeCarouselImage[]> {
    try {
        const q = query(collection(db, "homeCarousel"), where("active", "==", true), orderBy("order", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as HomeCarouselImage[];
    } catch (error) {
        console.error("Failed to fetch carousel images:", error);
        return [];
    }
}

/**
 * Fetch all carousel images (for admin management)
 */
export async function getAllCarouselImages(): Promise<HomeCarouselImage[]> {
    try {
        const q = query(collection(db, "homeCarousel"), orderBy("order", "asc"));
        const snapshot = await getDocs(q);
        return snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        })) as HomeCarouselImage[];
    } catch (error) {
        console.error("Failed to fetch all carousel images:", error);
        return [];
    }
}

/**
 * Upload carousel image to storage and create Firestore document
 */
export async function addCarouselImage(
    imageFile: File,
    title: string,
    description: string | null,
    link: string | null,
    order: number,
): Promise<string> {
    try {
        // Upload image to storage
        const timestamp = Date.now();
        const storageRef = ref(storage, `carousel/${timestamp}_${imageFile.name}`);
        await uploadBytes(storageRef, imageFile);
        const imageUrl = await getDownloadURL(storageRef);

        // Create Firestore document
        const docRef = await addDoc(collection(db, "homeCarousel"), {
            title,
            description,
            imageUrl,
            link,
            order,
            active: true,
            created_at: new Date(),
            updated_at: new Date(),
        });

        return docRef.id;
    } catch (error) {
        console.error("Failed to add carousel image:", error);
        throw error;
    }
}

/**
 * Update carousel image details
 */
export async function updateCarouselImage(
    id: string,
    updates: {
        title?: string;
        description?: string | null;
        link?: string | null;
        order?: number;
        active?: boolean;
    },
): Promise<void> {
    try {
        const docRef = doc(db, "homeCarousel", id);
        await updateDoc(docRef, {
            ...updates,
            updated_at: new Date(),
        });
    } catch (error) {
        console.error("Failed to update carousel image:", error);
        throw error;
    }
}

/**
 * Delete carousel image from storage and Firestore
 */
export async function deleteCarouselImage(id: string, imageUrl: string): Promise<void> {
    try {
        // Delete from storage
        const storageRef = ref(storage, imageUrl);
        await deleteObject(storageRef).catch(() => {
            // Ignore if file doesn't exist
        });

        // Delete from Firestore
        const docRef = doc(db, "homeCarousel", id);
        await deleteDoc(docRef);
    } catch (error) {
        console.error("Failed to delete carousel image:", error);
        throw error;
    }
}

/**
 * Reorder carousel images
 */
export async function reorderCarouselImages(images: {id: string; order: number}[]): Promise<void> {
    try {
        const updates = images.map(({id, order}) => {
            const docRef = doc(db, "homeCarousel", id);
            return updateDoc(docRef, {order, updated_at: new Date()});
        });
        await Promise.all(updates);
    } catch (error) {
        console.error("Failed to reorder carousel images:", error);
        throw error;
    }
}
