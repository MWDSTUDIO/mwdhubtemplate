"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dictate } from "@/components/Dictate";

interface Exchange {
  who: "you" | "madame";
  text: string;
}

/**
 * Madame — the resident agent of the house. Team only (the layout never
 * renders her for clients); present on every page. Speak to her, or drop
 * a document — she reads it and places it where it belongs, always as a
 * draft awaiting Estelle's word.
 */
export function Madame({ weddingId }: { weddingId: string }) {
  const t = useTranslations("madame");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Exchange[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const outRef = useRef<HTMLDivElement>(null);

  const scroll = () =>
    requestAnimationFrame(() => {
      outRef.current?.scrollTo({ top: outRef.current.scrollHeight });
    });

  async function ask() {
    const q = inputRef.current?.value.trim();
    if (!q || busy) return;
    inputRef.current!.value = "";
    setLog((l) => [...l, { who: "you", text: q }]);
    setBusy(true);
    scroll();
    try {
      const r = await fetch("/api/agents/madame", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weddingId, prompt: q })
      });
      const d = await r.json();
      setLog((l) => [...l, { who: "madame", text: d.text ?? t("unreachable") }]);
    } catch {
      setLog((l) => [...l, { who: "madame", text: t("unreachable") }]);
    }
    setBusy(false);
    scroll();
  }

  async function readDocument(file: File) {
    if (busy) return;
    setLog((l) => [...l, { who: "you", text: t("dropped", { name: file.name }) }]);
    setBusy(true);
    scroll();
    try {
      const form = new FormData();
      form.append("weddingId", weddingId);
      form.append("file", file);
      const r = await fetch("/api/agents/document", { method: "POST", body: form });
      const d = await r.json();
      setLog((l) => [...l, { who: "madame", text: d.text ?? t("unreachable") }]);
    } catch {
      setLog((l) => [...l, { who: "madame", text: t("unreachable") }]);
    }
    setBusy(false);
    scroll();
  }

  return (
    <>
      <button
        className="maBtn team-only"
        title="Madame"
        aria-label="Madame"
        onClick={() => setOpen((v) => !v)}
      >
        M
      </button>
      {open && (
        <div className="maPanel team-only" role="dialog" aria-label="Madame">
          <div className="hd">
            <div className="eyebrow">Madame</div>
            <div style={{ fontSize: 12.5, marginTop: 3 }}>{t("tagline")}</div>
          </div>
          <button
            type="button"
            className={`maDrop${dragOver ? " over" : ""}`}
            style={{ border: "1px dashed var(--champagne)", font: "inherit" }}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void readDocument(file);
            }}
          >
            {t("drop")}
            <br />
            <strong style={{ color: "var(--hunter)" }}>{t("dropStrong")}</strong>
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.csv,.txt,.docx,.xlsx"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void readDocument(file);
              e.target.value = "";
            }}
          />
          <div style={{ padding: "0 16px 8px", fontSize: 12.5, color: "var(--ink2)" }}>
            {t("examples")}
          </div>
          <div
            ref={outRef}
            style={{ maxHeight: 220, overflowY: "auto", padding: "0 16px 10px", fontSize: 13, lineHeight: 1.55 }}
            aria-live="polite"
          >
            {log.map((x, i) => (
              <p key={i} style={{ margin: x.who === "you" ? "8px 0 4px" : "4px 0 8px" }}>
                <strong>{x.who === "you" ? t("you") : "Madame"}</strong> — {x.text}
              </p>
            ))}
            {busy && <p style={{ color: "var(--ink2)" }}>…</p>}
          </div>
          <div className="chat-in" style={{ borderTop: "1px solid var(--line)", alignItems: "center", paddingLeft: 8 }}>
            <Dictate
              title={t("dictate")}
              onText={(text) => {
                if (inputRef.current) inputRef.current.value += text;
              }}
            />
            <input
              ref={inputRef}
              placeholder={t("placeholder")}
              onKeyDown={(e) => e.key === "Enter" && ask()}
            />
            <button className="btn" style={{ borderRadius: 0 }} onClick={ask} disabled={busy}>
              {t("go")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
