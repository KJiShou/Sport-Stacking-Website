module.exports = {
    root: true,
    env: {
        browser: true,
        es2021: true,
    },
    extends: ["eslint:recommended", "plugin:react/recommended", "plugin:@typescript-eslint/recommended", "prettier"],
    parser: "@typescript-eslint/parser",
    plugins: ["react", "@typescript-eslint"],
    rules: {
        // 基础安全性、正确性
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": ["warn", {argsIgnorePattern: "^_"}],
        "no-console": "warn",
        "no-self-assign": "error",
        "no-dupe-keys": "error",
        "no-duplicate-case": "error",
        "no-fallthrough": "warn",
        "no-unreachable": "error",
        "no-unsafe-optional-chaining": "warn",

        // 类型安全性
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-non-null-assertion": "warn",
        "@typescript-eslint/consistent-type-imports": "warn",

        // react 相关
        "react/prop-types": "off",
        "react/react-in-jsx-scope": "off",
        "react/self-closing-comp": "warn",
        "react/jsx-key": "warn",

        // jsx-a11y 访问性 (模仿 biome a11y 部分)
        "jsx-a11y/anchor-is-valid": "warn",
        "jsx-a11y/alt-text": "warn",
        "jsx-a11y/no-autofocus": "warn",
        "jsx-a11y/no-redundant-roles": "error",
        "jsx-a11y/aria-role": "error",
        "jsx-a11y/no-distracting-elements": "error",
        "jsx-a11y/no-noninteractive-tabindex": "error",
        "jsx-a11y/no-positive-tabindex": "error",

        // import 整理
        "import/order": [
            "warn",
            {
                groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
                "newlines-between": "always",
            },
        ],

        // 移除未使用 import
        "unused-imports/no-unused-imports": "warn",

        // prettier 规则整合
        "prettier/prettier": "error",
    },
};
