import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} });

export const useToast = () => useContext(ToastContext);

let toastId = 0;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: ToastType = 'info', duration = 5000) => {
    const id = ++toastId;
    setToasts(prev => [...prev.slice(-4), { id, message, type, duration }]); // Max 5 visible
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      {/* Toast container */}
      <div
        className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const STYLES: Record<ToastType, string> = {
  info: 'bg-sky-900/90 border-sky-600 text-sky-100',
  success: 'bg-green-900/90 border-green-600 text-green-100',
  warning: 'bg-yellow-900/90 border-yellow-600 text-yellow-100',
  error: 'bg-red-900/90 border-red-600 text-red-100',
};

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: number) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <div
      className={`px-4 py-3 rounded-lg border shadow-lg text-sm flex items-center gap-3 animate-[slideIn_0.2s_ease-out] ${STYLES[toast.type]}`}
      role="alert"
    >
      <p className="flex-1">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-current opacity-60 hover:opacity-100 focus:outline-none focus:ring-1 focus:ring-current rounded"
        aria-label="Dismiss notification"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
