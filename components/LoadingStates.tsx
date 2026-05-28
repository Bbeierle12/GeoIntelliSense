import React from 'react';

/**
 * Skeleton loader for charts - displays while chart data is loading
 */
export const ChartSkeleton: React.FC<{ height?: number }> = ({ height = 300 }) => (
  <div 
    className="bg-brand-bg-light p-6 rounded-lg shadow-lg animate-pulse"
    role="status"
    aria-label="Loading chart data"
  >
    <div className="h-6 bg-slate-700 rounded w-1/3 mb-4"></div>
    <div 
      className="bg-slate-700 rounded"
      style={{ height: `${height}px` }}
    ></div>
    <span className="sr-only">Loading chart...</span>
  </div>
);

/**
 * Skeleton loader for tables - displays while table data is loading
 */
export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div 
    className="bg-brand-bg-light p-6 rounded-lg shadow-lg animate-pulse"
    role="status"
    aria-label="Loading table data"
  >
    {/* Table header */}
    <div className="h-10 bg-slate-700 rounded mb-4"></div>
    {/* Table rows */}
    <div className="space-y-2">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="h-10 bg-slate-700/70 rounded"></div>
      ))}
    </div>
    <span className="sr-only">Loading table data...</span>
  </div>
);

/**
 * Skeleton loader for cards - displays while card content is loading
 */
export const CardSkeleton: React.FC = () => (
  <div 
    className="bg-brand-bg-light p-6 rounded-lg shadow-lg animate-pulse"
    role="status"
    aria-label="Loading content"
  >
    <div className="flex items-center space-x-4 mb-4">
      <div className="w-12 h-12 bg-slate-700 rounded-full"></div>
      <div className="flex-1">
        <div className="h-4 bg-slate-700 rounded w-3/4 mb-2"></div>
        <div className="h-3 bg-slate-700/70 rounded w-1/2"></div>
      </div>
    </div>
    <div className="space-y-2">
      <div className="h-3 bg-slate-700/60 rounded"></div>
      <div className="h-3 bg-slate-700/60 rounded w-5/6"></div>
    </div>
    <span className="sr-only">Loading content...</span>
  </div>
);

/**
 * Skeleton loader for metric/stat cards
 */
export const MetricSkeleton: React.FC = () => (
  <div 
    className="bg-brand-bg-light p-4 rounded-lg shadow-lg animate-pulse"
    role="status"
    aria-label="Loading metric"
  >
    <div className="h-4 bg-slate-700 rounded w-1/2 mb-3"></div>
    <div className="h-8 bg-slate-700 rounded w-2/3 mb-2"></div>
    <div className="h-3 bg-slate-700/60 rounded w-3/4"></div>
    <span className="sr-only">Loading metric...</span>
  </div>
);

/**
 * Full-page loading screen
 */
export const LoadingScreen: React.FC<{ message?: string }> = ({ 
  message = 'Loading...' 
}) => (
  <div 
    className="fixed inset-0 bg-brand-bg-dark flex items-center justify-center z-50"
    role="status"
    aria-live="polite"
  >
    <div className="text-center">
      {/* Animated spinner */}
      <div className="relative w-16 h-16 mx-auto mb-4">
        <div className="absolute inset-0 border-4 border-brand-primary/30 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-transparent border-t-brand-primary rounded-full animate-spin"></div>
      </div>
      <p className="text-slate-300 font-medium">{message}</p>
    </div>
  </div>
);

/**
 * Inline loading spinner
 */
export const LoadingSpinner: React.FC<{ 
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-3'
  };

  return (
    <div 
      className={`${sizeClasses[size]} border-brand-primary/30 border-t-brand-primary rounded-full animate-spin ${className}`}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
};

/**
 * Loading overlay for sections
 */
export const LoadingOverlay: React.FC<{ 
  isLoading: boolean;
  children: React.ReactNode;
  message?: string;
}> = ({ isLoading, children, message }) => (
  <div className="relative">
    {children}
    {isLoading && (
      <div 
        className="absolute inset-0 bg-brand-bg-dark/80 flex items-center justify-center rounded-lg z-10"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center">
          <LoadingSpinner size="lg" />
          {message && (
            <p className="mt-3 text-slate-300 text-sm">{message}</p>
          )}
        </div>
      </div>
    )}
  </div>
);

/**
 * Skeleton for the sidebar navigation
 */
export const SidebarSkeleton: React.FC = () => (
  <div 
    className="w-64 bg-brand-bg-light p-4 animate-pulse"
    role="status"
    aria-label="Loading navigation"
  >
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center space-x-3">
          <div className="w-6 h-6 bg-slate-700 rounded"></div>
          <div className="h-4 bg-slate-700 rounded flex-1"></div>
        </div>
      ))}
    </div>
    <span className="sr-only">Loading navigation...</span>
  </div>
);

/**
 * Skeleton for dashboard overview section
 */
export const DashboardSkeleton: React.FC = () => (
  <div className="space-y-8 animate-pulse" role="status" aria-label="Loading dashboard">
    {/* Header */}
    <div>
      <div className="h-8 bg-slate-700 rounded w-1/3 mb-2"></div>
      <div className="h-4 bg-slate-700/70 rounded w-2/3"></div>
    </div>
    
    {/* Location selector */}
    <div className="flex gap-2">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-10 bg-slate-700 rounded-full w-24"></div>
      ))}
    </div>
    
    {/* Tab bar */}
    <div className="flex gap-4 border-b border-brand-secondary pb-3">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-6 bg-slate-700 rounded w-20"></div>
      ))}
    </div>
    
    {/* Main content grid */}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <ChartSkeleton />
      <ChartSkeleton />
    </div>
    
    <span className="sr-only">Loading dashboard...</span>
  </div>
);

/**
 * Pulsing dot indicator for loading states
 */
export const PulsingDot: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span 
    className={`inline-block w-2 h-2 bg-brand-primary rounded-full animate-pulse ${className}`}
    aria-hidden="true"
  />
);

/**
 * Loading state for buttons
 */
export const ButtonLoading: React.FC<{
  children: React.ReactNode;
  isLoading: boolean;
  loadingText?: string;
}> = ({ children, isLoading, loadingText = 'Loading...' }) => (
  <>
    {isLoading ? (
      <span className="flex items-center gap-2">
        <LoadingSpinner size="sm" />
        <span>{loadingText}</span>
      </span>
    ) : (
      children
    )}
  </>
);
