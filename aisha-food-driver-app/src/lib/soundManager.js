import { AppState } from "react-native";
import {
  Audio,
  InterruptionModeAndroid,
  InterruptionModeIOS,
} from "expo-av";

import { audioConfig } from "../config/audioConfig";

const SOUND_SOURCES = {
  new_order: require("../../assets/sounds/new-order.mp3"),
  accepted: require("../../assets/sounds/accepted.mp3"),
  message: require("../../assets/sounds/message.mp3"),
  delivered: require("../../assets/sounds/delivered.mp3"),
  delivered_success: require("../../assets/sounds/delivered-success.mp3"),
};

const PLAY_DEBOUNCE_MS = 900;

let appState = AppState.currentState;
let appStateSubscription = null;
let initialized = false;
let initializingPromise = null;
let currentSoundType = "";
const soundCache = new Map();
const lastPlayedAt = new Map();

function clampVolume(level) {
  const numericLevel = Number(level);
  if (!Number.isFinite(numericLevel)) return 1;
  if (numericLevel < 0) return 0;
  if (numericLevel > 1) return 1;
  return numericLevel;
}

function shouldPlayAudio() {
  return audioConfig.enableSounds && appState === "active";
}

function ensureAppStateSubscription() {
  if (appStateSubscription) return;
  appStateSubscription = AppState.addEventListener("change", (nextState) => {
    appState = nextState;
    if (nextState !== "active") {
      stopAllSounds().catch(() => null);
    }
  });
}

async function configureAudioMode() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      playsInSilentModeIOS: false,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {
    // Keep the app responsive even if the audio mode cannot be applied.
  }
}

async function resetSound(sound) {
  try {
    const status = await sound.getStatusAsync();
    if (!status?.isLoaded) return;
    if (status.isPlaying) {
      await sound.stopAsync();
    }
    await sound.setPositionAsync(0);
  } catch {
    // Ignore per-sound failures.
  }
}

async function loadSound(type, source) {
  const sound = new Audio.Sound();

  try {
    await sound.loadAsync(source, {
      shouldPlay: false,
      volume: clampVolume(audioConfig.volumeLevel),
      progressUpdateIntervalMillis: 250,
    });
    soundCache.set(type, sound);
  } catch {
    try {
      await sound.unloadAsync();
    } catch {
      // Ignore unload failures for partially loaded sounds.
    }
  }
}

export async function preloadSounds() {
  if (initialized) return true;
  if (initializingPromise) return initializingPromise;

  initializingPromise = (async () => {
    ensureAppStateSubscription();
    await configureAudioMode();
    await Promise.all(
      Object.entries(SOUND_SOURCES).map(([type, source]) => loadSound(type, source))
    );
    initialized = true;
    return true;
  })().catch(() => false);

  return initializingPromise;
}

export async function initializeSoundManager() {
  await preloadSounds();
  return true;
}

export async function stopAllSounds() {
  if (!initialized && !initializingPromise) {
    return false;
  }

  if (!initialized && initializingPromise) {
    await initializingPromise.catch(() => false);
  }

  await Promise.all([...soundCache.values()].map((sound) => resetSound(sound)));
  currentSoundType = "";
  return true;
}

export async function playSound(type) {
  const soundType = String(type || "").trim();
  if (!SOUND_SOURCES[soundType] || !shouldPlayAudio()) {
    return false;
  }

  const now = Date.now();
  const previousPlayAt = Number(lastPlayedAt.get(soundType) || 0);
  if (now - previousPlayAt < PLAY_DEBOUNCE_MS) {
    return false;
  }

  await preloadSounds();
  const sound = soundCache.get(soundType);
  if (!sound) {
    return false;
  }

  lastPlayedAt.set(soundType, now);
  await stopAllSounds();

  try {
    currentSoundType = soundType;
    await sound.setVolumeAsync(clampVolume(audioConfig.volumeLevel));
    await sound.setPositionAsync(0);
    sound.setOnPlaybackStatusUpdate((status) => {
      if (!status?.isLoaded || !status.didJustFinish) return;
      if (currentSoundType === soundType) {
        currentSoundType = "";
      }
      sound.setOnPlaybackStatusUpdate(null);
      sound.setPositionAsync(0).catch(() => null);
    });
    await sound.playAsync();
    return true;
  } catch {
    currentSoundType = "";
    return false;
  }
}

export async function cleanupSoundManager() {
  await stopAllSounds().catch(() => null);
  await Promise.all(
    [...soundCache.values()].map(async (sound) => {
      try {
        await sound.unloadAsync();
      } catch {
        // Ignore unload failures during shutdown.
      }
    })
  );
  soundCache.clear();
  initialized = false;
  initializingPromise = null;
  currentSoundType = "";
  lastPlayedAt.clear();
  appStateSubscription?.remove?.();
  appStateSubscription = null;
  return true;
}
