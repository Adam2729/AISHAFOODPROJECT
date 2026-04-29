import { nanoid } from "nanoid";

export function getOrCreateRequestId(req: Request) {
  const existing = String(req.headers.get("x-request-id") || "").trim();
  if (existing) return existing;
  return nanoid(16);
}

export function attachRequestIdHeader<T extends Response>(response: T, requestId: string): T {
  if (requestId) {
    response.headers.set("x-request-id", requestId);
  }
  return response;
}
