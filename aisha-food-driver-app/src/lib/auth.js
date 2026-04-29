import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchDriverProfile,
  loginDriver,
  registerDriverPushToken,
} from "./driverApi";
import { registerForDriverPushToken } from "./offerNotifications";
import {
  clearAuthSession,
  getAuthSession,
  saveAuthSession,
  subscribeAuthSession,
} from "./tokenStorage";

const AuthContext = createContext(null);

function normalizeSession(session) {
  if (!session || typeof session !== "object") return null;

  const accessToken = String(session.accessToken || "").trim();
  if (!accessToken) return null;

  return {
    accessToken,
    refreshToken: String(session.refreshToken || "").trim() || null,
    driver: session.driver && typeof session.driver === "object" ? session.driver : null,
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const storedSession = await getAuthSession();
        if (!mounted) return;
        setSession(normalizeSession(storedSession));
      } finally {
        if (mounted) {
          setRestoring(false);
        }
      }
    }

    restoreSession().catch(() => {
      if (mounted) {
        setRestoring(false);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return subscribeAuthSession((nextSession) => {
      setSession(normalizeSession(nextSession));
    });
  }, []);

  useEffect(() => {
    let mounted = true;

    async function syncPushToken() {
      if (!session?.accessToken) return;
      const pushToken = await registerForDriverPushToken();
      if (!mounted || !pushToken) return;
      await registerDriverPushToken(pushToken).catch(() => null);
    }

    syncPushToken().catch(() => null);

    return () => {
      mounted = false;
    };
  }, [session?.accessToken]);

  const signIn = useCallback(async (credentials) => {
    const nextSession = normalizeSession(await loginDriver(credentials));
    await saveAuthSession(nextSession);
    setSession(nextSession);
    return nextSession;
  }, []);

  const refreshProfile = useCallback(async () => {
    let profile = null;
    try {
      profile = await fetchDriverProfile();
    } catch (requestError) {
      if (requestError?.status === 401) {
        await clearAuthSession();
        setSession(null);
      }
      throw requestError;
    }

    setSession((currentSession) => {
      const nextSession = normalizeSession({
        ...currentSession,
        driver: profile && typeof profile === "object" ? profile : currentSession?.driver || null,
      });

      saveAuthSession(nextSession).catch(() => null);
      return nextSession;
    });

    return profile;
  }, []);

  const signOut = useCallback(async () => {
    await clearAuthSession();
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      driver: session?.driver || null,
      accessToken: session?.accessToken || "",
      restoring,
      isAuthenticated: Boolean(session?.accessToken),
      signIn,
      signOut,
      refreshProfile,
    }),
    [refreshProfile, restoring, session, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return value;
}
