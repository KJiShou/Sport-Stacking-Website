import {type FirebasePerformance, type PerformanceTrace, getPerformance, trace} from "firebase/performance";
import {app} from "./firebase/config";
import {type ClientErrorContext, captureClientError} from "./observability";

let performancePromise: Promise<FirebasePerformance | null> | null = null;
let measurementSequence = 0;

export type PerformanceErrorContext = Pick<
    ClientErrorContext,
    "activeProfileGlobalId" | "route" | "tournamentId" | "entityType" | "entityId"
>;

const reportOperationError = (error: unknown, name: string, context: PerformanceErrorContext): void => {
    void captureClientError(error, {
        entityType: "performance-operation",
        entityId: name,
        ...context,
    });
};

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

export const measureOperation = async <T>(
    name: string,
    operation: () => Promise<T>,
    errorContext: PerformanceErrorContext = {},
): Promise<T> => {
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
        reportOperationError(error, name, errorContext);
        throw error;
    }
};

export const measureOperationWithMetric = async <T>(
    name: string,
    metricName: string,
    metricValue: number,
    operation: () => Promise<T>,
    errorContext: PerformanceErrorContext = {},
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
        reportOperationError(error, name, errorContext);
        throw error;
    }
};

export const measureSyncOperation = <T>(name: string, operation: () => T, errorContext: PerformanceErrorContext = {}): T => {
    if (typeof window === "undefined" || typeof window.performance?.mark !== "function") {
        try {
            return operation();
        } catch (error) {
            reportOperationError(error, name, errorContext);
            throw error;
        }
    }
    const safeName = name.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 80);
    const measurementName = `${safeName}-${Date.now()}-${measurementSequence++}`;
    const start = `${measurementName}-start`;
    const end = `${measurementName}-end`;
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
        reportOperationError(error, name, errorContext);
        throw error;
    } finally {
        try {
            window.performance.mark(end);
            window.performance.measure(measurementName, start, end);
        } catch {
            // Performance monitoring must never affect the user operation.
        } finally {
            try {
                window.performance.clearMarks(start);
                window.performance.clearMarks(end);
                window.performance.clearMeasures(measurementName);
            } catch {
                // Performance monitoring must never affect the user operation.
            }
        }
        try {
            firebaseTrace?.stop();
        } catch {
            // Performance monitoring must never affect the user operation.
        }
    }
};
