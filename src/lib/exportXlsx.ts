import * as XLSX from "xlsx";
import type { CurrencyDef, Expense } from "@/data/mock";
import { formatDateDDMMYYYY } from "@/lib/format";

const HEADERS = [
  "Date",
  "Type",
  "Amount",
  "Currency Name",
  "Category",
  "Payment Method",
  "Notes",
] as const;

export type XlsxLookup = {
  categoryName: (type: Expense["type"], id: string) => string;
  paymentName: (type: Expense["type"], id: string) => string;
};

function getCurrency(currencies: CurrencyDef[], code: string): CurrencyDef {
  return (
    currencies.find((c) => c.code === code) ?? {
      code,
      labelHe: code,
      symbol: "¤",
      iconKey: "generic",
    }
  );
}

export function expensesToXlsxAoA(
  rows: Expense[],
  currencies: CurrencyDef[],
  lookup: XlsxLookup,
): (string | number)[][] {
  const sorted = [...rows].sort((a, b) => b.date.localeCompare(a.date));
  const data: (string | number)[][] = [HEADERS.slice()];

  for (const e of sorted) {
    const c = getCurrency(currencies, e.currency);
    data.push([
      formatDateDDMMYYYY(e.date),
      e.type === "income" ? "הכנסה" : "הוצאה",
      `${c.symbol}${e.amount}`,
      c.labelHe,
      lookup.categoryName(e.type, e.categoryId),
      lookup.paymentName(e.type, e.paymentMethodId),
      e.note.trim(),
    ]);
  }
  return data;
}

export function downloadExpensesXlsx(
  rows: Expense[],
  filename: string,
  currencies: CurrencyDef[],
  lookup: XlsxLookup,
): void {
  const aoa = expensesToXlsxAoA(rows, currencies, lookup);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 12 }, // Date
    { wch: 10 }, // Type
    { wch: 16 }, // Amount
    { wch: 18 }, // Currency Name
    { wch: 28 }, // Category
    { wch: 26 }, // Payment Method
    { wch: 40 }, // Notes
  ];

  // Best-effort bold header styling (supported by some viewers).
  const headerRow = 0;
  for (let c = 0; c < HEADERS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c });
    if (ws[addr]) {
      (ws[addr] as XLSX.CellObject).s = { font: { bold: true } };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Expandy");

  const out = XLSX.write(wb, {
    bookType: "xlsx",
    type: "array",
    cellStyles: true,
  });

  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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

