import { createContext, useContext } from 'react';
import type { AuthUser } from '../types';

// The Provider component lives in ./AuthProvider so this file exports only the
// hook and context object (react-refresh can't hot-swap a module that mixes a
// component with a hook, and the hook is the widely imported half).

export interface AuthContextValue {
  user:       AuthUser | null;
  loading:    boolean;
  authError:  string | null;
  signIn:     () => void;
  signOut:    () => Promise<void>;
  clearError: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
