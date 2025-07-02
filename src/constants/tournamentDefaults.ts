import type {AgeBracket, Tournament} from "../schema";

export const DEFAULT_EVENTS: Tournament["events"] = [
    {
        code: "3-3-3",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9, final_criteria: [{classification: "intermediate" as const, number: 10}]},
            {
                name: "10 and Above",
                min_age: 10,
                max_age: 99,
                final_criteria: [{classification: "intermediate" as const, number: 10}],
            },
        ],
    },
    {
        code: "3-6-3",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9, final_criteria: [{classification: "intermediate" as const, number: 10}]},
            {
                name: "10 and Above",
                min_age: 10,
                max_age: 99,
                final_criteria: [{classification: "intermediate" as const, number: 10}],
            },
        ],
    },
    {
        code: "cycle",
        type: "individual",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9, final_criteria: [{classification: "intermediate" as const, number: 10}]},
            {
                name: "10 and Above",
                min_age: 10,
                max_age: 99,
                final_criteria: [{classification: "intermediate" as const, number: 10}],
            },
        ],
    },
    {
        code: "3-6-3",
        type: "team relay",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9, final_criteria: [{classification: "intermediate" as const, number: 4}]},
            {
                name: "10 and Above",
                min_age: 10,
                max_age: 99,
                final_criteria: [{classification: "intermediate" as const, number: 4}],
            },
        ],
    },
    {
        code: "cycle",
        type: "team relay",
        age_brackets: [
            {name: "Under 10", min_age: 0, max_age: 9, final_criteria: [{classification: "intermediate" as const, number: 4}]},
            {
                name: "10 and Above",
                min_age: 10,
                max_age: 99,
                final_criteria: [{classification: "intermediate" as const, number: 4}],
            },
        ],
    },
];

export const DEFAULT_AGE_BRACKET: AgeBracket[] = [
    {
        name: "Under 10",
        min_age: 0,
        max_age: 9,
        number_of_participants: 0,
        final_criteria: [{classification: "intermediate" as const, number: 10}],
    },
    {
        name: "10 and Above",
        min_age: 10,
        max_age: 99,
        number_of_participants: 0,
        final_criteria: [{classification: "intermediate" as const, number: 10}],
    },
];
