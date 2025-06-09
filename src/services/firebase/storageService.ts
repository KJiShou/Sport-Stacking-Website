import {ref, uploadBytes, getDownloadURL, uploadBytesResumable} from "firebase/storage";
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
