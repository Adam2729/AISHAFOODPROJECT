import { AppState } from "react-native";
import * as Speech from "expo-speech";

import { audioConfig } from "../config/audioConfig";

const REPEAT_WINDOW_MS = 5000;

let appState = AppState.currentState;
let appStateSubscription = null;
const lastSpokenAt = new Map();

function ensureAppStateSubscription() {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener("change", (nextState) => {
    appState = nextState;
    if (nextState !== "active") {
      stopSpeech();
    }
  });
}

function normalizeSpeechText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function initializeVoiceManager() {
  ensureAppStateSubscription();
  return true;
}

export function stopSpeech() {
  try {
    Speech.stop();
    return true;
  } catch {
    return false;
  }
}

export function speak(text) {
  const safeText = normalizeSpeechText(text);
  if (!audioConfig.enableVoice || !safeText || appState !== "active") {
    return false;
  }

  ensureAppStateSubscription();

  const speechKey = safeText.toLowerCase();
  const now = Date.now();
  const previousSpeechAt = Number(lastSpokenAt.get(speechKey) || 0);
  if (now - previousSpeechAt < REPEAT_WINDOW_MS) {
    return false;
  }

  lastSpokenAt.set(speechKey, now);

  try {
    Speech.stop();
    Speech.speak(safeText, {
      rate: 0.97,
      pitch: 1,
      onError: () => null,
    });
    return true;
  } catch {
    return false;
  }
}

export function cleanupVoiceManager() {
  stopSpeech();
  lastSpokenAt.clear();
  appStateSubscription?.remove?.();
  appStateSubscription = null;
  return true;
}
