/** UTF-8 BOM for Excel Hebrew */
const BOM = "\uFEFF";

export function downloadAssetImportTemplate(filename = "expandy-assets-import-template.csv"): void {
  const headers = ["תאריך", "סכום", "שם", "סוג", "מטבע"];
  const sample = [
    ["2026-03-15", "125000", "חשבון עו״ש", "חשבונות נזילים", "₪"],
    ["2026-03-01", "48000", "קרן השתלמות", "פנסיה / השתלמות", "₪"],
  ];
  const csv =
    BOM +
    `${headers.join(",")}\r\n` +
    sample.map((r) => r.join(",")).join("\r\n") +
    "\r\n";
  triggerDownload(csv, filename);
}

export function downloadIncomeImportTemplate(filename = "expandy-incomes-import-template.csv"): void {
  const headers = ["תאריך", "סכום", "מטבע", "קטגוריה", "חשבון יעד", "הערות"];
  const sample = [
    ["2026-03-01", "12000", "₪", "משכורת", "בנק לאומי", "משכורת מרץ"],
    ["2026-03-10", "500", "₪", "פרילנס", "חשבון משותף", "ייעוץ"],
  ];
  const csv =
    BOM +
    `${headers.join(",")}\r\n` +
    sample.map((r) => r.join(",")).join("\r\n") +
    "\r\n";
  triggerDownload(csv, filename);
}

export function downloadExpenseImportTemplate(filename = "expandy-expenses-import-template.csv"): void {
  const headers = ["תאריך", "סכום", "מטבע", "קטגוריה", "אמצעי תשלום", "הערות"];
  const sample = [
    ["2026-03-12", "420", "₪", "מכולת וסופר", "אשראי רועי", "קניות שבועיות"],
    ["2026-03-10", "180", "₪", "תחבורה", "ביט רועי", "רב קו"],
  ];
  const csv =
    BOM +
    `${headers.join(",")}\r\n` +
    sample.map((r) => r.join(",")).join("\r\n") +
    "\r\n";
  triggerDownload(csv, filename);
}

function triggerDownload(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
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
