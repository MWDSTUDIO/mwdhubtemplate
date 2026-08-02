"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { Guest, GuestEvent, GuestPerson, PersonEventStatus, WeddingEvent } from "@/lib/types";
import { saveHousehold, type HouseholdDrawerFields } from "@/app/actions/guests";
import { GuestSheet } from "./guest-sheet";
import { GuestGrid } from "./guest-grid";
import { StationerReview } from "./guests-client";

/**
 * Wedding Communication, the module (final prompt §A1) — one working
 * surface under tabs: Overview · Guest list · The Grid ·
 * Accommodation. Tabs never unmount, so switching never loses an
 * unsaved word. Team view only; the couple keeps their own page.
 */

type TabId = "overview" | "list" | "grid" | "acc";
type ListChips = { noaddr?: boolean; noemail?: boolean; pending?: boolean };

const US_TITLES = [
  "Ms.", "Mr.", "Mrs.", "Miss", "Mx.", "Mr. and Mrs.", "Dr.", "The Doctors",
  "The Honorable", "The Reverend", "Rabbi", "Cantor", "Captain", "Colonel",
  "Monsieur", "Madame", "Monsieur et Madame", "Maître"
];

export function CommunicationTabs({
  weddingId,
  weddingLine,
  events,
  households,
  persons,
  statuses,
  links,
  roomsHeld,
  latestFlag,
  correspondence,
  accommodation
}: {
  weddingId: string;
  weddingLine: string;
  events: WeddingEvent[];
  households: Guest[];
  persons: GuestPerson[];
  statuses: PersonEventStatus[];
  links: GuestEvent[];
  roomsHeld: number;
  latestFlag: string | null;
  correspondence: React.ReactNode;
  accommodation: React.ReactNode;
}) {
  const t = useTranslations("communication.module");
  const tg = useTranslations("guests.grid");
  const [tab, setTab] = useState<TabId>("overview");
  const [chips, setChips] = useState<ListChips>({});
  const [listSearch, setListSearch] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [toastMsg, setToastMsg] = useState("");
  const [drawer, setDrawer] = useState<null | { id: string | null }>(null);

  const live = useMemo(() => households.filter((g) => !g.archived), [households]);

  const toast = (m: string) => {
    setToastMsg(m);
    window.clearTimeout((toast as unknown as { x?: number }).x);
    (toast as unknown as { x?: number }).x = window.setTimeout(() => setToastMsg(""), 2400);
  };
  const onSaved = () => setSavedAt(new Date());

  /* ── shared arithmetic (the mock's feet, at module level) ── */
  const statusMap = useMemo(() => {
    const m = new Map<string, "attending" | "pending" | "declined">();
    for (const s of statuses) m.set(`${s.person_id}:${s.event_id}`, s.status === "invited" ? "pending" : s.status);
    return m;
  }, [statuses]);
  const byHousehold = useMemo(() => {
    const m = new Map<string, GuestPerson[]>();
    for (const p of persons) {
      const list = m.get(p.household_id) ?? [];
      list.push(p);
      m.set(p.household_id, list);
    }
    return m;
  }, [persons]);

  const feet = (eventId: string) => {
    let a = 0, p = 0, d = 0, kids = 0;
    for (const g of live) {
      const ps = byHousehold.get(g.id) ?? [];
      let any = false, childPersons = 0;
      for (const person of ps) {
        const s = statusMap.get(`${person.id}:${eventId}`);
        if (!s) continue;
        if (s === "attending") {
          if (person.kind === "child") { childPersons++; kids++; } else a++;
          any = true;
        } else if (s === "pending") p++;
        else d++;
      }
      if (any && childPersons === 0) kids += g.party_children ?? 0;
    }
    return { a, p, d, kids, covers: a + kids, inv: a + p + d };
  };

  const hasPending = (g: Guest) =>
    (byHousehold.get(g.id) ?? []).some((p) => events.some((e) => statusMap.get(`${p.id}:${e.id}`) === "pending"));
  const missingAddress = (g: Guest) => !(g.address || g.city);
  const missingEmail = (g: Guest) => !g.email;

  const pendingHH = live.filter(hasPending).length;
  const noAddr = live.filter(missingAddress).length;
  const noEmail = live.filter(missingEmail).length;
  const wished = live.filter((g) => g.accommodation_wished).length;
  const mainEvent = useMemo(
    () => [...events].sort((x, y) => feet(y.id).inv - feet(x.id).inv)[0] ?? events[0],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, statusMap, byHousehold]
  );

  /* ── guest list filtering (chips live at module level so the
        Overview's alerts can open the list already filtered) ── */
  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return live.filter((g) => {
      const name = (g.invitation_line || [g.first_names, g.surname].filter(Boolean).join(" ")).toLowerCase();
      if (q && !name.includes(q)) return false;
      if (chips.noaddr && !missingAddress(g)) return false;
      if (chips.noemail && !missingEmail(g)) return false;
      if (chips.pending && !hasPending(g)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, listSearch, chips, statusMap, byHousehold]);

  const goAlert = (target: TabId, chip?: keyof ListChips) => {
    setChips(chip ? { [chip]: true } : {});
    setTab(target);
  };

  const fmtTime = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  const card = (label: string, value: number | string, sub: string, warn?: boolean) => (
    <div className="card" style={{ marginBottom: 0, ...(warn ? { borderColor: "var(--bronze)" } : {}) }}>
      <span className="eyebrow" style={{ color: "var(--ink2)" }}>{label}</span>
      <b style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 300, fontSize: 32, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", ...(warn ? { color: "var(--bronze)" } : {}) }}>{value}</b>
      <span style={{ fontSize: 13, color: "var(--ink2)" }}>{sub}</span>
    </div>
  );

  const TABS: { id: TabId; label: string }[] = [
    { id: "overview", label: t("tabOverview") },
    { id: "list", label: t("tabList") },
    { id: "grid", label: t("tabGrid") },
    { id: "acc", label: t("tabAcc") }
  ];

  return (
    <div className="team-only">
      {/* ── topbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", alignItems: "baseline", borderBottom: "1px solid var(--line)", paddingBottom: 14, marginBottom: 4 }}>
        <span style={{ fontSize: 14, color: "var(--ink2)" }}>{weddingLine}</span>
        <span style={{ fontSize: 14, color: "var(--ink2)" }}>{t("statGuests")} <b style={{ color: "var(--hunter)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{persons.length}</b></span>
        <span style={{ fontSize: 14, color: "var(--ink2)" }}>{t("statHouseholds")} <b style={{ color: "var(--hunter)", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{live.length}</b></span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: "var(--bronze)" }} role="status">
          {savedAt ? t("savedAt", { time: fmtTime(savedAt) }) : t("savedAll")}
        </span>
        <button className="btn ghost sm" onClick={() => setDrawer({ id: null })}>{t("addHousehold")}</button>
      </div>

      {/* ── tabs ── */}
      <div className="tabs" role="tablist" style={{ marginBottom: 22 }}>
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            className="tab"
            onClick={() => setTab(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      <section hidden={tab !== "overview"}>
        {correspondence}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 26 }}>
          {card(t("cardGuests"), persons.length, t("cardGuestsSub"))}
          {card(t("cardHouseholds"), live.length, "")}
          {mainEvent && (() => { const f = feet(mainEvent.id); return card(t("cardAttending", { event: mainEvent.name }), f.covers, t("cardAttendingSub", { adults: f.a, children: f.kids })); })()}
          {card(t("cardPending"), pendingHH, t("households"), pendingHH > 0)}
          {card(t("cardNoEmail"), noEmail, t("households"), noEmail > 0)}
          {card(t("cardNoAddr"), noAddr, t("households"), noAddr > 0)}
          {card(t("cardWished"), wished, t("households"), false)}
          {card(t("cardRooms"), roomsHeld, t("cardRoomsSub"))}
        </div>

        <h2 className="serif" style={{ fontSize: 24, fontWeight: 500, margin: "0 0 12px" }}>{t("attendanceTitle")}</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14, marginBottom: 26 }}>
          {events.map((ev) => {
            const f = feet(ev.id);
            const pct = f.inv ? Math.round((f.a / f.inv) * 100) : 0;
            return (
              <div className="card" style={{ marginBottom: 0 }} key={ev.id}>
                <span className="eyebrow" style={{ color: "var(--ink2)" }}>{ev.name}</span>
                <b style={{ display: "block", fontFamily: "var(--font-display)", fontWeight: 300, fontSize: 32, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>{f.a}</b>
                <span style={{ fontSize: 13, color: "var(--ink2)" }}>{t("ofInvited", { n: f.inv, pct })}</span>
                <span style={{ display: "block", fontSize: 13, color: "var(--ink2)", marginTop: 4 }}>{t("pendDecl", { p: f.p, d: f.d })}</span>
                <div style={{ height: 5, background: "var(--parchment)", marginTop: 10 }} aria-hidden>
                  <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "var(--hunter)" }} />
                </div>
              </div>
            );
          })}
        </div>

        <h2 className="serif" style={{ fontSize: 24, fontWeight: 500, margin: "0 0 12px" }}>{t("attentionTitle")}</h2>
        <div className="tcard" style={{ marginBottom: 26 }}>
          {pendingHH + noAddr + noEmail + wished === 0 ? (
            <div className="alertrow"><span style={{ color: "var(--ink2)", fontStyle: "italic" }}>{t("attentionNothing")}</span></div>
          ) : (
            <>
              {pendingHH > 0 && alertRow(t("alertPending", { n: pendingHH }), () => goAlert("list", "pending"))}
              {noAddr > 0 && alertRow(t("alertNoAddr", { n: noAddr }), () => goAlert("list", "noaddr"))}
              {noEmail > 0 && alertRow(t("alertNoEmail", { n: noEmail }), () => goAlert("list", "noemail"))}
              {wished > 0 && alertRow(t("alertWished", { n: wished }), () => goAlert("acc"))}
            </>
          )}
        </div>
      </section>

      {/* ── GUEST LIST ── */}
      <section hidden={tab !== "list"}>
        <div className="toolrow" style={{ border: "1px solid var(--line)", borderBottom: 0, background: "var(--white, #fffdf9)" }}>
          <input
            type="search"
            value={listSearch}
            onChange={(e) => setListSearch(e.target.value)}
            placeholder={tg("search")}
            aria-label={tg("search")}
            style={{ minWidth: 200 }}
          />
          {(["noaddr", "noemail", "pending"] as (keyof ListChips)[]).map((c) => (
            <button key={c} className="chip" aria-pressed={!!chips[c]} onClick={() => setChips({ ...chips, [c]: !chips[c] })}>
              {t(`chip_${c}`)}
            </button>
          ))}
          {(chips.noaddr || chips.noemail || chips.pending || listSearch) && (
            <button className="addnote" onClick={() => { setChips({}); setListSearch(""); }}>{tg("clearFilters")}</button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{t("rowsShown", { n: filteredList.length })}</span>
        </div>
        <GuestSheet
          weddingId={weddingId}
          guests={filteredList}
          events={events}
          links={links}
          onEdit={(id) => setDrawer({ id })}
        />
        <StationerReview weddingId={weddingId} latestFlag={latestFlag} />
      </section>

      {/* ── THE GRID ── */}
      <section hidden={tab !== "grid"}>
        <GuestGrid
          weddingId={weddingId}
          events={events}
          households={live}
          persons={persons}
          statuses={statuses}
          onSaved={onSaved}
          toast={toast}
        />
      </section>

      {/* ── ACCOMMODATION ── */}
      <section hidden={tab !== "acc"}>{accommodation}</section>

      {/* ── drawer + scrim + toast ── */}
      {drawer && (
        <HouseholdDrawer
          weddingId={weddingId}
          household={drawer.id ? households.find((g) => g.id === drawer.id) ?? null : null}
          onClose={() => setDrawer(null)}
          onSaved={(created) => { setDrawer(null); onSaved(); toast(created ? t("toastAdded") : t("toastUpdated")); }}
        />
      )}
      <div
        role="status"
        style={{
          position: "fixed", left: "50%", bottom: 26, transform: `translateX(-50%) translateY(${toastMsg ? 0 : 20}px)`,
          background: "var(--hunter)", color: "var(--cream)", padding: "10px 22px", fontSize: 14,
          opacity: toastMsg ? 1 : 0, pointerEvents: "none", transition: "opacity .25s ease-out, transform .25s ease-out", zIndex: 60
        }}
      >
        {toastMsg}
      </div>
    </div>
  );

  function alertRow(text: string, open: () => void) {
    return (
      <div className="alertrow">
        <span>{text}</span>
        <button
          onClick={open}
          style={{ border: 0, background: "none", color: "var(--hunter)", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 500, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer" }}
        >
          {t("openList")}
        </button>
      </div>
    );
  }
}

/* ══════════ The household drawer (final prompt §A2) ══════════════ */

function HouseholdDrawer({
  weddingId,
  household,
  onClose,
  onSaved
}: {
  weddingId: string;
  household: Guest | null;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const t = useTranslations("communication.module.drawer");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [touchedLine, setTouchedLine] = useState(!!household?.invitation_line);
  const [f, setF] = useState<HouseholdDrawerFields>({
    title: household?.title ?? "Ms.",
    firstNames: household?.first_names ?? "",
    surname: household?.surname ?? "",
    suffix: household?.suffix ?? "",
    invitationLine: household?.invitation_line ?? "",
    email: household?.email ?? "",
    phone: household?.phone ?? "",
    address: household?.address ?? "",
    addressLine2: household?.address_line2 ?? "",
    city: household?.city ?? "",
    postalCode: household?.postal_code ?? "",
    region: household?.region ?? "",
    country: household?.country ?? "",
    locale: household?.locale ?? "en",
    side: household?.side ?? "",
    relationship: household?.relationship ?? "",
    category: household?.category ?? "",
    vip: household?.vip ?? false,
    accommodationWished: household?.accommodation_wished ?? false,
    partyChildren: household?.party_children ?? 0,
    notesInternal: household?.notes_internal ?? ""
  });

  /* The invitation line composes itself as you type — and stays
     entirely editable; a touched line is never overwritten. */
  const compose = (next: HouseholdDrawerFields) => {
    if (touchedLine) return next.invitationLine;
    const name = [next.firstNames, next.surname].filter(Boolean).join(" ");
    if (!name) return "";
    return `${next.title ? next.title + " " : ""}${name}${next.suffix ? ", " + next.suffix : ""}`;
  };
  const set = (k: keyof HouseholdDrawerFields, v: string | number | boolean) => {
    const next = { ...f, [k]: v } as HouseholdDrawerFields;
    if (k === "invitationLine") { setTouchedLine(true); setF(next); return; }
    next.invitationLine = compose(next);
    setF(next);
  };

  const label = (k: string) => (
    <span style={{ display: "block", fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 500, color: "var(--ink2)", margin: "13px 0 5px" }}>{t(k)}</span>
  );
  const inp = (k: keyof HouseholdDrawerFields, lab: string, type = "text") => (
    <label style={{ display: "block" }}>
      {label(lab)}
      <input
        type={type}
        value={String(f[k] ?? "")}
        onChange={(e) => set(k, type === "number" ? +e.target.value || 0 : e.target.value)}
        style={{ width: "100%", fontSize: 14, padding: "7px 10px" }}
      />
    </label>
  );

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(34,56,43,.25)", zIndex: 40 }}
        aria-hidden
      />
      <aside
        aria-label={t(household ? "editTitle" : "addTitle")}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(430px, 100%)",
          background: "var(--white, #fffdf9)", borderLeft: "1px solid var(--line)",
          padding: "24px 26px", overflow: "auto", zIndex: 50, boxShadow: "-12px 0 40px rgba(34,56,43,.12)"
        }}
      >
        <p className="eyebrow" style={{ color: "var(--bronze)", margin: 0 }}>{t(household ? "editTitle" : "addTitle")}</p>

        <label style={{ display: "block" }}>
          {label("title")}
          <select value={f.title} onChange={(e) => set("title", e.target.value)} style={{ width: "100%", fontSize: 14, padding: "7px 10px" }}>
            <option value="" />
            {US_TITLES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("firstNames", "firstNames")}
          {inp("surname", "surname")}
        </div>
        <label style={{ display: "block" }}>
          {label("suffix")}
          <select value={f.suffix} onChange={(e) => set("suffix", e.target.value)} style={{ width: "100%", fontSize: 14, padding: "7px 10px" }}>
            <option value="" />
            {["Jr.", "Sr.", "II", "III", "IV"].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        {inp("invitationLine", "invitationLine")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("email", "email", "email")}
          {inp("phone", "phone")}
        </div>
        {inp("address", "address")}
        {inp("addressLine2", "addressLine2")}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("city", "city")}
          {inp("postalCode", "postalCode")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {inp("region", "region")}
          {inp("country", "country")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <label style={{ display: "block" }}>
            {label("side")}
            <select value={f.side} onChange={(e) => set("side", e.target.value)} style={{ width: "100%", fontSize: 14, padding: "7px 10px" }}>
              <option value="" />
              <option value="hers">{t("sideHers")}</option>
              <option value="his">{t("sideHis")}</option>
              <option value="mutual">{t("sideMutual")}</option>
            </select>
          </label>
          {inp("category", "category")}
        </div>
        {inp("relationship", "relationship")}
        {inp("partyChildren", "children", "number")}
        {inp("notesInternal", "notes")}
        <div style={{ display: "flex", gap: 18, margin: "14px 0 4px" }}>
          <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked={f.vip} onChange={(e) => set("vip", e.target.checked)} /> {t("vip")}
          </label>
          <label style={{ display: "inline-flex", gap: 7, alignItems: "center", fontSize: 13.5 }}>
            <input type="checkbox" checked={f.accommodationWished} onChange={(e) => set("accommodationWished", e.target.checked)} /> {t("wished")}
          </label>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button
            className="btn sm"
            disabled={pending || (!f.firstNames.trim() && !f.surname.trim() && !f.invitationLine.trim())}
            onClick={() =>
              startTransition(async () => {
                const r = await saveHousehold(weddingId, household?.id ?? null, f);
                if (r.ok) { router.refresh(); onSaved(!household); }
              })
            }
          >
            {pending ? "…" : t("save")}
          </button>
          <button className="btn ghost sm" onClick={onClose}>{t("close")}</button>
        </div>
      </aside>
    </>
  );
}
