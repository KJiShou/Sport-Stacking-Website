import type {FirestoreUser} from "./UserSchema";

export interface AvatarUploaderProps {
    user: FirestoreUser;
    setUser: (user: FirestoreUser) => void;
}

export interface AllTimeStat {
    event: string;
    time: number;
    rank: string;
}

export interface OnlineBest {
    event: string;
    time: number;
}

export interface RecordItem {
    event: string;
    time: number;
    date: string;
}
