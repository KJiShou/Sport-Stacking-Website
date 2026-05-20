import type {FinalCriterion} from "@/schema";

export type FinalClassification = FinalCriterion["classification"];

type FinalistVisualStyle = {
    label: string;
    rowClassName: string;
    tint: string;
    surface: string;
    border: string;
    text: string;
};

export const FINALIST_EXCLUDED_TOTAL_TIME = 299.997;
export const TIME_COMPARISON_EPSILON = 0.0005;

export const FINALIST_VISUAL_STYLES: Record<FinalClassification, FinalistVisualStyle> = {
    advance: {
        label: "Advance Final",
        rowClassName: "finalist-row--advance",
        tint: "#ec4899",
        surface: "#fdf2f8",
        border: "#f9a8d4",
        text: "#9d174d",
    },
    intermediate: {
        label: "Intermediate Final",
        rowClassName: "finalist-row--intermediate",
        tint: "#ca8a04",
        surface: "#fefce8",
        border: "#fde047",
        text: "#854d0e",
    },
    beginner: {
        label: "Beginner Final",
        rowClassName: "finalist-row--beginner",
        tint: "#0891b2",
        surface: "#ecfeff",
        border: "#67e8f9",
        text: "#0e7490",
    },
    prelim: {
        label: "Prelim Final",
        rowClassName: "finalist-row--prelim",
        tint: "#475569",
        surface: "#eef2f7",
        border: "#cbd5e1",
        text: "#334155",
    },
};

export const isEligibleForFinalistSelection = (eventCodes: string[], bestTime: number): boolean => {
    if (typeof bestTime !== "number" || !Number.isFinite(bestTime)) {
        return false;
    }

    if (eventCodes.length <= 1) {
        return true;
    }

    return Math.abs(bestTime - FINALIST_EXCLUDED_TOTAL_TIME) > TIME_COMPARISON_EPSILON;
};

export const buildFinalistClassificationMap = <T extends {id: string; bestTime: number}>(
    records: T[],
    eventCodes: string[],
    criteria: FinalCriterion[] = [],
): Record<string, FinalClassification> => {
    const eligibleRecords = records.filter((record) => isEligibleForFinalistSelection(eventCodes, record.bestTime));
    const highlightedRecordClassifications: Record<string, FinalClassification> = {};
    let processedCount = 0;

    for (const criterion of criteria) {
        const bracketFinalists = eligibleRecords.slice(processedCount, processedCount + criterion.number);
        for (const finalistRecord of bracketFinalists) {
            highlightedRecordClassifications[finalistRecord.id] = criterion.classification;
        }
        processedCount += criterion.number;
    }

    return highlightedRecordClassifications;
};

export const getFinalistLegendItems = (criteria: FinalCriterion[] = []): FinalClassification[] => {
    const seen = new Set<FinalClassification>();
    const items: FinalClassification[] = [];

    for (const criterion of criteria) {
        if (!seen.has(criterion.classification)) {
            seen.add(criterion.classification);
            items.push(criterion.classification);
        }
    }

    return items;
};
