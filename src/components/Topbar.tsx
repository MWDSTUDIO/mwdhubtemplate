"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { locales, localeNames, type Locale } from "@/i18n/routing";
import { setActiveWedding, signOut } from "@/app/actions/auth";

interface WeddingOption {
  id: string;
  couple_display_name: string;
}

export function Topbar({
  coupleName,
  meta,
  isTeam,
  weddings,
  activeWeddingId
}: {
  coupleName: string;
  meta: string;
  isTeam: boolean;
  weddings: WeddingOption[];
  activeWeddingId: string | null;
}) {
  const t = useTranslations("topbar");

  return (
    <div className="topbar">
      <div className="who">
        <small>{meta}</small>
        <div className="serif">{coupleName}</div>
      </div>
      <div className="top-right">
        {isTeam && weddings.length > 1 && (
          <WeddingSwitcher weddings={weddings} activeWeddingId={activeWeddingId} />
        )}
        <LangSwitcher />
        {isTeam && <ViewToggle labels={{ team: t("teamView"), client: t("clientView") }} />}
        <SignOutButton label={t("signOut")} />
      </div>
    </div>
  );
}

function SignOutButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="lang"
      title={label}
      aria-label={label}
      disabled={pending}
      onClick={() => startTransition(() => signOut())}
    >
      <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.4" stroke="currentColor" aria-hidden>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
    </button>
  );
}

function WeddingSwitcher({
  weddings,
  activeWeddingId
}: {
  weddings: WeddingOption[];
  activeWeddingId: string | null;
}) {
  const [, startTransition] = useTransition();
  return (
    <select
      className="lang"
      style={{ maxWidth: 180 }}
      value={activeWeddingId ?? undefined}
      onChange={(e) => startTransition(() => setActiveWedding(e.target.value))}
      aria-label="Wedding"
    >
      {weddings.map((w) => (
        <option key={w.id} value={w.id}>
          {w.couple_display_name}
        </option>
      ))}
    </select>
  );
}

function LangSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="lang"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.4" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" />
        </svg>
        {locale.toUpperCase()}
      </button>
      {open && (
        <div className="lang-menu" role="listbox">
          {locales.map((l: Locale) => (
            <button
              key={l}
              role="option"
              aria-selected={l === locale}
              className={l === locale ? "on" : undefined}
              onClick={() => {
                setOpen(false);
                router.replace(pathname, { locale: l });
              }}
            >
              {localeNames[l]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Team view / Client view. Purely presentational for the team: real
 * separation is enforced by RLS and server-side gates. Clients never
 * receive team-only markup at all.
 */
function ViewToggle({ labels }: { labels: { team: string; client: string } }) {
  const [view, setView] = useState<"team" | "client">("team");

  useEffect(() => {
    document.body.classList.toggle("client-view", view === "client");
    return () => document.body.classList.remove("client-view");
  }, [view]);

  return (
    <div className="toggle">
      <button className={view === "team" ? "on" : undefined} onClick={() => setView("team")}>
        {labels.team}
      </button>
      <button className={view === "client" ? "on" : undefined} onClick={() => setView("client")}>
        {labels.client}
      </button>
    </div>
  );
}
