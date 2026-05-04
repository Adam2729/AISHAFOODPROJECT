"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MerchantLoginPage() {
  const [businessId, setBusinessId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/merchant/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, pin }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "Login failed");
      return;
    }
    if (json.mustChangePin) {
      router.push("/merchant/set-pin");
      return;
    }
    router.push("/merchant/orders");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <form onSubmit={submit} className="w-full rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-bold">Merchant Login</h1>
        <p className="mt-1 text-sm text-slate-600">Use your business ID and PIN.</p>

        <div className="mt-4 grid gap-2">
          <input
            className="input"
            placeholder="Business ID"
            value={businessId}
            onChange={(e) => setBusinessId(e.target.value)}
          />
          <input className="input" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
            {loading ? "Logging in..." : "Login"}
          </button>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </form>

      <style jsx>{`
        .input {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.55rem 0.7rem;
        }
      `}</style>
    </main>
  );
}
