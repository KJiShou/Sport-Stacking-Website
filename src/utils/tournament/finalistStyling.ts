import type {FinalCriterion} from "@/schema";

export type FinalClassification = FinalCriterion["classification"];

export type FinalistAllocation<T> = {
    criterion: FinalCriterion;
    classification: FinalClassification;
    records: T[];
};

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

const FINALIST_CLASSIFICATION_PRIORITY: Record<FinalClassification, number> = {
    advance: 0,
    intermediate: 1,
    beginner: 2,
    prelim: 3,
};

export const allocateFinalistsByCriteria = <T extends {bestTime: number}>(
    records: T[],
    eventCodes: string[],
    criteria: FinalCriterion[] = [],
): FinalistAllocation<T>[] => {
    const eligibleRecords = records.filter((record) => isEligibleForFinalistSelection(eventCodes, record.bestTime));
    const prioritizedCriteria = criteria
        .map((criterion, index) => ({criterion, index}))
        .sort((a, b) => {
            const priorityDiff =
                FINALIST_CLASSIFICATION_PRIORITY[a.criterion.classification] -
                FINALIST_CLASSIFICATION_PRIORITY[b.criterion.classification];
            return priorityDiff || a.index - b.index;
        });

    const allocations: FinalistAllocation<T>[] = [];
    let processedCount = 0;

    for (const {criterion} of prioritizedCriteria) {
        const finalistCount = Math.max(0, criterion.number);
        const finalists = eligibleRecords.slice(processedCount, processedCount + finalistCount);

        allocations.push({
            criterion,
            classification: criterion.classification,
            records: finalists,
        });

        processedCount += finalistCount;
    }

    return allocations;
};

export const buildFinalistClassificationMap = <T extends {id: string; bestTime: number}>(
    records: T[],
    eventCodes: string[],
    criteria: FinalCriterion[] = [],
): Record<string, FinalClassification> => {
    const highlightedRecordClassifications: Record<string, FinalClassification> = {};

    for (const allocation of allocateFinalistsByCriteria(records, eventCodes, criteria)) {
        for (const finalistRecord of allocation.records) {
            highlightedRecordClassifications[finalistRecord.id] = allocation.classification;
        }
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
