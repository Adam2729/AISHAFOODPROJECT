"use client";

type WeekKeyPickerProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  className?: string;
};

export default function WeekKeyPicker({
  value,
  onChange,
  label = "WeekKey",
  className = "",
}: WeekKeyPickerProps) {
  return (
    <label className={`text-sm ${className}`.trim()}>
      <span className="mb-1 block text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="YYYY-Www"
        className="w-full rounded border border-slate-300 px-3 py-2"
      />
    </label>
  );
}
