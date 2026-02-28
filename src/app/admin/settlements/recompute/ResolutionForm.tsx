"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type ResolutionStatus = "confirmed_correct" | "adjusted" | "merchant_disputed" | "writeoff";

type Props = {
  adminKey: string;
  businessId: string;
  weekKey: string;
  existingResolutionStatus?: ResolutionStatus | null;
  existingNote?: string;
  existingAttachmentUrl?: string;
  existingResolvedBy?: string;
};

const STATUSES: ResolutionStatus[] = [
  "confirmed_correct",
  "adjusted",
  "merchant_disputed",
  "writeoff",
];

export default function ResolutionForm({
  adminKey,
  businessId,
  weekKey,
  existingResolutionStatus,
  existingNote = "",
  existingAttachmentUrl = "",
  existingResolvedBy = "",
}: Props) {
  const router = useRouter();
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatus>(
    existingResolutionStatus || "confirmed_correct"
  );
  const [note, setNote] = useState(existingNote);
  const [attachmentUrl, setAttachmentUrl] = useState(existingAttachmentUrl);
  const [resolvedBy, setResolvedBy] = useState(existingResolvedBy);
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const noteLength = useMemo(() => note.trim().length, [note]);

  async function submitResolution() {
    setError("");
    if (confirm !== "RESOLVE") {
      setError('Please type "RESOLVE" to confirm.');
      return;
    }
    if (note.trim().length > 500) {
      setError("Note must be 500 characters or less.");
      return;
    }
    if (attachmentUrl.trim().length > 500) {
      setError("Attachment URL must be 500 characters or less.");
      return;
    }
    if (resolvedBy.trim().length > 60) {
      setError("Resolved by must be 60 characters or less.");
      return;
    }

    setSaving(true);
    const res = await fetch(`/api/admin/settlements/resolve?key=${encodeURIComponent(adminKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        businessId,
        weekKey,
        resolutionStatus,
        note: note.trim(),
        attachmentUrl: attachmentUrl.trim(),
        resolvedBy: resolvedBy.trim(),
        confirm: "RESOLVE",
      }),
    });
    const json = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok || !json?.ok) {
      setError(json?.error?.message || json?.error || "Failed to save resolution.");
      return;
    }
    setConfirm("");
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 p-3">
      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Resolution status</span>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={resolutionStatus}
          onChange={(e) => setResolutionStatus(e.target.value as ResolutionStatus)}
        >
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Note</span>
        <textarea
          className="min-h-24 rounded-lg border border-slate-300 px-3 py-2"
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resolution details (optional)"
        />
        <span className="text-xs text-slate-500">{noteLength}/500</span>
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Attachment URL</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={attachmentUrl}
          onChange={(e) => setAttachmentUrl(e.target.value)}
          placeholder="https://..."
          maxLength={500}
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Resolved by</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={resolvedBy}
          onChange={(e) => setResolvedBy(e.target.value)}
          placeholder="admin"
          maxLength={60}
        />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-medium text-slate-700">Confirm (type RESOLVE)</span>
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="RESOLVE"
        />
      </label>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div>
        <button
          type="button"
          onClick={submitResolution}
          disabled={saving}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Resolution"}
        </button>
      </div>
    </div>
  );
}
