type CsvDownloadLinkProps = {
  href: string;
  label?: string;
  className?: string;
};

export default function CsvDownloadLink({
  href,
  label = "Export CSV",
  className = "",
}: CsvDownloadLinkProps) {
  return (
    <a
      href={href}
      className={`inline-flex rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 ${className}`.trim()}
    >
      {label}
    </a>
  );
}
