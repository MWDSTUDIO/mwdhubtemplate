"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { Board } from "@/lib/types";
import {
  addPaletteTone,
  removePaletteTone,
  respondToBoard,
  setBoardStatus
} from "@/app/actions/design";

/** Hex in — square out. ~4 tones per board, team only. */
export function PaletteEditor({ board, isTeam }: { board: Board; isTeam: boolean }) {
  const t = useTranslations("design");
  const tc = useTranslations("common");
  const [hex, setHex] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <>
      <div className="swrow">
        {board.palette.map((tone, i) => (
          <span key={`${tone}${i}`} style={{ position: "relative" }}>
            <span className="swatch" style={{ background: tone }} title={tone} />
            {isTeam && (
              <button
                className="addnote team-only"
                aria-label={t("removeTone", { tone })}
                style={{ position: "absolute", top: -8, right: -6, fontSize: 11 }}
                disabled={pending}
                onClick={() => startTransition(() => removePaletteTone(board.id, i))}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {board.palette.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--ink2)", marginLeft: 6 }}>
            {board.palette.join(" · ")}
          </span>
        )}
        {board.palette.length === 0 && (
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("noTones")}</span>
        )}
      </div>
      {isTeam && (
        <div className="swrow team-only" style={{ marginTop: 14 }}>
          <input
            className="hex"
            value={hex}
            onChange={(e) => setHex(e.target.value)}
            placeholder="#hex"
            onKeyDown={(e) => {
              if (e.key === "Enter" && hex) {
                startTransition(() => addPaletteTone(board.id, hex));
                setHex("");
              }
            }}
          />
          <button
            className="btn ghost sm"
            disabled={pending || !hex}
            onClick={() => {
              startTransition(() => addPaletteTone(board.id, hex));
              setHex("");
            }}
          >
            {t("addTone")}
          </button>
          <span className="tag int">{tc("internal")} — {t("hexHint")}</span>
        </div>
      )}
    </>
  );
}

/** Approval workflow: the house sends to review; the couple gives its word. */
export function BoardActions({
  board,
  isTeam,
  isClient
}: {
  board: Board;
  isTeam: boolean;
  isClient: boolean;
}) {
  const t = useTranslations("design");
  const tc = useTranslations("common");
  const [comment, setComment] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 12 }}>{t("yourWord")}</div>

      {isClient && board.status === "to_review" && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            className="btn"
            disabled={pending}
            onClick={() => startTransition(() => respondToBoard(board.id, "approval", comment))}
          >
            {t("approve")}
          </button>
        </div>
      )}

      <div className="assist" style={{ marginTop: 0 }}>
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("commentPlaceholder")}
        />
        <button
          className="btn ghost"
          disabled={pending || !comment.trim()}
          onClick={() =>
            startTransition(async () => {
              await respondToBoard(board.id, "comment", comment.trim());
              setComment("");
            })
          }
        >
          {t("sendComment")}
        </button>
      </div>

      {isTeam && (
        <div className="team-only" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span className="tag int">{tc("internal")}</span>
          {board.status !== "to_review" && (
            <button
              className="btn sm"
              disabled={pending}
              onClick={() => startTransition(() => setBoardStatus(board.id, "to_review"))}
            >
              {t("sendToReview")}
            </button>
          )}
          {board.status !== "in_creation" && (
            <button
              className="btn ghost sm"
              disabled={pending}
              onClick={() => startTransition(() => setBoardStatus(board.id, "in_creation"))}
            >
              {t("backToCreation")}
            </button>
          )}
          <a className="btn ghost sm" href={`/api/pdf/board/${board.id}`}>
            {t("exportPdf")}
          </a>
        </div>
      )}
    </div>
  );
}
