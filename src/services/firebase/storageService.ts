import {deleteObject, getDownloadURL, listAll, ref, uploadBytes, uploadBytesResumable} from "firebase/storage";
import {storage} from "./config";

export const uploadAvatar = async (file: File, uid: string): Promise<string> => {
    const storageRef = ref(storage, `avatars/${uid}`);

    const metadata = {
        contentType: file.type ?? "image/jpeg", // 👈 fallback to safe default
    };

    await uploadBytes(storageRef, file, metadata); // ✅ metadata 放这里
    const url = await getDownloadURL(storageRef);
    return url;
};

/**
 * 上传文件到 Firebase Storage
 * @param file File对象
 * @param path 子目录 (可选)
 * @param onProgress 进度更新 callback
 * @returns 上传完成后得到的下载URL
 */
export function uploadFile(
    file: File,
    path = "uploads",
    fileName?: string,
    onProgress?: (progress: number) => void,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const storageRef = ref(storage, `${path}/${fileName}`);
        const uploadTask = uploadBytesResumable(storageRef, file);

        uploadTask.on(
            "state_changed",
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                if (onProgress) {
                    onProgress(progress); // ✅ 每次更新实时调用
                }
            },
            (error) => {
                console.error("Upload failed:", error);
                reject(error);
            },
            async () => {
                const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
                resolve(downloadURL);
            },
        );
    });
}

/**
 * Delete a single file from Firebase Storage
 * @param filePath Full path to the file in storage
 */
export async function deleteFile(filePath: string): Promise<void> {
    try {
        const fileRef = ref(storage, filePath);
        await deleteObject(fileRef);
    } catch (error: unknown) {
        // If file doesn't exist, don't throw error
        if (error instanceof Error && "code" in error && error.code === "storage/object-not-found") {
            return;
        }
        console.error(`Error deleting file ${filePath}:`, error);
        throw error;
    }
}

/**
 * Delete all files in a storage directory (folder)
 * @param folderPath Path to the folder in storage
 */
export async function deleteFolder(folderPath: string): Promise<void> {
    try {
        const folderRef = ref(storage, folderPath);
        const listResult = await listAll(folderRef);

        // Delete all files in the folder
        const deletePromises = listResult.items.map((itemRef) => deleteObject(itemRef));

        // Recursively delete subfolders
        const subfolderPromises = listResult.prefixes.map((subfolderRef) => deleteFolder(subfolderRef.fullPath));

        await Promise.all([...deletePromises, ...subfolderPromises]);
    } catch (error: unknown) {
        // If folder doesn't exist, don't throw error
        if (error instanceof Error && "code" in error && error.code === "storage/object-not-found") {
            return;
        }
        console.error(`Error deleting folder ${folderPath}:`, error);
        throw error;
    }
}

/**
 * Delete all tournament-related storage files
 * @param tournamentId Tournament ID
 */
export async function deleteTournamentStorage(tournamentId: string): Promise<void> {
    try {
        // Delete tournament-specific files and folders
        const deletePromises = [
            // Tournament agenda and logo files
            deleteFile(`agendas/${tournamentId}`),
            deleteFile(`logos/${tournamentId}`),

            // All registration payment proofs for this tournament
            deleteFolder(`tournaments/${tournamentId}/registrations/payment_proof`),

            // Any other tournament-specific files
            deleteFolder(`tournaments/${tournamentId}`),
        ];

        await Promise.all(deletePromises);
    } catch (error) {
        console.error(`Error deleting tournament storage for ${tournamentId}:`, error);
        // Don't throw here - storage deletion shouldn't block tournament deletion
    }
}
