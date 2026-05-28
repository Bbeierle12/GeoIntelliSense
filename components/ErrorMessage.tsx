import React from 'react';
import { DataServiceError, ErrorCode } from '../utils/errorHandling';

interface ErrorMessageProps {
  error: DataServiceError | Error | string;
  onRetry?: () => void;
  className?: string;
}

/**
 * User-friendly error message component
 */
export const ErrorMessage: React.FC<ErrorMessageProps> = ({ 
  error, 
  onRetry,
  className = '' 
}) => {
  const getMessage = (): string => {
    if (typeof error === 'string') {
      return error;
    }
    
    if (error instanceof DataServiceError) {
      return error.getUserMessage();
    }
    
    return error.message || 'An unexpected error occurred. Please try again.';
  };

  const isRetryable = (): boolean => {
    if (typeof error === 'string') {
      return false;
    }
    
    if (error instanceof DataServiceError) {
      return error.retryable;
    }
    
    return false;
  };

  const getIcon = (): React.ReactNode => {
    let iconPath = 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z';
    
    if (error instanceof DataServiceError) {
      switch (error.code) {
        case ErrorCode.NETWORK_ERROR:
          iconPath = 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0';
          break;
        case ErrorCode.TIMEOUT:
          iconPath = 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z';
          break;
        case ErrorCode.SERVER_ERROR:
          iconPath = 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01';
          break;
        case ErrorCode.DATA_NOT_FOUND:
          iconPath = 'M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
          break;
      }
    }

    return (
      <svg 
        className="w-5 h-5 flex-shrink-0" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={iconPath} />
      </svg>
    );
  };

  return (
    <div 
      className={`bg-red-900/20 border border-red-500/50 rounded-lg p-4 ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <div className="text-red-400 mt-0.5">
          {getIcon()}
        </div>
        <div className="flex-1">
          <h3 className="text-red-400 font-semibold">Error</h3>
          <p className="text-red-300 mt-1">{getMessage()}</p>
          {(isRetryable() && onRetry) && (
            <button
              onClick={onRetry}
              className="mt-3 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-brand-bg-dark"
              aria-label="Try again"
            >
              Try Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

/**
 * Warning message component for non-critical issues
 */
export const WarningMessage: React.FC<{
  message: string;
  className?: string;
}> = ({ message, className = '' }) => (
  <div 
    className={`bg-yellow-900/30 border border-yellow-700/50 text-yellow-200 p-4 rounded-lg flex items-start gap-3 ${className}`}
    role="alert"
    aria-live="polite"
  >
    <svg 
      className="w-5 h-5 mt-0.5 flex-shrink-0" 
      fill="currentColor" 
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path 
        fillRule="evenodd" 
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" 
        clipRule="evenodd" 
      />
    </svg>
    <p>{message}</p>
  </div>
);

/**
 * Info message component for informational notices
 */
export const InfoMessage: React.FC<{
  title?: string;
  message: string;
  className?: string;
}> = ({ title, message, className = '' }) => (
  <div 
    className={`bg-blue-900/30 border border-blue-700/50 text-blue-200 p-4 rounded-lg flex items-start gap-3 ${className}`}
    role="status"
    aria-live="polite"
  >
    <svg 
      className="w-5 h-5 mt-0.5 flex-shrink-0" 
      fill="currentColor" 
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path 
        fillRule="evenodd" 
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" 
        clipRule="evenodd" 
      />
    </svg>
    <div>
      {title && <p className="font-semibold">{title}</p>}
      <p className={title ? 'text-sm mt-1' : ''}>{message}</p>
    </div>
  </div>
);

/**
 * Success message component
 */
export const SuccessMessage: React.FC<{
  message: string;
  className?: string;
}> = ({ message, className = '' }) => (
  <div 
    className={`bg-green-900/30 border border-green-700/50 text-green-200 p-4 rounded-lg flex items-start gap-3 ${className}`}
    role="status"
    aria-live="polite"
  >
    <svg 
      className="w-5 h-5 mt-0.5 flex-shrink-0" 
      fill="currentColor" 
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path 
        fillRule="evenodd" 
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" 
        clipRule="evenodd" 
      />
    </svg>
    <p>{message}</p>
  </div>
);

/**
 * Empty state component when no data is available
 */
export const EmptyState: React.FC<{
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  icon?: React.ReactNode;
}> = ({ title, description, action, icon }) => (
  <div 
    className="flex flex-col items-center justify-center p-8 text-center"
    role="status"
  >
    {icon || (
      <svg 
        className="w-16 h-16 text-slate-500 mb-4" 
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor"
        aria-hidden="true"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={1.5} 
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" 
        />
      </svg>
    )}
    <h3 className="text-lg font-semibold text-slate-300 mb-1">{title}</h3>
    {description && (
      <p className="text-slate-400 text-sm max-w-sm">{description}</p>
    )}
    {action && (
      <button
        onClick={action.onClick}
        className="mt-4 px-4 py-2 bg-brand-primary hover:bg-brand-primary/80 text-white font-semibold rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-brand-primary focus:ring-offset-2 focus:ring-offset-brand-bg-dark"
      >
        {action.label}
      </button>
    )}
  </div>
);

export default ErrorMessage;
