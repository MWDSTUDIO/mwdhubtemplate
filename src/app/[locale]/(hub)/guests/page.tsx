import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Guest, GuestEvent, WeddingEvent } from "@/lib/types";
import { AddGuestForm, StationerReview } from "./guests-client";

export default async function GuestsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("guests");
  const tc = await getTranslations("common");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: events }, { data: guests }, { data: guestEvents }] = await Promise.all([
    supabase.from("wedding_events").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("guests").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("guest_events").select("*").eq("wedding_id", wedding.id)
  ]);

  const allEvents = (events ?? []) as WeddingEvent[];
  const allGuests = (guests ?? []) as Guest[];
  const links = (guestEvents ?? []) as GuestEvent[];

  const countFor = (eventId: string) => ({
    confirmed: links.filter((l) => l.event_id === eventId && l.rsvp === "confirmed").length,
    invited: links.filter((l) => l.event_id === eventId).length
  });
  const eventsFor = (guestId: string) =>
    links
      .filter((l) => l.guest_id === guestId)
      .map((l) => allEvents.find((e) => e.id === l.event_id)?.name)
      .filter(Boolean)
      .join(" · ");
  const statusFor = (guestId: string) => {
    const mine = links.filter((l) => l.guest_id === guestId);
    if (mine.length && mine.every((l) => l.rsvp === "confirmed")) return "confirmed";
    if (mine.some((l) => l.rsvp === "declined")) return "declined";
    return "awaiting";
  };

  const heroEvents = allEvents.filter((e) =>
    ["welcome", "dinner", "farewell"].includes(e.name.toLowerCase().split(" ")[0])
  );
  const latestFlag = allGuests.map((g) => g.stationer_flag).filter(Boolean).at(-1) ?? null;

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {heroEvents.length > 0 && (
        <div className="grid3" style={{ marginBottom: 18 }}>
          {heroEvents.map((event) => {
            const c = countFor(event.id);
            return (
              <div className="card" style={{ marginBottom: 0 }} key={event.id}>
                <div className="eyebrow">{event.name}</div>
                <div className="serif num" style={{ fontSize: 34 }}>{c.confirmed}</div>
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                  {t("confirmedOf", { total: c.invited })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <AddGuestForm weddingId={wedding.id} events={allEvents} languages={wedding.languages} />

      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 14 }}>{t("theList")}</div>
        <div style={{ overflowX: "auto" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("invitationLine")}</th>
                <th>{t("invitedTo")}</th>
                <th>{t("travel")}</th>
                <th>{t("status")}</th>
              </tr>
            </thead>
            <tbody>
              {allGuests.map((guest) => (
                <tr key={guest.id}>
                  <td className="serif" style={{ fontSize: 16 }}>{guest.invitation_line}</td>
                  <td>{eventsFor(guest.id) || "—"}</td>
                  <td>{guest.travel ?? t("toArrange")}</td>
                  <td>
                    {statusFor(guest.id) === "confirmed" ? (
                      <span className="tag ok">{t("confirmed")}</span>
                    ) : statusFor(guest.id) === "declined" ? (
                      <span className="tag">{t("declined")}</span>
                    ) : (
                      <span className="tag wait">{t("awaitingReply")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <StationerReview weddingId={wedding.id} latestFlag={latestFlag} />

      {session.isTeam && (
        <div className="ia team-only" style={{ marginTop: 14 }}>
          <div className="eyebrow">
            {t("travelPlanning.title")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("travelPlanning.blurb")}</p>
        </div>
      )}
    </section>
  );
}
