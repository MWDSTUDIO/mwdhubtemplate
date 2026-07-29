import "server-only";

/** MIME by extension for the register's usual guests. */
const MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
  txt: "text/plain"
};

export function extensionOf(path: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(path);
  return m ? m[1].toLowerCase() : "";
}

export function mimeFor(path: string, stored?: string | null): string {
  return stored || MIME[extensionOf(path)] || "application/octet-stream";
}

/** A storage key must be plain ASCII; the pretty name lives in `label`. */
export function storageKeyFor(label: string): string {
  const ext = extensionOf(label);
  const stem = label
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "document";
  return `${Date.now()}-${stem}${ext ? `.${ext}` : ""}`;
}

/**
 * A download filename the client actually reads: the display label,
 * carrying the file's true extension. RFC 5987 for the accented form,
 * ASCII fallback beside it.
 */
export function dispositionFor(label: string, storagePath: string, inline = false): string {
  const ext = extensionOf(storagePath) || extensionOf(label);
  const stem = label.replace(/\.[a-z0-9]{1,8}$/i, "").trim() || "Document";
  const pretty = ext ? `${stem}.${ext}` : stem;
  const ascii = pretty.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(pretty).replace(/['()]/g, escape);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}
