import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function fail(code: string, message: string, status = 400, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, details: details ?? null },
    },
    { status }
  );
}

export async function readJson<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}
