# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The following commands are commonly used in this project:

- **`yarn dev`**: Start the development server.
- **`yarn build`**: Build the project for production.
- **`yarn preview`**: Preview the production build.
- **`yarn typecheck`**: Run TypeScript type checking.
- **`yarn lint`**: Lint files using Biome.
- **`yarn format`**: Format files using Biome.
- **`yarn fix`**: Auto-fix linting issues using Biome.
- **`yarn validate`**: Run both type checking and linting.

## High-level Architecture

This is a web application for managing sport stacking tournaments.

### Tech Stack

- **UI Framework**: React
- **UI Components**: Arco Design React
- **State Management**: Jotai
- **Form Handling**: React Hook Form + Zod
- **Routing**: React Router
- **Styling**: Tailwind CSS, SCSS
- **Backend**: Firebase (Firestore, Auth, Hosting)
- **Dev Tools**: Vite, Biome, ESLint, Prettier
- **Type System**: TypeScript

### Project Structure

- **`src/`**: Contains the main source code.
  - **`components/`**: Reusable React components.
  - **`pages/`**: Page components for different routes.
  - **`services/`**: Services for interacting with APIs, primarily Firebase.
  - **`schema/`**: Zod schemas for data validation.
  - **`hooks/`**: Custom React hooks.
  - **`config/`**: Application configuration, including routes in `routes.tsx`.
  - **`types/`**: TypeScript type definitions.
  - **`utils/`**: Utility functions.
- **`functions/`**: Firebase Cloud Functions.
- **`.env`**: Holds Firebase configuration and other environment variables.

### Key Concepts

- **Routing**: The application uses React Router for navigation. The routes are defined in `src/config/routes.tsx`.
- **Data Validation**: Zod is used for schema validation, with schemas defined in `src/schema/`.
- **Styling**: The project uses a combination of Tailwind CSS and SCSS for styling.
- **Firebase Integration**: The application relies heavily on Firebase for backend services like authentication, database, and hosting. The Firebase services are abstracted in the `src/services/` directory.
- **TypeScript Usage**: The project follows specific TypeScript best practices, detailed in `TYPESCRIPT.md`. All new files should be in TypeScript (`.ts` or `.tsx`).

### Firebase Functions

The project uses Firebase Cloud Functions located in the `functions/` directory. To deploy them, `cd functions`, then run `yarn build` and `yarn deploy`.
