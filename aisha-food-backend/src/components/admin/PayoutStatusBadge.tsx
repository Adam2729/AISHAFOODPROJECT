type PayoutStatus = "pending" | "paid" | "void" | "open";

type PayoutStatusBadgeProps = {
  status: string;
};

function palette(status: PayoutStatus | "") {
  if (status === "paid") return "bg-emerald-100 text-emerald-800";
  if (status === "pending" || status === "open") return "bg-amber-100 text-amber-800";
  if (status === "void") return "bg-slate-200 text-slate-700";
  return "bg-slate-100 text-slate-700";
}

export default function PayoutStatusBadge({ status }: PayoutStatusBadgeProps) {
  const normalized = String(status || "").trim().toLowerCase() as PayoutStatus | "";
  return (
    <span className={`rounded px-2 py-1 text-xs font-semibold ${palette(normalized)}`}>
      {normalized || "unknown"}
    </span>
  );
}
