"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { deleteBoard } from "@/app/actions/design";
import { addCustomBoard } from "@/app/actions/desk";

/** Team: add a board to this wedding's studio, right where it lives. */
export function AddBoardBar({ weddingId }: { weddingId: string }) {
  const t = useTranslations("design.manage");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="assist team-only" style={{ margin: "18px 0 0" }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("addPlaceholder")}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim() && !pending) {
            startTransition(async () => {
              const r = await addCustomBoard(weddingId, title.trim());
              setNote(r.ok ? t("added") : t("failed"));
              if (r.ok) setTitle("");
            });
          }
        }}
      />
      <button
        className="btn"
        disabled={pending || !title.trim()}
        onClick={() =>
          startTransition(async () => {
            const r = await addCustomBoard(weddingId, title.trim());
            setNote(r.ok ? t("added") : t("failed"));
            if (r.ok) setTitle("");
          })
        }
      >
        {pending ? "…" : t("add")}
      </button>
      {note && (
        <span style={{ fontSize: 12.5, color: "var(--bronze)" }} aria-live="polite">
          {note}
        </span>
      )}
    </div>
  );
}

/** Team: quietly retire a board that this wedding will not need. */
export function RemoveBoardButton({ boardId, title }: { boardId: string; title: string }) {
  const t = useTranslations("design.manage");
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="addnote team-only"
      aria-label={t("remove", { title })}
      title={t("remove", { title })}
      disabled={pending}
      style={{
        position: "absolute",
        top: 8,
        right: 8,
        zIndex: 3,
        background: "oklch(0.9801 0.0074 80.72 / 0.85)",
        padding: "2px 8px",
        fontSize: 13
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (confirm(t("removeConfirm", { title }))) {
          startTransition(() => deleteBoard(boardId).then(() => undefined));
        }
      }}
    >
      ×
    </button>
  );
}
