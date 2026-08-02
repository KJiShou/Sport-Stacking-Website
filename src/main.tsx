import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import App from "./App";
import ObservabilityErrorBoundary from "./components/common/ObservabilityErrorBoundary";
import {AuthProvider} from "./context/AuthContext";
import {initializeClientErrorHandlers} from "./services/observability";
import {initializePerformance} from "./services/performance";
import "./global.scss";

const rootElement = document.getElementById("root");

if (!rootElement) {
    throw new Error("Failed to find the root element");
}

initializeClientErrorHandlers();
initializePerformance();

createRoot(rootElement).render(
    <StrictMode>
        <ObservabilityErrorBoundary>
            <AuthProvider>
                <App />
            </AuthProvider>
        </ObservabilityErrorBoundary>
    </StrictMode>,
);
