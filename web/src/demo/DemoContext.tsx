import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { accessCode, api, ApiError, setAccessCodeHandler } from '../api/client';
import type { PublicConfig } from '../api/types';

export type Role = 'customer' | 'merchant';

interface DemoState {
  role: Role;
  setRole: (r: Role) => void;
  config: PublicConfig | null;
  configError: string | null;
  reloadConfig: () => void;
  /** True when the server wants a passcode and we have none (or it was rejected). */
  needsCode: boolean;
  submitCode: (code: string) => void;
}

const DemoContext = createContext<DemoState | null>(null);

const readRole = (): Role => {
  try {
    return localStorage.getItem('pesapop.role') === 'merchant' ? 'merchant' : 'customer';
  } catch {
    return 'customer';
  }
};

export function DemoProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(readRole);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [codeRejected, setCodeRejected] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [, setCodeVersion] = useState(0);

  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    try {
      localStorage.setItem('pesapop.role', r);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setConfigError(null);
    api
      .config()
      .then((c) => !cancelled && setConfig(c))
      .catch((e) => !cancelled && setConfigError(e instanceof ApiError ? e.message : 'Cannot reach PesaPop.'));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  useEffect(() => {
    setAccessCodeHandler(() => {
      accessCode.clear();
      setCodeRejected(true);
    });
    return () => setAccessCodeHandler(null);
  }, []);

  const submitCode = useCallback((code: string) => {
    accessCode.set(code.trim());
    setCodeRejected(false);
    setCodeVersion((v) => v + 1);
  }, []);

  const needsCode = codeRejected || (!!config?.access_code_required && !accessCode.get());

  const value = useMemo(
    () => ({ role, setRole, config, configError, reloadConfig: () => setNonce((n) => n + 1), needsCode, submitCode }),
    [role, setRole, config, configError, needsCode, submitCode],
  );
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>;
}

export function useDemo(): DemoState {
  const ctx = useContext(DemoContext);
  if (!ctx) throw new Error('useDemo must be used inside DemoProvider');
  return ctx;
}
