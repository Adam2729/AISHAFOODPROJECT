import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";

export function useFocusedPolling(
  callback,
  { intervalMs = 30000, enabled = true, runImmediately = false } = {}
) {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;

      let mounted = true;
      let inFlight = false;

      async function run() {
        if (!mounted || inFlight || AppState.currentState !== "active") return;
        inFlight = true;
        try {
          await callbackRef.current?.();
        } finally {
          inFlight = false;
        }
      }

      if (runImmediately) {
        run().catch(() => null);
      }

      const timer = setInterval(() => {
        run().catch(() => null);
      }, Math.max(2000, Number(intervalMs || 30000)));
      const appStateSubscription = AppState.addEventListener("change", (state) => {
        if (state === "active") {
          run().catch(() => null);
        }
      });

      return () => {
        mounted = false;
        clearInterval(timer);
        appStateSubscription?.remove?.();
      };
    }, [enabled, intervalMs, runImmediately])
  );
}
