import { AppState, Platform } from "react-native";
import { useEffect, useRef } from "react";

let warnedUnavailable = false;

function warnKeepAwake(error) {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  const detail = error instanceof Error ? error.message : String(error || "");
  console.warn("Keep awake unavailable", detail);
}

export function useSafeKeepAwake(enabled, tag = "oranjeeats-customer") {
  const activeRef = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") {
      return undefined;
    }

    let disposed = false;
    let keepAwakeModule = null;

    async function deactivate() {
      if (!activeRef.current || !keepAwakeModule?.deactivateKeepAwake) return;
      try {
        keepAwakeModule.deactivateKeepAwake(tag);
      } catch (error) {
        warnKeepAwake(error);
      } finally {
        activeRef.current = false;
      }
    }

    async function activate() {
      if (!enabled || AppState.currentState !== "active") {
        await deactivate();
        return;
      }
      if (activeRef.current) return;

      try {
        keepAwakeModule = await import("expo-keep-awake");
        if (disposed || !enabled || AppState.currentState !== "active") {
          return;
        }
        if (typeof keepAwakeModule.activateKeepAwake === "function") {
          keepAwakeModule.activateKeepAwake(tag);
          activeRef.current = true;
        }
      } catch (error) {
        warnKeepAwake(error);
      }
    }

    activate().catch(() => null);

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        activate().catch(() => null);
      } else {
        deactivate().catch(() => null);
      }
    });

    return () => {
      disposed = true;
      subscription.remove();
      deactivate().catch(() => null);
    };
  }, [enabled, tag]);
}
