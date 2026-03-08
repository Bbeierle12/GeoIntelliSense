import React from 'react';

interface WidgetShellProps {
  title: string;
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  children: React.ReactNode;
  className?: string;
  onRetry?: () => void;
}

export const WidgetShell: React.FC<WidgetShellProps> = ({
  title,
  loading,
  error,
  lastUpdated,
  children,
  className = '',
  onRetry,
}) => {
  if (loading && !error) {
    return (
      <div className={`bg-brand-bg-light rounded-lg shadow-lg p-5 animate-pulse ${className}`}>
        <div className="h-5 bg-slate-700 rounded w-1/2 mb-4" />
        <div className="h-32 bg-slate-700/60 rounded" />
      </div>
    );
  }

  return (
    <div className={`bg-brand-bg-light rounded-lg shadow-lg p-5 flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold text-slate-200 truncate">{title}</h3>
        {lastUpdated && (
          <span className="text-[10px] text-slate-500 flex-shrink-0 ml-2">
            {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      {error ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
          <p className="text-sm text-slate-500 mb-2">{error}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-xs text-brand-primary hover:text-brand-primary/80 underline"
            >
              Retry
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">{children}</div>
      )}
    </div>
  );
};
