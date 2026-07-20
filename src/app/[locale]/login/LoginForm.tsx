"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn } from "@/app/actions/auth";

export function LoginForm() {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action}>
      <input
        type="email"
        name="email"
        placeholder={t("email")}
        autoComplete="email"
        required
      />
      <input
        type="password"
        name="password"
        placeholder={t("password")}
        autoComplete="current-password"
        required
      />
      {state?.error && (
        <p style={{ fontSize: 12.5, color: "var(--champagne)", margin: "2px 0 10px" }}>
          {t("error")}
        </p>
      )}
      <button
        className="btn"
        type="submit"
        disabled={pending}
        style={{
          width: "100%",
          background: "none",
          border: "1px solid var(--champagne)",
          color: "var(--cream)",
          letterSpacing: "0.34em",
          padding: "13px 0"
        }}
      >
        {pending ? "…" : t("enter")}
      </button>
    </form>
  );
}
