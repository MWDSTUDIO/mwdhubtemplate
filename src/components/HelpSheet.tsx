"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * The discreet "?" (brief §2 — les raccourcis, découvrables). The same
 * keys everywhere in Team view; this sheet is where they are written.
 */
export function HelpSheet() {
  const t = useTranslations("help");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
      if (e.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const rows: [string, string][] = [
    ["?", t("keyHelp")],
    ["m", t("keyMadame")],
    ["p", t("keyPublish")],
    ["Esc", t("keyEsc")],
    ["Tab", t("keyTab")],
    ["Enter", t("keyEnter")],
    ["⌘/Ctrl + Z", t("keyUndo")]
  ];

  return (
    <>
      <button
        className="lang team-only"
        style={{ paddingLeft: 13, paddingRight: 13 }}
        onClick={() => setOpen((v) => !v)}
        title={t("title")}
        aria-label={t("title")}
      >
        ?
      </button>
      {open && (
        <div className="deskPanel team-only" role="dialog" aria-label={t("title")}>
          <div className="hd">
            <div className="eyebrow">{t("title")}</div>
            <div style={{ fontSize: 13, marginTop: 3 }}>{t("tagline")}</div>
          </div>
          <div className="deskPanel-body">
            <table className="helpKeys">
              <tbody>
                {rows.map(([k, label]) => (
                  <tr key={k}>
                    <td><kbd>{k}</kbd></td>
                    <td>{label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 12 }}>{t("note")}</p>
          </div>
        </div>
      )}
    </>
  );
}
