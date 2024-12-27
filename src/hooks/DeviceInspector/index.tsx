import { useAtomValue } from 'jotai';
import {
    deviceNetworkStatusAtom,
    deviceBreakpointAtom,
    deviceOrientationAtom,
    deviceLanguageAtom,
} from './deviceStore';

export const useDeviceNetworkStatus = () =>
    useAtomValue(deviceNetworkStatusAtom);

export const useDeviceLanguage = () => useAtomValue(deviceLanguageAtom);

export const useDeviceBreakpoint = () => useAtomValue(deviceBreakpointAtom);

export const useDeviceOrientation = () => useAtomValue(deviceOrientationAtom);
