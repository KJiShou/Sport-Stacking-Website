# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

The following commands are commonly used in this project:

- **`yarn dev`**: Start the development server on port 5000.
- **`yarn build`**: Build the project for production.
- **`yarn preview`**: Preview the production build.
- **`yarn typecheck`**: Run TypeScript type checking.
- **`yarn check`**: Run Biome checks without auto-fixing.
- **`yarn lint`**: Run Biome linting.
- **`yarn format`**: Format files using Biome.
- **`yarn fix`**: Auto-fix linting issues using Biome.
- **`yarn validate`**: Run both type checking and linting.
- **`yarn setup`**: Run install script and install dependencies.

### Firebase Functions Commands

From the `functions/` directory:

- **`yarn build`**: Build TypeScript in functions/
- **`yarn serve`**: Run Firebase Functions emulator
- **`yarn deploy`**: Deploy functions to Firebase

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
- **`functions/`**: Firebase Cloud Functions (Node.js backend).
- **`config/` subdirectories**: Biome, ESLint, Firebase hosting, PostCSS, Prettier, Tailwind, and Vite configurations are organized under `/config/`.
- **`.env`**: Holds Firebase configuration and other environment variables.

### Key Concepts

- **Routing**: The application uses React Router for navigation. The routes are defined in `src/config/routes.tsx`.
- **Data Validation**: Zod is used for schema validation, with schemas defined in `src/schema/`.
- **Styling**: The project uses a combination of Tailwind CSS and SCSS for styling.
- **Firebase Integration**: The application relies heavily on Firebase for backend services like authentication, database, and hosting. The Firebase services are abstracted in the `src/services/` directory.
- **TypeScript Usage**: The project follows specific TypeScript best practices, detailed in `TYPESCRIPT.md`. All new files should be in TypeScript (`.ts` or `.tsx`).

### Firebase Functions

The project uses Firebase Cloud Functions located in the `functions/` directory. It uses yarn workspaces, so dependencies are managed from the root.

**Key Function**: `sendEmail` - Sends verification emails to tournament participants with automatic failover:
- **Primary**: Resend API
- **Backup**: AWS SES (automatically triggered if Resend fails)

Secrets required via Firebase Secrets Manager: `RESEND_API_KEY`, `AWS_SES_SMTP_USERNAME`, `AWS_SES_SMTP_PASSWORD`

To deploy: `cd functions && yarn deploy`

# important-instruction-reminders
Do what has been asked; nothing more, nothing less.
NEVER create files unless they're absolutely necessary for achieving your goal.
ALWAYS prefer editing an existing file to creating a new one.
NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.