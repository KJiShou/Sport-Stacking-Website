/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        screens: {
            xs: "0px",
            sm: "576px",
            md: "768px",
            lg: "992px",
            xl: "1280px",
            xxl: "1536px",
        },
        // The application intentionally keeps a 10px root for its existing
        // spacing tokens.  Font utilities must not inherit that root, or a
        // `text-sm` on a phone becomes an unreadable 1.4rem/14px equivalent.
        fontSize: {
            xs: ["12px", {lineHeight: "16px"}],
            sm: ["14px", {lineHeight: "20px"}],
            base: ["16px", {lineHeight: "24px"}],
            lg: ["18px", {lineHeight: "28px"}],
            xl: ["20px", {lineHeight: "28px"}],
            "2xl": ["24px", {lineHeight: "32px"}],
            "3xl": ["30px", {lineHeight: "36px"}],
            "4xl": ["36px", {lineHeight: "40px"}],
            "5xl": ["48px", {lineHeight: "48px"}],
            "6xl": ["60px", {lineHeight: "60px"}],
        },
        extend: {}, // Customize the theme here if needed
    },
    plugins: [], // Add any Tailwind plugins here if required
};
