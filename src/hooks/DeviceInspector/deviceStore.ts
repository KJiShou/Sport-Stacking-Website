import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export enum DeviceNetworkStatus {
    Online = "online",
    Offline = "offline",
}

export type DeviceLanguage = "en-US" | "ms-MY" | "zh-CN";

export enum DeviceBreakpoint {
    xs = 240, //Mobile Layout
    sm = 576,
    md = 768, //Tablet Layout
    lg = 992,
    xl = 1280, //PC Layout
    xxl = 1536,
    "3xl" = 1920,
    "4xl" = 2560, //Double PC Layout
    "5xl" = 3840,
    "6xl" = 4096,
}

export enum DeviceOrientation {
    PORTRAIT = 0,
    LANDSCAPE = 1,
}

export const deviceNetworkStatusAtom = atom<DeviceNetworkStatus>(
    DeviceNetworkStatus.Online,
);

export const deviceLanguageAtom = atomWithStorage<DeviceLanguage>(
    "lang",
    "en-US",
);

export const calculateDeviceBreakpoint = (width: number): DeviceBreakpoint => {
    if (width >= DeviceBreakpoint["6xl"]) return DeviceBreakpoint["6xl"];
    if (width >= DeviceBreakpoint["5xl"]) return DeviceBreakpoint["5xl"];
    if (width >= DeviceBreakpoint["4xl"]) return DeviceBreakpoint["4xl"];
    if (width >= DeviceBreakpoint["3xl"]) return DeviceBreakpoint["3xl"];
    if (width >= DeviceBreakpoint.xxl) return DeviceBreakpoint.xxl;
    if (width >= DeviceBreakpoint.xl) return DeviceBreakpoint.xl;
    if (width >= DeviceBreakpoint.lg) return DeviceBreakpoint.lg;
    if (width >= DeviceBreakpoint.md) return DeviceBreakpoint.md;
    if (width >= DeviceBreakpoint.sm) return DeviceBreakpoint.sm;
    return DeviceBreakpoint.xs;
};

export const compareDeviceBreakpoints = (
    a: DeviceBreakpoint,
    b: DeviceBreakpoint,
): 0 | 1 | -1 => {
    if (a === b) return 0;
    if (a > b) return 1;
    return -1;
};

export const deviceBreakpointAtom = atom<DeviceBreakpoint>(DeviceBreakpoint.xs);

export const deviceOrientationAtom = atom<DeviceOrientation>(
    DeviceOrientation.LANDSCAPE,
);
