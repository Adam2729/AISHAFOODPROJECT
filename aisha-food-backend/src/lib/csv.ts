export function csvEscape(value: unknown) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function csvLine(values: unknown[]) {
  return values.map((value) => csvEscape(value)).join(",");
}
