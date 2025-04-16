module.exports = {
    env: {
        browser: true,
        es2021: true,
    },
    extends: [
        "eslint:recommended", // ESLint Recommended Rules
        "plugin:react/recommended", // React-specific rules
        "plugin:react-hooks/recommended", // React Hooks rules
        "prettier", // Disables ESLint rules that conflict with Prettier
    ],
    parserOptions: {
        ecmaFeatures: {
            jsx: true,
            tsx: true, // Enable TypeScript support
        },
        ecmaVersion: 12,
        sourceType: "module",
    },
    plugins: ["react", "prettier"],
    rules: {
        "prettier/prettier": "error", // Ensures Prettier rules are enforced
        "react/prop-types": "off", // Disables PropTypes checking (optional)
    },
    settings: {
        react: {
            version: "detect",
        },
    },
};
