import { cookies } from "next/headers";
import { ok } from "@/lib/apiResponse";
import { merchantCookieName } from "@/lib/merchantAuth";

export async function POST() {
  const cookieStore = await cookies();
  cookieStore.set(merchantCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return ok({ signedOut: true });
}
