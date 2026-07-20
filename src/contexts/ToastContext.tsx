import { createContext, useContext } from 'react';

// The Provider component lives in ./ToastProvider so this file exports only the
// hook, context object, and type — Fast Refresh (react-refresh) can't hot-swap a
// module that exports both a component and a hook, and the hook is the widely
// imported half, so it stays put and the Provider moves out.

export type ToastType = 'success' | 'error' | 'info';

export interface ToastContextValue {
  addToast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
