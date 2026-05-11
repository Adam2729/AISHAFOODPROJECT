import Constants from "expo-constants";
import * as Haptics from "expo-haptics";
import { Platform, Vibration } from "react-native";

import { playSound } from "./soundManager";
import { speak } from "./voiceManager";

let lastNotifiedAttemptId = "";
let notificationChannelReady = false;
let notificationHandlerInstalled = false;
let expoGoPushNoticeShown = false;

function isExpoGoRuntime() {
  const appOwnership = String(Constants.appOwnership || "").trim().toLowerCase();
  const executionEnvironment = String(Constants.executionEnvironment || "")
    .trim()
    .toLowerCase();

  return appOwnership === "expo" || executionEnvironment === "storeclient";
}

function logExpoGoPushDisabled() {
  if (expoGoPushNoticeShown) return;
  expoGoPushNoticeShown = true;
  console.log(
    "Push notifications disabled in Expo Go. Use a development build for remote push notifications."
  );
}

async function loadNotificationsModule() {
  try {
    return await import("expo-notifications");
  } catch {
    return null;
  }
}

async function ensureNotificationChannel(Notifications) {
  if (Platform.OS !== "android" || notificationChannelReady || !Notifications) {
    return;
  }

  notificationChannelReady = true;

  try {
    await Notifications.setNotificationChannelAsync("driver-offers", {
      name: "Driver Offers",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 350, 180, 350],
      sound: "default",
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    notificationChannelReady = false;
  }
}

export async function installOfferNotificationHandler() {
  if (isExpoGoRuntime()) {
    logExpoGoPushDisabled();
    return false;
  }

  const Notifications = await loadNotificationsModule();
  if (!Notifications?.setNotificationHandler) {
    return false;
  }

  if (!notificationHandlerInstalled) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    notificationHandlerInstalled = true;
  }

  await ensureNotificationChannel(Notifications);
  return true;
}

export async function registerOfferNotificationResponseListener(onResponse) {
  if (isExpoGoRuntime()) {
    logExpoGoPushDisabled();
    return () => {};
  }

  const Notifications = await loadNotificationsModule();
  if (
    !Notifications?.addNotificationResponseReceivedListener ||
    typeof onResponse !== "function"
  ) {
    return () => {};
  }

  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response?.notification?.request?.content?.data || {};
    onResponse(data, response);
  });

  return () => {
    subscription?.remove?.();
  };
}

function getProjectId() {
  return (
    Constants?.expoConfig?.extra?.eas?.projectId ||
    Constants?.easConfig?.projectId ||
    null
  );
}

export async function registerForDriverPushToken() {
  if (isExpoGoRuntime()) {
    logExpoGoPushDisabled();
    return null;
  }

  const Notifications = await loadNotificationsModule();
  if (!Notifications?.getPermissionsAsync || !Notifications?.getExpoPushTokenAsync) {
    return null;
  }

  try {
    await installOfferNotificationHandler();

    const existing = await Notifications.getPermissionsAsync();
    let permissionStatus = existing.status;
    if (permissionStatus !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      permissionStatus = requested.status;
    }
    if (permissionStatus !== "granted") {
      return null;
    }

    const projectId = getProjectId();
    const response = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    return String(response?.data || "").trim() || null;
  } catch {
    return null;
  }
}

export async function announceIncomingOffer(offer) {
  const attemptId = String(offer?.attemptId || offer?.orderId || "").trim();
  if (!attemptId || attemptId === lastNotifiedAttemptId) {
    return false;
  }

  lastNotifiedAttemptId = attemptId;

  try {
    Vibration.vibrate([0, 400, 180, 400, 180, 400, 180, 400, 180, 400]);
  } catch {
    // no-op
  }

  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => null);
  await playSound("new_order").catch(() => null);
  speak("New order received");

  return true;
}

export function clearOfferNotificationMarker(orderOrAttemptId = "") {
  const key = String(orderOrAttemptId || "").trim();
  if (!key || key === lastNotifiedAttemptId) {
    lastNotifiedAttemptId = "";
  }
}

export function notificationPlatformLabel() {
  return Platform.OS === "android" ? "Android" : Platform.OS === "ios" ? "iPhone" : "device";
}

export function remotePushNotificationsEnabled() {
  return !isExpoGoRuntime();
}
