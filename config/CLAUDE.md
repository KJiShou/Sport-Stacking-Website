[Root Directory](../CLAUDE.md) > **Configuration Module**

---

# Configuration Module

**Path**: `config/`

**Responsibility**: Centralized tooling configuration for the project. Exports and documents all build, linting, styling, and framework configs.

---

## Directory Structure

```
config/
├── index.js              # Barrel re-export of all configs
├── biome/
│   └── biome.json        # Biome (linter + formatter) config
├── eslint/
│   └── eslint.config.js  # ESLint flat config (React + TypeScript)
├── firebase/
│   └── firebase.json     # Firebase CLI config (hosting, functions, emulators)
├── postcss/
│   └── postcss.config.js # PostCSS config (for Tailwind)
├── prettier/
│   └── prettier.config.js # Prettier config
├── tailwind/
│   └── tailwind.config.js # Tailwind CSS config
└── vite/
    └── vite.config.js    # Vite bundler config
```

---

## Tooling Summary

| Tool | Config File | Purpose |
|------|-------------|---------|
| **Biome** | `biome/biome.json` | Fast linter + formatter (1.9.3). Ignores `.turbo`, `.next`, `node_modules`, `build`, `public/sw.js`. Schema from `biomejs.dev`. |
| **ESLint** | `eslint/eslint.config.js` | Flat config. React plugin + React Hooks + React Refresh. Ignores `dist`. |
| **Prettier** | `prettier/prettier.config.js` | Code formatter. |
| **Tailwind CSS** | `tailwind/tailwind.config.js` | Content: `index.html` + `./src/**/*.{js,ts,jsx,tsx}`. Empty `extend` block (custom theme goes here). |
| **PostCSS** | `postcss/postcss.config.js` | Processes Tailwind CSS. |
| **Vite** | `vite/vite.config.js` | Frontend bundler (React + TypeScript). Port 5000 in dev. |
| **Firebase** | `firebase/firebase.json` | Firebase CLI config for hosting, functions, and emulator settings. |

---

## Barrel Re-export (`index.js`)

Exports all configs for programmatic use (e.g., IDE plugins, testing setups):

```javascript
import { viteConfig } from "./config/vite/vite.config.js";
import { tailwindConfig } from "./config/tailwind/tailwind.config.js";
import { postcssConfig } from "./config/postcss/postcss.config.js";
import { eslintConfig } from "./config/eslint/eslint.config.js";
import { prettierConfig } from "./config/prettier/prettier.config.js";
```

---

## Recommended Dev Commands

```bash
yarn dev          # Vite dev server (port 5000)
yarn build        # Vite production build -> dist/
yarn check        # Biome lint check only
yarn lint         # Biome lint
yarn format       # Biome format
yarn fix          # Biome auto-fix
yarn validate     # typecheck + lint
yarn typecheck    # tsc --noEmit
```

---

## Related Files

- Root `package.json` -- yarn scripts, dependencies
- `firestore.rules` -- Firestore security rules
- `firestore.indexes.json` -- Firestore composite indexes
- `src/main.tsx` -- Vite entry point
- `src/App.tsx` -- React root

---

## Change Log (Changelog)

| Date | Change |
|------|--------|
| 2026-04-10 09:10 | Module documented. All 7 config directories documented, tooling summary, barrel re-export pattern, recommended dev commands. |
