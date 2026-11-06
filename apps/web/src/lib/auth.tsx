import type { AuthResponse, Me } from "@offgrid/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiFailure, refreshSession, setAccessToken } from "./api";

type Status = "loading" | "guest" | "authed";

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  birthYear: number;
  acceptTerms: boolean;
  confirmAdult: boolean;
}

interface AuthValue {
  status: Status;
  me: Me | null;
  /** True when the last attempt to reach the server failed (offline or server down). */
  serverDown: boolean;
  login(email: string, password: string): Promise<void>;
  signup(input: SignupInput): Promise<void>;
  logout(): Promise<void>;
  setMe(me: Me): void;
  reload(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMeState] = useState<Me | null>(null);
  const [serverDown, setServerDown] = useState(false);

  const accept = (res: AuthResponse) => {
    setAccessToken(res.accessToken);
    setMeState(res.me);
    setStatus("authed");
    setServerDown(false);
  };

  // Restore the session from the refresh cookie on load.
  const reload = useCallback(async () => {
    try {
      const res = await refreshSession();
      if (res) accept(res);
      else {
        setMeState(null);
        setStatus("guest");
      }
      setServerDown(false);
    } catch (e) {
      setServerDown(e instanceof ApiFailure && e.status === 0);
      setStatus("guest");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      serverDown,
      async login(email, password) {
        accept(await api<AuthResponse>("/auth/login", { method: "POST", body: { email, password } }));
      },
      async signup(input) {
        accept(await api<AuthResponse>("/auth/signup", { method: "POST", body: input }));
      },
      async logout() {
        await api("/auth/logout", { method: "POST" }).catch(() => undefined);
        setAccessToken(null);
        setMeState(null);
        setStatus("guest");
      },
      setMe: setMeState,
      reload,
    }),
    [status, me, serverDown, reload],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
