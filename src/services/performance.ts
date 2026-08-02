import {type FirebasePerformance, type PerformanceTrace, getPerformance, trace} from "firebase/performance";
import {app} from "./firebase/config";
import {captureClientError} from "./observability";

let performancePromise: Promise<FirebasePerformance | null> | null = null;

const stopTraceSafely = (currentTrace: PerformanceTrace | null): void => {
    try {
        currentTrace?.stop();
    } catch {
        // Performance monitoring must never affect the user operation.
    }
};

const getPerformanceIfSupported = (): Promise<FirebasePerformance | null> => {
    performancePromise ??= Promise.resolve()
        .then(() => (typeof window === "undefined" ? null : getPerformance(app)))
        .catch(() => null);
    return performancePromise;
};

export const initializePerformance = (): void => {
    void getPerformanceIfSupported();
};

export const measureOperation = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
    try {
        const performance = await getPerformanceIfSupported();
        if (!performance) return await operation();

        let currentTrace: PerformanceTrace | null = null;
        try {
            currentTrace = trace(performance, name);
            currentTrace.start();
        } catch {
            try {
                currentTrace?.stop();
            } catch {
                // Performance monitoring must never affect the user operation.
            }
            currentTrace = null;
        }

        try {
            return await operation();
        } finally {
            stopTraceSafely(currentTrace);
        }
    } catch (error) {
        void captureClientError(error, {entityType: "performance-operation", entityId: name});
        throw error;
    }
};

export const measureOperationWithMetric = async <T>(
    name: string,
    metricName: string,
    metricValue: number,
    operation: () => Promise<T>,
): Promise<T> => {
    try {
        const performance = await getPerformanceIfSupported();
        if (!performance) return await operation();

        let currentTrace: PerformanceTrace | null = null;
        try {
            currentTrace = trace(performance, name);
            currentTrace.start();
            currentTrace.putMetric(metricName, Math.max(0, Math.round(metricValue)));
        } catch {
            try {
                currentTrace?.stop();
            } catch {
                // Performance monitoring must never affect the user operation.
            }
            currentTrace = null;
        }

        try {
            return await operation();
        } finally {
            stopTraceSafely(currentTrace);
        }
    } catch (error) {
        void captureClientError(error, {entityType: "performance-operation", entityId: name});
        throw error;
    }
};

export const measureSyncOperation = <T>(name: string, operation: () => T): T => {
    if (typeof window === "undefined" || typeof window.performance?.mark !== "function") {
        try {
            return operation();
        } catch (error) {
            void captureClientError(error, {entityType: "performance-operation", entityId: name});
            throw error;
        }
    }
    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 80);
    const start = `${safeName}-start-${Date.now()}`;
    const end = `${safeName}-end-${Date.now()}`;
    let firebaseTrace: PerformanceTrace | null = null;
    try {
        try {
            firebaseTrace = trace(getPerformance(app), safeName);
            firebaseTrace.start();
        } catch {
            firebaseTrace = null;
        }
        window.performance.mark(start);
        return operation();
    } catch (error) {
        void captureClientError(error, {entityType: "performance-operation", entityId: name});
        throw error;
    } finally {
        try {
            window.performance.mark(end);
            window.performance.measure(safeName, start, end);
        } catch {
            // Performance monitoring must never affect the user operation.
        }
        try {
            firebaseTrace?.stop();
        } catch {
            // Performance monitoring must never affect the user operation.
        }
    }
};
