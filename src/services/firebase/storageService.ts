import {ref, uploadBytes, getDownloadURL} from "firebase/storage";
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
