import React, {useCallback, useEffect, useRef, useState} from "react";
import {GoogleMap, Marker, useJsApiLoader} from "@react-google-maps/api";
import {Input, Spin} from "@arco-design/web-react";
import {countries} from "@/schema/Country";

// 地图容器样式
const containerStyle = {
    width: "100%",
    height: "300px",
};

// 默认坐标：吉隆坡
const defaultPosition = {lat: 3.139, lng: 101.6869};

// ✅ 避免 useJsApiLoader 重复加载
const GOOGLE_LIBRARIES: "places"[] = ["places"];

type Props = {
    value: string; // 地址
    onChange: (address: string) => void;
    countryValue?: string; // 新增：选中的国家或地区
    onCountryChange?: (countryPath: string[]) => void;
};

type CascaderOption = {
    value: string;
    label: string;
    children?: CascaderOption[];
};

export function isValidCountryPath(path: string[], options: CascaderOption[] = countries): boolean {
    if (!path.length) return false;

    const [head, ...tail] = path;

    const current = options.find((opt) => normalizeRegionName(opt.label) === normalizeRegionName(head));
    if (!current) return false;
    if (tail.length === 0) return true;

    if (!current.children) return false;

    return isValidCountryPath(tail, current.children);
}

function normalizeRegionName(name: string): string {
    const map: Record<string, string> = {
        "Federal Territory of Kuala Lumpur": "Wilayah Persekutuan (Kuala Lumpur)",
        "Federal Territory of Putrajaya": "Wilayah Persekutuan (Putrajaya)",
        "Federal Territory of Labuan": "Wilayah Persekutuan (Labuan)",
        "Wilayah Persekutuan Kuala Lumpur": "Wilayah Persekutuan (Kuala Lumpur)",
        Putrajaya: "Wilayah Persekutuan (Putrajaya)",
        "Labuan Federal Territory": "Wilayah Persekutuan (Labuan)",
    };

    return map[name] ?? name;
}

export default function LocationPicker({onCountryChange, countryValue, value, onChange}: Props) {
    const [mapInstance, setMapInstance] = useState<google.maps.Map | null>(null);
    const [position, setPosition] = useState(defaultPosition);
    const [loading, setLoading] = useState(false);

    const geocoderRef = useRef<google.maps.Geocoder>();

    const {isLoaded} = useJsApiLoader({
        googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY!,
        libraries: GOOGLE_LIBRARIES,
    });

    // 初始化 Geocoder
    useEffect(() => {
        if (isLoaded) {
            geocoderRef.current = new google.maps.Geocoder();
        }
    }, [isLoaded]);

    useEffect(() => {
        if (mapInstance && position) {
            mapInstance.panTo(position);
        }
    }, [position]);

    useEffect(() => {
        if (!countryValue || !geocoderRef.current || !mapInstance) return;

        geocoderRef.current.geocode({address: countryValue}, (results, status) => {
            if (status === "OK" && results && results[0]) {
                const loc = results[0].geometry.location;
                const newPos = {lat: loc.lat(), lng: loc.lng()};
                setPosition(newPos);
                mapInstance.panTo(newPos);
            }
        });
    }, [countryValue]);

    // ✅ 用户输入地址时：地址 ➜ 坐标
    useEffect(() => {
        if (!geocoderRef.current || !value || !isLoaded) return;

        setLoading(true);
        geocoderRef.current.geocode({address: value}, (results, status) => {
            setLoading(false);
            if (status === "OK" && results && results[0]) {
                const loc = results[0].geometry.location;
                const newPos = {lat: loc.lat(), lng: loc.lng()};
                setPosition(newPos);
                mapInstance?.panTo(newPos);
            }
        });
    }, [value, isLoaded]);

    // ✅ 用户点击地图或拖动 marker：坐标 ➜ 地址
    const updateAddressFromCoords = useCallback(
        (lat: number, lng: number) => {
            if (!geocoderRef.current) return;

            const latlng = {lat, lng};

            geocoderRef.current.geocode({location: latlng}, (results, status) => {
                if (status === "OK" && results && results[0]) {
                    const result = results[0];
                    onChange(result.formatted_address);

                    // ✅ 提取国家和州
                    const countryComp = result.address_components.find((c) => c.types.includes("country"));
                    const stateComp = result.address_components.find((c) => c.types.includes("administrative_area_level_1"));

                    if (countryComp && stateComp && onCountryChange) {
                        const countryPath = [countryComp.long_name, normalizeRegionName(stateComp.long_name)];
                        onCountryChange(countryPath); // 更新 Cascader
                    }
                }
            });
        },
        [onChange, onCountryChange],
    );

    // ✅ 地图点击行为
    const handleMapClick = (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const newPos = {
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
        };
        setPosition(newPos);
        updateAddressFromCoords(newPos.lat, newPos.lng);
    };

    console.log("position", position);

    // ✅ Marker 拖动行为
    const handleMarkerDragEnd = (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const newPos = {
            lat: e.latLng.lat(),
            lng: e.latLng.lng(),
        };
        setPosition(newPos);
        updateAddressFromCoords(newPos.lat, newPos.lng);
    };

    if (!isLoaded) return <Spin loading>Loading map...</Spin>;

    return (
        <div className="flex flex-col gap-2">
            {/* 地址输入框：手动输入会更新地图 */}
            <Input value={value} onChange={onChange} placeholder="Enter address" />

            {/* 地图 */}
            <GoogleMap
                mapContainerStyle={containerStyle}
                center={position}
                zoom={14}
                onClick={handleMapClick}
                onLoad={(map) => setMapInstance(map)}
                options={{
                    streetViewControl: true,
                    fullscreenControl: false,
                    cameraControl: false,
                }}
            >
                <Marker key={position.lat} position={position} draggable onDragEnd={handleMarkerDragEnd} />
            </GoogleMap>
        </div>
    );
}
