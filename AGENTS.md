# Repository Guidelines

## Project Structure & Module Organization
The Vite + React client lives in `src/`. Route views sit in `src/pages`, shared UI in `src/components` (layouts under `components/layout`), and cross-cutting logic in `src/context`, `src/hooks`, and `src/utils`. API and Firebase helpers stay in `src/services`, static media in `src/assets`, and validation schemas in `src/schema`. Use `public/` for static deploy assets. Firebase Cloud Functions code resides under `functions/src` and compiles to `functions/lib`; treat that workspace as the backend.

## Build, Test, and Development Commands
Run `yarn dev` to launch the Vite dev server and `yarn build` to emit the production bundle in `dist/`. Validate locally with `yarn preview`. Type safety and linting run via `yarn typecheck`, `yarn lint`, or the combined `yarn validate`. Apply formatting fixes with `yarn format`. Cloud Functions build with `yarn workspace functions build`, emulate with `yarn workspace functions serve`, and deploy with `yarn workspace functions deploy`.

## Coding Style & Naming Conventions
All code is TypeScript. Prefer arrow-based React components, PascalCase component/page names, camelCase hooks and utilities, and SCREAMING_SNAKE_CASE constants. Indent with four spaces. Biome (`biome.json`) enforces quote style and import ordering; run `yarn format` before committing. Keep SCSS in `global.scss` and use module-scoped class names or Tailwind utilities consistently.

## Testing Guidelines
Until a broader suite exists, rely on `yarn validate` and targeted manual QA. Add React Testing Library coverage under `src/__tests__`, naming files `ComponentName.test.tsx`. For Firebase functions, exercise changes with `yarn workspace functions serve` and confirm emulator logs before deploy.

## Commit & Pull Request Guidelines
Follow Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`) with imperative summaries under 72 characters. Each PR should link its tracking issue, describe user-facing changes, and attach screenshots or recordings for UI updates. Confirm `yarn validate` passes and note any manual testing performed.

## UI Implementation Notes
When extending competitive scoring flows, collect and confirm final scores through a modal interaction that mirrors `src/pages/Tournaments/Scoring/ScoringPage.tsx` for consistency.
