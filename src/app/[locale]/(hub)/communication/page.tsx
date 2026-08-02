import { getTranslations, setRequestLocale, getFormatter } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type {
  Correspondence, Guest, GuestEvent, GuestPerson, HotelBlock,
  PersonEventStatus, WeddingEvent
} from "@/lib/types";
import { HotelDesk, OpenRoomingButton } from "./communication-client";
import { AddGuestForm, GuestList } from "./guests-client";
import { CommunicationTabs } from "./communication-tabs";

/**
 * Wedding Communication — one module for the whole conversation with
 * the guests (final prompt): Overview · Guest list · The Grid ·
 * Accommodation, under Estelle's hand at any hour. The couple keeps
 * their own quiet page; the Client-view preview renders it faithfully.
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
    // grid simply shows its patience.
    supabase.from("guest_persons").select("*").eq("wedding_id", wedding.id),
    supabase.from("person_event_status").select("*").eq("wedding_id", wedding.id)
  ]);

  const allEvents = ((events ?? []) as WeddingEvent[]).filter((e) => !e.archived);
  const allGuests = (guests ?? []) as Guest[];
  const links = (guestEvents ?? []) as GuestEvent[];
  const letters = (correspondence ?? []) as Correspondence[];
  const opened = roomingState?.opened ?? false;
  const gridReady = !personsError;
  const personsAll = (gridPersons ?? []) as GuestPerson[];
  const statusesAll = (gridStatuses ?? []) as PersonEventStatus[];
  const hotelBlocks = (blocks ?? []) as HotelBlock[];
  const roomsHeld = hotelBlocks.filter((b) => b.active).reduce((s, b) => s + b.rooms_held, 0);
  const latestFlag = allGuests.map((g) => g.stationer_flag).filter(Boolean).at(-1) ?? null;

  const date = (iso: string | null) =>
    iso ? format.dateTime(new Date(iso), { month: "short", day: "numeric", year: "numeric" }) : "—";

  // The general volet stands alone or it lies: with no correspondence
  // at all, the couple is shown nothing — no shell.
  const staleLine = (c: Correspondence) => c.status !== "sent" && !c.scheduled_label;
  const generalForClient = letters.length > 0;

  const correspondenceCard = (forTeam: boolean) =>
    (generalForClient || forTeam) && (
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t("correspondence.title")}</div>
        {letters.length === 0 && forTeam && (
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
                  : c.scheduled_label ?? (forTeam ? t("correspondence.toConfirm") : t("correspondence.toCome"))}
              </span>
              <span>
                {c.title}
                {forTeam && staleLine(c) && (
                  <em className="team-only" style={{ marginLeft: 8, fontSize: 12, color: "var(--bronze)" }}>
                    {t("correspondence.toConfirm")}
                  </em>
                )}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );

  const accommodationSection = (
    <>
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
                {hotelBlocks.map((block) => (
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
    </>
  );

  const weddingLine = `${wedding.couple_display_name} · ${date(wedding.date_start)} · ${wedding.destination}`;

  /* ── the couple's page: quiet, published state only ── */
  const coupleView = (canManage: boolean) => (
    <>
      {correspondenceCard(false)}
      <AddGuestForm
        weddingId={wedding.id}
        events={allEvents.filter((e) => (e.visibility ?? "client") === "client")}
        languages={wedding.languages}
        aiSuggest={false}
      />
      <GuestList
        weddingId={wedding.id}
        guests={allGuests.filter((g) => !g.archived)}
        events={allEvents.filter((e) => (e.visibility ?? "client") === "client")}
        links={links}
        canManage={canManage}
      />
      {accommodationSection}
    </>
  );

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {session.isTeam ? (
        <>
          <CommunicationTabs
            weddingId={wedding.id}
            weddingLine={weddingLine}
            events={allEvents}
            households={allGuests}
            persons={gridReady ? personsAll : []}
            statuses={gridReady ? statusesAll : []}
            links={links}
            roomsHeld={roomsHeld}
            latestFlag={latestFlag}
            correspondence={correspondenceCard(true)}
            accommodation={accommodationSection}
          />
          {/* The couple's reading, faithful — a hidden branch is a
              broken preview (the scope lesson). */}
          <div className="client-preview">{coupleView(false)}</div>
        </>
      ) : (
        coupleView(!session.isCoordinator)
      )}
    </section>
  );
}
