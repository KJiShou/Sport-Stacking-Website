export const formatGenderLabel = (gender?: string | null): string => {
    if (!gender) return "";
    return gender === "Mixed" ? "Mixed Gender" : gender;
};
