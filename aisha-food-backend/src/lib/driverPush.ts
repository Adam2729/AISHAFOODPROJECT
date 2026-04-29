type DriverPushPayload = {
  pushToken?: string | null;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

function normalizeToken(value: unknown) {
  const token = String(value || "").trim();
  if (!token) return null;
  if (!/^ExponentPushToken\[.+\]$/.test(token) && !/^ExpoPushToken\[.+\]$/.test(token)) {
    return null;
  }
  return token;
}

export async function sendDriverPushNotification(input: DriverPushPayload) {
  const pushToken = normalizeToken(input.pushToken);
  if (!pushToken) {
    return {
      sent: false,
      reason: "missing_push_token",
    };
  }

  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: pushToken,
        sound: "default",
        title: String(input.title || "").trim().slice(0, 160),
        body: String(input.body || "").trim().slice(0, 500),
        data: input.data || {},
        priority: "high",
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      console.error(
        JSON.stringify({
          type: "driver_push_send_error",
          pushToken,
          status: response.status,
          payload,
          timestamp: new Date().toISOString(),
        })
      );
      return {
        sent: false,
        reason: "push_response_error",
      };
    }

    return {
      sent: true,
      payload,
    };
  } catch (error: unknown) {
    console.error(
      JSON.stringify({
        type: "driver_push_send_error",
        pushToken,
        error: error instanceof Error ? error.message : "Failed to send driver push notification",
        timestamp: new Date().toISOString(),
      })
    );
    return {
      sent: false,
      reason: "push_request_failed",
    };
  }
}
