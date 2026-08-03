import type {ErrorInfo, ReactNode} from "react";
import {Component} from "react";
import {captureClientError} from "../../services/observability";

type Props = {children: ReactNode};
type State = {hasError: boolean};

export default class ObservabilityErrorBoundary extends Component<Props, State> {
    public state: State = {hasError: false};

    public static getDerivedStateFromError(): State {
        return {hasError: true};
    }

    public componentDidCatch(error: Error, info: ErrorInfo): void {
        void captureClientError(error, {
            entityType: "react",
            entityId: (info.componentStack ?? "").slice(0, 256),
        });
    }

    public render(): ReactNode {
        if (this.state.hasError) {
            return (
                <main className="flex min-h-screen items-center justify-center p-6 text-center">
                    <div>
                        <h1 className="text-xl font-semibold">Something went wrong</h1>
                        <p className="mt-2 text-gray-600">Please refresh the page and try again.</p>
                        <button
                            className="mt-4 rounded bg-blue-600 px-4 py-2 text-white"
                            onClick={() => window.location.reload()}
                            type="button"
                        >
                            Refresh
                        </button>
                    </div>
                </main>
            );
        }
        return this.props.children;
    }
}
