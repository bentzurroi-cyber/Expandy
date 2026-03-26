import type { Expense } from "@/data/mock";
import { CSV_ROUNDTRIP_HEADERS } from "@/lib/importCsv";

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export type CsvLookup = {
  categoryName: (type: Expense["type"], id: string) => string;
  paymentName: (type: Expense["type"], id: string) => string;
};

/** CSV string using the same headers as `CSV_ROUNDTRIP_HEADERS` for seamless re-import. */
export function expensesToCsv(rows: Expense[], lookup: CsvLookup): string {
  const lines = [CSV_ROUNDTRIP_HEADERS.join(",")];
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  for (const e of sorted) {
    const cells = [
      e.date,
      e.type === "income" ? "הכנסה" : "הוצאה",
      String(e.amount),
      e.currency,
      lookup.categoryName(e.type, e.categoryId),
      lookup.paymentName(e.type, e.paymentMethodId),
      String(e.installments),
      String(e.installmentIndex),
      e.note.trim(),
    ].map((c) => escapeCsvCell(c));
    lines.push(cells.join(","));
  }
  return lines.join("\r\n");
}

export function downloadExpensesCsv(
  rows: Expense[],
  filename: string,
  lookup: CsvLookup,
): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + expensesToCsv(rows, lookup)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
