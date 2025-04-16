"use client";

import {Message, Modal} from "@arco-design/web-react";
import {useSetAtom} from "jotai";
import React, {useRef} from "react";
import {useEffectOnce, useMount} from "react-use";
import {calculateDeviceBreakpoint, deviceBreakpointAtom, deviceNetworkStatusAtom, deviceOrientationAtom} from "./deviceStore";
import {DeviceNetworkStatus, DeviceOrientation} from "./deviceStore";

const fetchOS = () => {
    const {userAgent} = navigator;

    if (userAgent.indexOf("Win") > -1) {
        return "Windows";
    }

    if (userAgent.indexOf("Mac") > -1) {
        return "Mac";
    }

    if (userAgent.indexOf("Android") > -1) {
        return "Android";
    }

    if (userAgent.indexOf("Linux") > -1) {
        return "Linux";
    }

    if (userAgent.indexOf("like Mac") > -1) {
        return "iOS";
    }

    return "Unknown";
};

const fetchBrowser = () => {
    const {userAgent} = navigator;

    if (userAgent.indexOf("Chrome") > -1) {
        return "Chrome";
    }

    if (userAgent.indexOf("Firefox") > -1) {
        return "Firefox";
    }

    if (userAgent.indexOf("Safari") > -1) {
        return "Safari";
    }

    if (userAgent.indexOf("compatible") > -1 && userAgent.indexOf("MSIE") > -1) {
        return "IE";
    }

    return "Unknown";
};

const fetchBrowserVersion = () => {
    const {userAgent} = navigator;

    const regexes = {
        Chrome: /Chrome\/(\S+)/,
        Firefox: /Firefox\/(\S+)/,
        Safari: /Safari\/(\S+)/,
        IE: /MSIE (\S+);/,
    };

    const browser = fetchBrowser();

    if (browser === "Unknown") {
        return "Unknown";
    }

    const match = userAgent.match(regexes[browser]);

    if (match) {
        return match[1];
    }

    return "Unknown";
};

export const DeviceInspector = () => {
    const mountedRef = useRef<boolean>(false);

    // const setDeviceNetworkStatus = useSetAtom(deviceNetworkStatusAtom);
    const setDeviceBreakpoint = useSetAtom(deviceBreakpointAtom);
    const setDeviceOrientation = useSetAtom(deviceOrientationAtom);

    const windowInnerResolutionDivRef = useRef<HTMLDivElement>(null);
    const devicePixelRatioDivRef = useRef<HTMLDivElement>(null);

    // const networkHealthChecker = useRef<number>(0);

    const handleDeviceInfoViewerOpen = async () => {
        Modal.info({
            title: "Device Info",
            style: {maxWidth: "90%"},
            okButtonProps: {style: {width: "50%"}},
            content: (
                <div className="flex flex-col gap-5">
                    <div className="flex flex-row">
                        <div className="w-5/12">OS</div>
                        <div className="w-7/12">{fetchOS()}</div>
                    </div>
                    <div className="flex flex-row">
                        <div className="w-5/12">Browser</div>
                        <div className="w-7/12">
                            {fetchBrowser()} ({fetchBrowserVersion()})
                        </div>
                    </div>
                    <div className="flex flex-row">
                        <div className="w-5/12">Resolution</div>
                        <div className="w-7/12" ref={windowInnerResolutionDivRef}>
                            {`${window.innerWidth} x ${window.innerHeight}`}
                        </div>
                    </div>
                    <div className="flex flex-row">
                        <div className="w-5/12">Device Pixel Ratio</div>
                        <div className="w-7/12" ref={devicePixelRatioDivRef}>
                            {window.devicePixelRatio}
                        </div>
                    </div>
                    <div className="flex flex-row">
                        <div className="w-5/12">Color Depth</div>
                        <div className="w-7/12">{window.screen.colorDepth} bit</div>
                    </div>
                    <div className="flex flex-row">
                        <div className="w-5/12">Touch Screen</div>
                        <div className="w-7/12">{"ontouchstart" in window || navigator.maxTouchPoints > 0 ? "Yes" : "No"}</div>
                    </div>
                </div>
            ),
        });
    };

    useMount(() => {
        if (mountedRef.current) {
            return;
        }
        mountedRef.current = true;

        const handleWindowResize = async () => {
            const {innerWidth, innerHeight} = window;

            setDeviceBreakpoint(calculateDeviceBreakpoint(innerWidth));
            setDeviceOrientation(innerWidth > innerHeight ? DeviceOrientation.LANDSCAPE : DeviceOrientation.PORTRAIT);

            if (windowInnerResolutionDivRef.current) {
                windowInnerResolutionDivRef.current.innerText = `${innerWidth} x ${innerHeight}`;
            }

            if (devicePixelRatioDivRef.current) {
                devicePixelRatioDivRef.current.innerText = window.devicePixelRatio.toString();
            }
        };

        const isOnline = true;
        // const healthCheckNetwork = async () => {
        //     try {
        //         await fetch(`/api/ping`);
        //         setDeviceNetworkStatus(DeviceNetworkStatus.Online);

        //         if (!isOnline) {
        //             Message.info({
        //                 content: "Your device is back online.",
        //                 duration: 3000,
        //             });
        //         }

        //         isOnline = true;
        //     } catch (_) {
        //         setDeviceNetworkStatus(DeviceNetworkStatus.Offline);

        //         if (isOnline) {
        //             Message.error({
        //                 content: "Your device is offline, please check your network connection.",
        //                 duration: 5000,
        //             });
        //         }

        //         isOnline = false;
        //     }
        // };

        window.addEventListener("resize", handleWindowResize);

        // networkHealthChecker.current = window.setInterval(healthCheckNetwork, 10000);

        const handleWindowKeyDown = async (event: KeyboardEvent) => {
            if (event.key === "i" && event.ctrlKey && event.altKey) {
                handleDeviceInfoViewerOpen();
            }
        };

        const handleTouch = async (event: TouchEvent) => {
            if (event.touches.length === 3) {
                handleDeviceInfoViewerOpen();
            }
        };

        window.addEventListener("keydown", handleWindowKeyDown);
        window.addEventListener("touchstart", handleTouch);

        handleWindowResize().then();

        return () => {
            window.removeEventListener("resize", handleWindowResize);
            window.removeEventListener("keydown", handleWindowKeyDown);
            window.removeEventListener("touchstart", handleTouch);
            // window.clearInterval(networkHealthChecker.current);
        };
    });

    return <React.Fragment />;
};