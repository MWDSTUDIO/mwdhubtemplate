import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Correspondence, Guest, GuestEvent, GuestPerson, HotelBlock,
  PersonEventStatus, WeddingEvent
} from "@/lib/types";
import { HotelDesk, OpenRoomingButton } from "./communication-client";
import { AddGuestForm, GuestList, StationerReview } from "./guests-client";
import { GuestSheet } from "./guest-sheet";
import { GuestGrid } from "./guest-grid";

/**
 * Wedding Communication — one page for the whole conversation with
 * the guests (brief, lot A): the general correspondence held light,
 * the guest list held better than the couple could, accommodation
 * and travel. Estelle's hand corrects everything, at any hour.
 */
export default async function WeddingCommunicationPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("communication");
  const tg = await getTranslations("guests");
  const tc = await getTranslations("common");
  const format = await getFormatter();
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [
    { data: correspondence },
    { data: blocks },
    { data: roomingState },
    { data: events },
    { data: guests },
    { data: guestEvents },
    { data: gridPersons, error: personsError },
    { data: gridStatuses }
  ] = await Promise.all([
    supabase
      .from("correspondence")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("sent_at", { ascending: true, nullsFirst: false }),
    supabase.from("hotel_blocks").select("*").eq("wedding_id", wedding.id),
    supabase.from("rooming_list_state").select("*").eq("wedding_id", wedding.id).maybeSingle(),
    supabase.from("wedding_events").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("guests").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("guest_events").select("*").eq("wedding_id", wedding.id),
    // Pre-0024 these tables are absent — the sheet keeps working, the
    // grid simply does not show.
    supabase.from("guest_persons").select("*").eq("wedding_id", wedding.id),
    supabase.from("person_event_status").select("*").eq("wedding_id", wedding.id)
  ]);

  const allEvents = (events ?? []) as WeddingEvent[];
  const allGuests = (guests ?? []) as Guest[];
  const links = (guestEvents ?? []) as GuestEvent[];
  const gridReady = !personsError;
  const personsAll = (gridPersons ?? []) as GuestPerson[];
  const statusesAll = (gridStatuses ?? []) as PersonEventStatus[];
  const letters = (correspondence ?? []) as Correspondence[];
  const opened = roomingState?.opened ?? false;

  const countFor = (eventId: string) => ({
    confirmed: links.filter((l) => l.event_id === eventId && l.rsvp === "confirmed").length,
    invited: links.filter((l) => l.event_id === eventId).length
  });
  const heroEvents = allEvents.filter((e) =>
    ["welcome", "dinner", "farewell"].includes(e.name.toLowerCase().split(" ")[0])
  );
  const latestFlag = allGuests.map((g) => g.stationer_flag).filter(Boolean).at(-1) ?? null;

  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { month: "short", day: "numeric", year: "numeric" }) : "—";

  // The general volet stands alone or it lies (brief §1): with no
  // correspondence at all, the couple is shown nothing — no shell.
  const staleLine = (c: Correspondence) =>
    c.status !== "sent" && !c.scheduled_label;
  const generalForClient = letters.length > 0;

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {/* ── I. General communication — light, or absent ────────────── */}
      {(generalForClient || session.isTeam) && (
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 8 }}>{t("correspondence.title")}</div>
          {letters.length === 0 && session.isTeam && (
            <p style={{ fontSize: 13, color: "var(--ink2)" }}>{t("correspondence.emptyTeam")}</p>
          )}
          <ul className="steps" style={{ marginTop: 6 }}>
            {letters.map((c) => (
              <li key={c.id}>
                <span className="d">
                  {c.status === "sent"
                    ? c.sent_at
                      ? t("correspondence.sentOn", { date: date(c.sent_at) })
                      : t("correspondence.sent")
                    : c.scheduled_label ?? (session.isTeam ? t("correspondence.toConfirm") : t("correspondence.toCome"))}
                </span>
                <span>
                  {c.title}
                  {session.isTeam && staleLine(c) && (
                    <em className="team-only" style={{ marginLeft: 8, fontSize: 12, color: "var(--bronze)" }}>
                      {t("correspondence.toConfirm")}
                    </em>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── II. Guest communication — the list, the house's craft ──── */}
      {heroEvents.length > 0 && (
        <div className="grid3" style={{ marginBottom: 18 }}>
          {heroEvents.map((event) => {
            const c = countFor(event.id);
            return (
              <div className="card" style={{ marginBottom: 0 }} key={event.id}>
                <div className="eyebrow">{event.name}</div>
                <div className="serif num" style={{ fontSize: 34 }}>{c.confirmed}</div>
                <span style={{ fontSize: 12, color: "var(--ink2)" }}>
                  {tg("confirmedOf", { total: c.invited })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <AddGuestForm
        weddingId={wedding.id}
        events={allEvents}
        languages={wedding.languages}
        aiSuggest={session.isTeam}
      />

      {/* The team works the sheet; the couple keeps their list. The
          Client-view preview renders the couple's reading too — the
          scope taught us a hidden branch is a broken preview. */}
      {session.isTeam ? (
        <>
          <GuestSheet weddingId={wedding.id} guests={allGuests} events={allEvents} links={links} />
          {gridReady && (
            <GuestGrid
              weddingId={wedding.id}
              events={allEvents}
              households={allGuests}
              persons={personsAll}
              statuses={statusesAll}
            />
          )}
          <div className="client-preview">
            <GuestList
              weddingId={wedding.id}
              guests={allGuests}
              events={allEvents}
              links={links}
              canManage={false}
            />
          </div>
        </>
      ) : (
        <GuestList
          weddingId={wedding.id}
          guests={allGuests}
          events={allEvents}
          links={links}
          canManage={!session.isCoordinator}
        />
      )}

      {session.isTeam && <StationerReview weddingId={wedding.id} latestFlag={latestFlag} />}

      {/* ── III. Accommodation & Travel ────────────────────────────── */}
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 6 }}>{t("accommodation.title")}</div>
        <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16 }}>{t("accommodation.blurb")}</p>
        <div className="grid2">
          <div style={{ border: "1px solid var(--line)", padding: "20px 22px" }}>
            <div className="eyebrow">{t("accommodation.blocking")}</div>
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 12px" }}>
              {t("accommodation.blockingBlurb")}
            </p>
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>{t("accommodation.hotel")}</th>
                  <th>{t("accommodation.held")}</th>
                  <th>{t("accommodation.cutoff")}</th>
                </tr>
              </thead>
              <tbody>
                {((blocks ?? []) as HotelBlock[]).map((block) => (
                  <tr key={block.id}>
                    <td>{block.hotel}</td>
                    <td className="num">{block.rooms_held}</td>
                    <td>{date(block.cutoff_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 12 }}>
              <span className="tag ok">{t("accommodation.active")}</span>
            </div>
          </div>
          <div style={{ border: "1px dashed var(--line)", padding: "20px 22px", background: "var(--parchment)" }}>
            <div className="eyebrow">{t("accommodation.rooming")}</div>
            <p style={{ fontSize: 13, color: "var(--ink2)", margin: "8px 0 12px" }}>
              {t("accommodation.roomingBlurb")}
            </p>
            {opened ? (
              <span className="tag ok">{t("accommodation.open")}</span>
            ) : (
              <span className="tag wait">{t("accommodation.opensOnWord")}</span>
            )}
            {session.isPrincipal && !opened && <OpenRoomingButton weddingId={wedding.id} />}
          </div>
        </div>
      </div>

      {session.isTeam && <HotelDesk weddingId={wedding.id} sample={t("hotelDesk.sample")} />}

      {session.isTeam && (
        <div className="ia team-only" style={{ marginTop: 14 }}>
          <div className="eyebrow">
            {tg("travelPlanning.title")} <span className="tag int">{tc("internal")}</span>
          </div>
          <p style={{ marginTop: 8, fontSize: 13.5 }}>{tg("travelPlanning.blurb")}</p>
        </div>
      )}
    </section>
  );
}
