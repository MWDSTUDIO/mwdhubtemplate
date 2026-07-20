import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { Chat } from "@/components/Chat";
import type { Message } from "@/lib/types";

export default async function MessagesPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("messages");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: messages }, { data: profiles }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("wedding_id", wedding.id)
      .eq("channel", "client")
      .order("created_at"),
    supabase.from("profiles").select("id, full_name, role")
  ]);

  const names = Object.fromEntries(
    (profiles ?? []).map((p) => [
      p.id,
      p.role === "team" ? `${p.full_name} · MWD` : p.full_name
    ])
  );

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <Chat
        weddingId={wedding.id}
        channel="client"
        initialMessages={(messages ?? []) as Message[]}
        names={names}
        selfId={session.userId}
        placeholder={t("placeholder")}
      />
    </section>
  );
}
