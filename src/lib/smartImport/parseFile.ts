import * as Papa from "papaparse";
import * as XLSX from "xlsx";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  parseWarnings: string[];
};

function trimRecord(row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const key = String(k ?? "").trim();
    if (!key) continue;
    out[key] = v == null ? "" : String(v).trim();
  }
  return out;
}

export function parseCsvText(csvText: string): ParsedSheet {
  const warnings: string[] = [];
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h: unknown) => String(h ?? "").trim(),
  });
  if (parsed.errors?.length) {
    warnings.push(
      ...parsed.errors.map((e) => String((e as { message?: unknown }).message ?? "CSV error")),
    );
  }
  const fields = parsed.meta?.fields?.filter((f): f is string => typeof f === "string" && f.trim()) ?? [];
  const rows = (parsed.data ?? [])
    .map(trimRecord)
    .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
  return { headers: fields, rows, parseWarnings: warnings };
}

export async function parseImportFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    return parseCsvText(text);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return { headers: [], rows: [], parseWarnings: ["Empty workbook"] };
    }
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    const rows = json
      .map(trimRecord)
      .filter((r) => Object.values(r).some((v) => v.trim() !== ""));
    const headers =
      rows.length > 0
        ? Object.keys(rows[0]!).filter((k) => k.trim())
        : [];
    return { headers, rows, parseWarnings: [] };
  }
  const text = await file.text();
  return parseCsvText(text);
}
