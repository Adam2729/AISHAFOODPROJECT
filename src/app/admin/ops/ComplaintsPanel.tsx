"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ComplaintRow = {
  complaintId: string;
  orderNumber: string;
  businessId: string;
  businessName: string;
  type: "late" | "wrong_item" | "no_response" | "other";
  message: string;
  status: "open" | "resolved";
  createdAt?: string;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  resolutionNote?: string | null;
};

type Props = {
  adminKey: string;
  complaints: ComplaintRow[];
  fetchError?: string;
};

function formatDateTime(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-DO", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function ComplaintsPanel({ adminKey, complaints, fetchError }: Props) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState("");
  const [resolvedBy, setResolvedBy] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function resolveComplaint(complaintId: string) {
    if (loading) return;
    if (confirm.trim() !== "RESOLVE") {
      setError("Type RESOLVE to confirm.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/complaints/resolve?key=${encodeURIComponent(adminKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          complaintId,
          resolvedBy: resolvedBy.trim(),
          resolutionNote: resolutionNote.trim(),
          confirm: "RESOLVE",
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          (typeof json?.error === "string" ? json.error : json?.error?.message) ||
          "Could not resolve complaint.";
        setError(message);
        return;
      }
      setExpandedId("");
      setResolvedBy("");
      setResolutionNote("");
      setConfirm("");
      router.refresh();
    } catch {
      setError("Could not connect to resolve complaint.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold">Customer Complaints</h2>
      {fetchError ? <p className="mb-2 text-sm text-red-600">{fetchError}</p> : null}
      {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="pb-2">Created</th>
              <th className="pb-2">Business</th>
              <th className="pb-2">Order</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Message</th>
              <th className="pb-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {complaints.length ? (
              complaints.map((row) => (
                <tr key={row.complaintId} className="border-t border-slate-100 align-top">
                  <td className="py-2">{formatDateTime(row.createdAt)}</td>
                  <td className="py-2">{row.businessName}</td>
                  <td className="py-2 font-mono text-xs">{row.orderNumber}</td>
                  <td className="py-2 capitalize">{row.type.replace("_", " ")}</td>
                  <td className="py-2">{row.message}</td>
                  <td className="py-2">
                    {expandedId === row.complaintId ? (
                      <div className="flex min-w-[220px] flex-col gap-2">
                        <input
                          value={resolvedBy}
                          onChange={(e) => setResolvedBy(e.target.value)}
                          placeholder="resolvedBy (optional)"
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                          maxLength={60}
                        />
                        <textarea
                          value={resolutionNote}
                          onChange={(e) => setResolutionNote(e.target.value)}
                          placeholder="resolution note"
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                          rows={2}
                          maxLength={300}
                        />
                        <input
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="Type RESOLVE"
                          className="rounded border border-slate-300 px-2 py-1 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => resolveComplaint(row.complaintId)}
                            className="rounded bg-slate-900 px-2 py-1 text-xs font-semibold text-white"
                          >
                            {loading ? "Saving..." : "Resolve"}
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() => {
                              setExpandedId("");
                              setResolvedBy("");
                              setResolutionNote("");
                              setConfirm("");
                            }}
                            className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedId(row.complaintId);
                          setError("");
                        }}
                        className="rounded border border-slate-300 px-2 py-1 text-xs font-semibold"
                      >
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="py-3 text-center text-slate-500">
                  No open complaints.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

