import {useAtomValue} from "jotai";
import {deviceBreakpointAtom, deviceLanguageAtom, deviceNetworkStatusAtom, deviceOrientationAtom} from "./deviceStore";
export {DeviceInspector} from "./DeviceInspector";

export const useDeviceNetworkStatus = () => useAtomValue(deviceNetworkStatusAtom);

export const useDeviceLanguage = () => useAtomValue(deviceLanguageAtom);

export const useDeviceBreakpoint = () => useAtomValue(deviceBreakpointAtom);

export const useDeviceOrientation = () => useAtomValue(deviceOrientationAtom);
