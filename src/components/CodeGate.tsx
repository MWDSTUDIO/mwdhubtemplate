"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { verifyRoomCode } from "@/app/actions/rooms";

/**
 * The room code — six quiet dots. Even in team view, these rooms stay
 * closed: the code is verified against a bcrypt hash server-side.
 */
export function CodeGate({ scope, hint }: { scope: "teamwork" | "vault"; hint: string }) {
  const t = useTranslations("rooms");
  const [code, setCode] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const LENGTH = 4;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (code.length === LENGTH && !pending) {
      startTransition(async () => {
        const r = await verifyRoomCode(scope, code);
        if (!r.ok) {
          setFailed(true);
          setCode("");
        }
      });
    }
  }, [code, pending, scope]);

  return (
    <div className="card">
      <button
        className="lock"
        style={{ background: "none", border: "none", width: "100%", cursor: "text" }}
        onClick={() => inputRef.current?.focus()}
      >
        <div className="eyebrow">{t(`${scope}.prompt`)}</div>
        <div className="dots" aria-hidden>
          {Array.from({ length: LENGTH }).map((_, i) => (
            <span key={i} className={i < code.length ? "f" : undefined} />
          ))}
        </div>
        <input
          ref={inputRef}
          className="code-input"
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          value={code}
          onChange={(e) => {
            setFailed(false);
            setCode(e.target.value.replace(/\D/g, "").slice(0, LENGTH));
          }}
          aria-label={t(`${scope}.prompt`)}
        />
        {failed && (
          <p style={{ fontSize: 12.5, color: "var(--bronze)" }}>{t("wrongCode")}</p>
        )}
        {pending && <p style={{ fontSize: 12.5, color: "var(--ink2)" }}>…</p>}
        <p style={{ fontSize: 12, color: "var(--ink2)", maxWidth: 380 }}>{hint}</p>
      </button>
    </div>
  );
}
