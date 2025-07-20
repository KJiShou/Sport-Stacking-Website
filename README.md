# 🥇 Sport Stacking Website

A modern web application for managing sport stacking tournaments, built with **React**, **Firebase**, **TailwindCSS**, and **TypeScript**.

## ✨ Features

*   **Tournament Management**: Create, manage, and view tournaments.
*   **Participant Registration**: Register participants for tournaments.
*   **Athlete Profiles**: View and manage athlete information.
*   **Record Tracking**: Keep track of records for different sport stacking disciplines (3-3-3, 3-6-3, Cycle, Doubles).
*   **User Authentication**: Secure user registration and login.
*   **Admin Dashboard**: Manage users and site settings.
*   **Responsive Design**: Fully responsive layout for all devices.

---

## 🚀 Tech Stack

| Category | Technology |
| --- | --- |
| **UI Framework** | [React](https://reactjs.org/) |
| **UI Components** | [Arco Design React](https://arco.design/) |
| **State Management** | [Jotai](https://jotai.org/) |
| **Form Handling** | [React Hook Form](https://react-hook-form.com/) + [Zod](https://zod.dev/) |
| **Routing** | [React Router](https://reactrouter.com/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/), SCSS |
| **Backend** | [Firebase](https://firebase.google.com/) (Firestore, Auth, Hosting) |
| **Dev Tools** | [Vite](https://vitejs.dev/), [Biome](https://biomejs.dev/), ESLint, Prettier |
| **Type System** | [TypeScript](https://www.typescriptlang.org/) |

---

## 📦 Available Scripts

| Script | Description |
| --- | --- |
| `yarn dev` | Start the development server |
| `yarn build` | Build the project for production |
| `yarn preview` | Preview the production build |
| `yarn typecheck` | Run TypeScript type checking |
| `yarn lint` | Lint files using Biome |
| `yarn format` | Format files using Biome |
| `yarn fix` | Auto-fix linting issues using Biome |
| `yarn validate` | Run both type checking and linting |

---

## 🏁 Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or higher)
*   [Yarn](https://yarnpkg.com/)
*   A [Firebase](https://firebase.google.com/) project

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/KJiShou/Sport-Stacking-Website.git
    cd Sport-Stacking-Website
    ```

2.  **Install dependencies:**
    ```bash
    yarn
    ```

3.  **Set up Firebase:**
    *   Create a `.env` file in the root of the project.
    *   Add your Firebase project configuration to the `.env` file. You can get this from the Firebase console (`Project settings > General > Your apps > Web app`).

    ```
    VITE_API_KEY=your-api-key
    VITE_AUTH_DOMAIN=your-auth-domain
    VITE_PROJECT_ID=your-project-id
    VITE_STORAGE_BUCKET=your-storage-bucket
    VITE_MESSAGING_SENDER_ID=your-messaging-sender-id
    VITE_APP_ID=your-app-id
    ```

4.  **Run the development server:**
    ```bash
    yarn dev
    ```

5. **functions deployment**
   ```bash
   cd functions\
   yarn build
   yarn deploy
   ```

6. **After deploy**
   ```bash
    cd ..
    yarn dev
   ```

---

## 📂 Project Structure

```
/
├── public/             # Static assets
├── src/
│   ├── assets/         # Images, icons, etc.
│   ├── components/     # Reusable React components
│   ├── config/         # Application configuration (e.g., routes)
│   ├── constants/      # Constant values
│   ├── context/        # React context providers
│   ├── hooks/          # Custom React hooks
│   ├── pages/          # Page components
│   ├── schema/         # Zod schemas for data validation
│   ├── services/       # Services for interacting with APIs (e.g., Firebase)
│   ├── types/          # TypeScript type definitions
│   └── utils/          # Utility functions
├── firebase.json       # Firebase configuration
└── vite.config.js      # Vite configuration
