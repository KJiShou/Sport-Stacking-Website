import type {Tournament} from "../schema";

export const DEFAULT_EVENTS: Tournament["events"] = [
    {
        code: "3-3-3",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9},
            {name: "10 and Above", min_age: 10, max_age: 99},
        ],
    },
    {
        code: "3-6-3",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9},
            {name: "10 and Above", min_age: 10, max_age: 99},
        ],
    },
    {
        code: "cycle",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9},
            {name: "10 and Above", min_age: 10, max_age: 99},
        ],
    },
];

export const DEFAULT_FINAL_CRITERIA: Tournament["final_criteria"] = [
    {
        type: "individual",
        number: 8,
    },
];

export const DEFAULT_FINAL_CATEGORIES: Tournament["final_categories"] = [
    {
        name: "Gold Final",
        start: 1,
        end: 4,
    },
    {
        name: "Silver Final",
        start: 5,
        end: 8,
    },
];
