"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function AdminAccessPage() {
  return (
    <Suspense
      fallback={<main className="mx-auto flex min-h-screen max-w-md items-center p-6" />}
    >
      <AdminAccessPageInner />
    </Suspense>
  );
}

function AdminAccessPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [adminKey, setAdminKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const nextPath = useMemo(() => {
    const next = String(searchParams.get("next") || "/admin").trim();
    if (!next.startsWith("/")) return "/admin";
    return next;
  }, [searchParams]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
            "Could not start the admin session."
        );
      }
      router.replace(nextPath);
    } catch (requestError: unknown) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not start the admin session."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <form
        onSubmit={submit}
        className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold text-slate-950">Admin Access</h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter the admin access key once to start a secure browser session. Do not share keyed URLs.
        </p>

        <label className="mt-5 block text-sm font-medium text-slate-700">
          Admin access key
          <input
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2"
            autoComplete="off"
          />
        </label>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

        <button
          type="submit"
          disabled={loading || !adminKey.trim()}
          className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Opening session..." : "Open admin session"}
        </button>
      </form>
    </main>
  );
}
