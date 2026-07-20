import type { ReactNode } from "react";
import { setRequestLocale, getFormatter, getTranslations } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { Topbar } from "@/components/Topbar";
import { EntranceGate } from "@/components/EntranceGate";
import { Madame } from "@/components/Madame";

export default async function HubLayout({
  children,
  params
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireHouseSession();
  const t = await getTranslations("topbar");
  const format = await getFormatter();
  const { wedding } = session;

  const meta = wedding?.date_start
    ? t("meta", {
        date: format.dateTime(new Date(wedding.date_start), {
          month: "long",
          year: "numeric"
        }),
        destination: wedding.destination
      })
    : t("metaBare");

  return (
    <>
      {wedding && (
        <EntranceGate
          coupleName={wedding.couple_display_name}
          mediaUrl={wedding.entrance_media_url}
          plaqueUrl={wedding.entrance_plaque_url}
        />
      )}
      <div className="app">
        <Sidebar
          access={{
            isTeam: session.isTeam,
            isTeamwork: session.isTeamwork,
            isPrincipal: session.isPrincipal,
            isCoordinator: session.isCoordinator
          }}
        />
        <main className="hub">
          <Topbar
            coupleName={wedding?.couple_display_name ?? "—"}
            meta={meta}
            isTeam={session.isTeam}
            weddings={session.weddings}
            activeWeddingId={wedding?.id ?? null}
          />
          {children}
        </main>
      </div>
      {/* Madame is the team's agent alone: never rendered for clients or
          coordinators — a server-side gate, not a CSS one. Inside the
          markup she still carries team-only so Client view previews
          exactly what the couple sees. */}
      {session.isTeam && wedding && <Madame weddingId={wedding.id} />}
    </>
  );
}
