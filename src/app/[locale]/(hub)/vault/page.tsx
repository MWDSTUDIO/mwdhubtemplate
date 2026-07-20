import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { hasRoom } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { CodeGate } from "@/components/CodeGate";
import { VaultContracts } from "./vault-client";
import type { VaultContract } from "@/lib/types";

/**
 * The Vault 🔒 — Estelle alone. Locked server-side: RLS admits only the
 * principal, and her personal code (bcrypt-verified in Postgres) is a
 * second lock. Invisible and inaccessible to everyone else, Jordane
 * included.
 */
export default async function VaultPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  if (!session.isPrincipal) redirect({ href: "/", locale });
  const t = await getTranslations("vault");

  const unlocked = await hasRoom("vault", session.userId);

  if (!unlocked) {
    return (
      <section className="sheet">
        <div className="eyebrow">{t("eyebrow")}</div>
        <h1 className="title">{t("headline")}</h1>
        <p className="lead">{t("lead")}</p>
        <CodeGate scope="vault" hint={t("codeHint")} />
      </section>
    );
  }

  const supabase = await createClient();
  const { data: contracts } = await supabase
    .from("contracts_vault")
    .select("*")
    .order("created_at");

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <VaultContracts
        contracts={(contracts ?? []) as VaultContract[]}
        weddingId={session.wedding?.id ?? null}
      />
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 12 }}>{t("agentNote")}</p>
    </section>
  );
}
