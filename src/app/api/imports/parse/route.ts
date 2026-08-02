import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { gate } from "../../agents/_shared";

/**
 * The import wizard's first hand (final prompt §B1): a dropped XLSX or
 * CSV — or rows pasted straight from a clipboard — becomes columns and
 * rows for the mapping screen. Nothing is written here; the wizard
 * only reads. Team only.
 */

const MAX_ROWS = 600;

export async function POST(request: Request) {
  const g = await gate(true);
  if ("error" in g) return g.error;

  try {
    const contentType = request.headers.get("content-type") ?? "";
    let rows: (string | number | null)[][] = [];

    if (contentType.includes("application/json")) {
      // Pasted rows: tab- or semicolon- or comma-separated lines.
      const { text } = (await request.json()) as { text: string };
      const lines = (text ?? "").replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
      const sep = lines[0]?.includes("\t") ? "\t" : lines[0]?.includes(";") ? ";" : ",";
      rows = lines.map((l) => l.split(sep).map((c) => c.trim()));
    } else {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "no file" }, { status: 400 });
      }
      const buf = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buf, { type: "buffer", raw: false });
      const first = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(first, { header: 1, defval: "" }) as (string | number | null)[][];
    }

    rows = rows.filter((r) => r.some((c) => String(c ?? "").trim() !== "")).slice(0, MAX_ROWS + 1);
    if (rows.length < 2) {
      return NextResponse.json({ error: "empty" }, { status: 422 });
    }
    const columns = rows[0].map((c) => String(c ?? "").trim());
    const body = rows.slice(1).map((r) => columns.map((_, i) => String(r[i] ?? "").trim()));
    return NextResponse.json({ columns, rows: body });
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 422 });
  }
}
