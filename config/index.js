/**
 * Project configuration index
 * This file centralizes all configuration exports for easier imports throughout the application
 */

// Export Vite configuration
export {default as viteConfig} from "./vite/vite.config.js";

// Export Tailwind configuration
export {default as tailwindConfig} from "./tailwind/tailwind.config.js";

// Export PostCSS configuration
export {default as postcssConfig} from "./postcss/postcss.config.js";

// Export ESLint configuration
export {default as eslintConfig} from "./eslint/eslint.config.js";

// Export Prettier configuration
export {default as prettierConfig} from "./prettier/prettier.config.js";

// Note: biome.json and firebase.json are referenced directly by their tools
