"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function MerchantSetPinPage() {
  const router = useRouter();
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await fetch("/api/merchant/auth/set-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPin: currentPin || undefined,
        newPin,
        confirmPin,
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!res.ok || !json.ok) {
      setError(json?.error?.message || json?.error || "No se pudo actualizar PIN");
      return;
    }
    router.push("/merchant/orders");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center p-6">
      <form onSubmit={submit} className="w-full rounded-xl border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-bold">Actualizar PIN</h1>
        <p className="mt-1 text-sm text-slate-600">
          Por seguridad, debes cambiar tu PIN para continuar.
        </p>

        <div className="mt-4 grid gap-2">
          <input
            className="input"
            placeholder="PIN actual (si aplica)"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
          />
          <input
            className="input"
            placeholder="Nuevo PIN (4-8 digitos)"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
          />
          <input
            className="input"
            placeholder="Confirmar nuevo PIN"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
          />
          <button disabled={loading} className="rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
            {loading ? "Guardando..." : "Guardar PIN"}
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
