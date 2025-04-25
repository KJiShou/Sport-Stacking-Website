import {allCountries} from "country-region-data";

export const countries = allCountries.map((country) => ({
    value: country[0],
    label: country[0],
    children: country[2].map((region) => ({
        value: region[0],
        label: region[0],
    })),
}));
