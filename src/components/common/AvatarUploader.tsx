import {Avatar, Message, Spin, Upload} from "@arco-design/web-react";
import {IconCamera} from "@arco-design/web-react/icon";
import React, {useState} from "react";
import type {FirestoreUser} from "../../schema";
import {updateUserProfile} from "../../services/firebase/authService";
import {uploadAvatar} from "../../services/firebase/storageService";

interface Props {
    user: FirestoreUser;
    setUser: (u: FirestoreUser) => void;
}

export function AvatarUploader({user, setUser}: Readonly<Props>) {
    const [uploading, setUploading] = useState(false);

    return (
        <Upload
            showUploadList={false}
            accept="image/*"
            customRequest={async ({file, onSuccess, onError}) => {
                try {
                    setUploading(true);
                    // 1. 上传到 Storage，返回下载 URL
                    const url = await uploadAvatar(file, user.id);
                    // 2. 更新 Firestore
                    await updateUserProfile(user.id, {image_url: url});
                    // 3. 更新本地状态
                    setUser({...user, image_url: url});
                    onSuccess?.({});
                    Message.success("Avatar uploaded successfully");
                } catch (err) {
                    console.error(err);
                    onError?.(err as Error);
                    Message.error("avatar upload failed");
                } finally {
                    setUploading(false);
                    window.location.reload();
                }
            }}
        >
            <div className="relative inline-block">
                <Avatar
                    size={100}
                    className="mx-auto w-24 h-24 rounded-full overflow-hidden"
                    triggerIcon={<IconCamera />}
                    triggerType="mask"
                >
                    {uploading ? (
                        <Spin size={24} />
                    ) : (
                        <img className="w-full h-full object-cover" src={user.image_url} alt={user.name} />
                    )}
                </Avatar>
            </div>
        </Upload>
    );
}
