"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { HOME_SECTIONS, sectionOrder, type HomeConfig, type HomeSection } from "@/lib/home";
import { saveHomeConfig } from "@/app/actions/home";

/**
 * The team arranges the entrance hall (PRD Home §29): order and
 * visibility of the sections — presentation alone, the only thing
 * Home owns. The couple never configures.
 */
export function HomeConfigDesk({ weddingId, config }: { weddingId: string; config: HomeConfig }) {
  const t = useTranslations("home.config");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<HomeSection[]>(sectionOrder(config));
  const [hidden, setHidden] = useState<Set<string>>(new Set(config.hidden ?? []));
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="addnote team-only" onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }

  const move = (i: number, dir: -1 | 1) => {
    setOrder((list) => {
      const n = [...list];
      const j = i + dir;
      if (j < 0 || j >= n.length) return list;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setDirty(true);
  };

  return (
    <div className="card team-only" style={{ borderColor: "var(--champagne)" }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{t("title")}</div>
      {order.map((s, i) => (
        <div key={s} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0", fontSize: 13.5 }}>
          <span style={{ display: "inline-flex", gap: 2 }}>
            <button className="addnote" aria-label={t("up")} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
            <button className="addnote" aria-label={t("down")} disabled={i === order.length - 1} onClick={() => move(i, 1)}>↓</button>
          </span>
          <label style={{ display: "inline-flex", gap: 8, alignItems: "center", flex: 1 }}>
            <input
              type="checkbox"
              checked={!hidden.has(s)}
              onChange={(e) => {
                setHidden((prev) => {
                  const n = new Set(prev);
                  if (e.target.checked) n.delete(s); else n.add(s);
                  return n;
                });
                setDirty(true);
              }}
              style={{ width: "auto" }}
            />
            {t(`sections.${s}`)}
          </label>
          {(s === "priorities") && <span className="tag int">{t("teamOnly")}</span>}
        </div>
      ))}
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "8px 0 0" }}>{t("previewHint")}</p>
      <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
        <button
          className="btn sm"
          disabled={pending || !dirty}
          onClick={() =>
            startTransition(async () => {
              const r = await saveHomeConfig(weddingId, { order, hidden: [...hidden] });
              if (!r.ok) window.alert(t("needsMigration"));
              setDirty(false);
              setOpen(false);
              router.refresh();
            })
          }
        >
          {pending ? "…" : t("save")}
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>{t("close")}</button>
        <button
          className="addnote"
          onClick={() => {
            setOrder([...HOME_SECTIONS]);
            setHidden(new Set());
            setDirty(true);
          }}
        >
          {t("reset")}
        </button>
      </div>
    </div>
  );
}
