import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

class ErrorBoundary extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorInfo: null
        };
    }

    static getDerivedStateFromError(error: Error): Partial<State> {
        // Update state so the next render will show the fallback UI
        return { hasError: true };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log error details to console
        console.error('Error caught by ErrorBoundary:', error, errorInfo);

        // Update state with error details
        this.setState({
            error,
            errorInfo
        });

        // In production, you would send this to an error tracking service
        // Example: Sentry.captureException(error, { extra: errorInfo });
    }

    handleReset = (): void => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null
        });
    };

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-brand-bg-dark flex items-center justify-center p-4">
                    <div className="max-w-2xl w-full bg-brand-bg-light rounded-lg shadow-xl p-8 border border-red-900">
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg
                                    className="w-8 h-8 text-red-500"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                                    />
                                </svg>
                            </div>
                            <h1 className="text-2xl font-bold text-slate-100 mb-2">
                                Something went wrong
                            </h1>
                            <p className="text-slate-400">
                                An unexpected error occurred in the application. Please try refreshing the page.
                            </p>
                        </div>

                        <div className="space-y-4">
                            <button
                                onClick={this.handleReset}
                                className="w-full py-3 bg-brand-primary text-white font-semibold rounded-md hover:bg-sky-600 transition-colors"
                            >
                                Try Again
                            </button>

                            <button
                                onClick={() => window.location.reload()}
                                className="w-full py-3 bg-brand-bg-dark text-slate-300 font-semibold rounded-md hover:bg-brand-bg-lighter transition-colors border border-brand-secondary"
                            >
                                Refresh Page
                            </button>
                        </div>

                        {/* Show error details in development */}
                        {process.env.NODE_ENV === 'development' && this.state.error && (
                            <details className="mt-6">
                                <summary className="cursor-pointer text-slate-400 hover:text-slate-300 text-sm font-medium">
                                    Error Details (Development Only)
                                </summary>
                                <div className="mt-4 p-4 bg-brand-bg-dark rounded-md border border-red-900/50">
                                    <h3 className="font-semibold text-red-400 mb-2">
                                        {this.state.error.toString()}
                                    </h3>
                                    {this.state.errorInfo && (
                                        <pre className="text-xs text-slate-400 overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                                            {this.state.errorInfo.componentStack}
                                        </pre>
                                    )}
                                </div>
                            </details>
                        )}
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
