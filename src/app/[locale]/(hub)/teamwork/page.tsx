import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireHouseSession } from "@/lib/session";
import { hasRoom } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import { CodeGate } from "@/components/CodeGate";
import { Chat } from "@/components/Chat";
import { CallBrief } from "./teamwork-client";
import type { Message } from "@/lib/types";

/**
 * Teamwork 🔑 — the room of the two heads of the house. Membership
 * (Estelle + Jordane) is enforced by RLS; the shared access code is a
 * second lock on top of the session.
 */
export default async function TeamworkPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  if (!session.isTeamwork) redirect({ href: "/", locale });
  const t = await getTranslations("teamwork");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const unlocked = await hasRoom("teamwork", session.userId);

  if (!unlocked) {
    return (
      <section className="sheet">
        <div className="eyebrow">{t("eyebrow")}</div>
        <h1 className="title">{t("headline")}</h1>
        <p className="lead">{t("lead")}</p>
        <CodeGate scope="teamwork" hint={t("codeHint")} />
      </section>
    );
  }

  const supabase = await createClient();
  const [{ data: prep }, { data: messages }, { data: profiles }] = await Promise.all([
    supabase
      .from("call_preparations")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("call_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("messages")
      .select("*")
      .eq("wedding_id", wedding.id)
      .eq("channel", "teamwork")
      .order("created_at"),
    supabase.from("profiles").select("id, full_name")
  ]);

  const names = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.full_name]));
  const points: string[] = Array.isArray(prep?.points) ? prep.points : [];

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <div className="grid2">
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            {t("callPrep", {
              couple: wedding.couple_display_name,
              date: prep?.call_date
                ? format.dateTime(new Date(prep.call_date), { month: "short", day: "numeric" })
                : "—"
            })}
          </div>
          <ul className="steps">
            {points.map((point, i) => (
              <li key={i}>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <CallBrief weddingId={wedding.id} callPrepId={prep?.id ?? null} points={points} />
        </div>
        <div className="card" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "16px 22px", borderBottom: "1px solid var(--line)" }}>
            <div className="eyebrow">{t("betweenUs")}</div>
          </div>
          <Chat
            weddingId={wedding.id}
            channel="teamwork"
            initialMessages={(messages ?? []) as Message[]}
            names={names}
            selfId={session.userId}
            placeholder={t("writePlaceholder")}
          />
        </div>
      </div>
    </section>
  );
}
