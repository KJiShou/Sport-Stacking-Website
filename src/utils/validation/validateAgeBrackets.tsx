import type { AgeBracket } from "../../schema";

export function validateAgeBrackets(brackets: AgeBracket[]): string | null {
    for (const [i, bracket] of brackets.entries()) {
        const { name, min_age, max_age } = bracket;
        if (!name || min_age == null || max_age == null) {
            return `Please fill in all fields for bracket ${i + 1}.`;
        }
        if (min_age > max_age) {
            return `Bracket ${i + 1}: Min age cannot exceed Max age.`;
        }
    }

    const usedAges = new Set<number>();
    for (const bracket of brackets) {
        for (let age = bracket.min_age; age <= bracket.max_age; age++) {
            if (usedAges.has(age)) {
                return `Age ${age} appears in multiple brackets.`;
            }
            usedAges.add(age);
        }
    }

    return null; // ✅ valid
}
