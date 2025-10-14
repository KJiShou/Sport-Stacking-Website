import type {ComponentType, ReactNode} from "react";

export interface AppRoute {
    path: string;
    component: ComponentType;
}

export interface AthleteSummary {
    id?: string;
    name: string;
    country: string;
    age: number;
}

export interface RecordSummary {
    id?: string;
    athleteId: string;
    time: number;
    date: string;
    tournament?: string;
}

export interface MenuItemDefinition {
    key: string;
    label: string;
}

export interface NavItemDefinition {
    path: string;
    label: string;
    icon?: ReactNode;
    children?: NavItemDefinition[];
}
