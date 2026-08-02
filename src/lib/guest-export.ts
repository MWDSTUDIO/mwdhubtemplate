import "server-only";
import type { Guest, GuestPerson, PersonEventStatus, WeddingEvent, HotelBlock } from "@/lib/types";

/**
 * The export desk's arithmetic (final prompt §B2) — every file a
 * recipient receives is computed here, server-side, from the state at
 * the instant of the click. One truth: the caterer's rollup is the
 * Grid's feet.
 */

export type ExportKind =
  | "stationer" | "caterer" | "venue" | "rooming" | "arrivals"
  | "labels" | "pending" | "declined" | "raw" | "custom" | "template";

export interface ExportData {
  households: Guest[];
  persons: GuestPerson[];
  statuses: PersonEventStatus[];
  events: WeddingEvent[];
  blocks: HotelBlock[];
}

type Status = "attending" | "pending" | "declined";
const norm = (s: string): Status => (s === "invited" ? "pending" : (s as Status));

export function buildStatusMap(statuses: PersonEventStatus[]) {
  const m = new Map<string, Status>();
  for (const s of statuses) m.set(`${s.person_id}:${s.event_id}`, norm(s.status));
  return m;
}

export function liveHouseholds(households: Guest[]) {
  return households.filter((g) => !g.archived);
}

export const householdLine = (g: Guest) =>
  g.invitation_line || [g.title, g.first_names, g.surname].filter(Boolean).join(" ") || "—";

const addressBlock = (g: Guest) =>
  [g.address, g.address_line2, [g.postal_code, g.city].filter(Boolean).join(" "), g.region, g.country]
    .filter(Boolean)
    .join(", ");

/** The Grid's feet, recomputed at the instant of the export. */
export function feet(d: ExportData, eventId: string) {
  const st = buildStatusMap(d.statuses);
  const byHH = new Map<string, GuestPerson[]>();
  for (const p of d.persons) {
    const l = byHH.get(p.household_id) ?? [];
    l.push(p);
    byHH.set(p.household_id, l);
  }
  let a = 0, p = 0, dcl = 0, kids = 0;
  const diets = new Map<string, number>();
  for (const g of liveHouseholds(d.households)) {
    const ps = byHH.get(g.id) ?? [];
    let any = false, childRows = 0;
    for (const person of ps) {
      const s = st.get(`${person.id}:${eventId}`);
      if (!s) continue;
      if (s === "attending") {
        if (person.kind === "child") { childRows++; kids++; } else a++;
        any = true;
        const diet = (person.dietary ?? "").trim();
        if (diet) diets.set(diet, (diets.get(diet) ?? 0) + 1);
      } else if (s === "pending") p++;
      else dcl++;
    }
    if (any && childRows === 0) kids += g.party_children ?? 0;
  }
  return { attending: a, pending: p, declined: dcl, kids, covers: a + kids, diets };
}

export interface Sheet {
  name: string;
  rows: (string | number | null)[][];
}

/** All the exportable fields for the custom file, in display order. */
export const CUSTOM_FIELDS: { key: string; label: string; value: (g: Guest) => string | number }[] = [
  { key: "line", label: "Invitation line", value: householdLine },
  { key: "title", label: "Title", value: (g) => g.title ?? "" },
  { key: "first_names", label: "First names", value: (g) => g.first_names ?? "" },
  { key: "surname", label: "Surname", value: (g) => g.surname ?? "" },
  { key: "suffix", label: "Suffix", value: (g) => g.suffix ?? "" },
  { key: "email", label: "Email", value: (g) => g.email ?? "" },
  { key: "phone", label: "Telephone", value: (g) => g.phone ?? "" },
  { key: "address", label: "Address", value: addressBlock },
  { key: "city", label: "City", value: (g) => g.city ?? "" },
  { key: "country", label: "Country", value: (g) => g.country ?? "" },
  { key: "locale", label: "Language", value: (g) => g.locale },
  { key: "side", label: "Side", value: (g) => g.side ?? "" },
  { key: "category", label: "Category", value: (g) => g.category ?? "" },
  { key: "vip", label: "VIP", value: (g) => (g.vip ? "yes" : "") },
  { key: "adults", label: "Adults", value: (g) => g.party_adults ?? 1 },
  { key: "children", label: "Children", value: (g) => g.party_children ?? 0 },
  { key: "dietary", label: "Dietary (household note)", value: (g) => g.dietary ?? "" },
  { key: "travel", label: "Travel & stay", value: (g) => g.travel ?? "" },
  { key: "wished", label: "Accommodation wished", value: (g) => (g.accommodation_wished ? "yes" : "") }
];

/** The import template's columns — one per household field, then one per event. */
export function templateSheet(events: WeddingEvent[]): Sheet {
  const headers = [
    "Household", "Title", "First names", "Surname", "Suffix", "Email", "Phone",
    "Address", "Address line 2", "City", "Postcode", "Region", "Country",
    "Language", "Side", "Relationship", "Category", "Adults", "Children",
    "Dietary", "Accommodation wished", "Notes",
    ...events.map((e) => `Invited: ${e.name}`)
  ];
  const example = [
    "Mitchell", "Dr.", "Sarah and James", "Mitchell", "", "mitchell@example.com", "+1 212 000 0000",
    "128 Charles Street", "", "New York", "10014", "NY", "United States",
    "en", "hers", "College friends", "Friends", 2, 0,
    "vegetarian (Sarah)", "yes", "",
    ...events.map(() => "yes")
  ];
  return { name: "Guest list", rows: [headers, example] };
}

const statusWord = (s: Status | undefined) =>
  s === "attending" ? "Attending" : s === "declined" ? "Declined" : s === "pending" ? "Pending" : "";

/** Builds the sheets of one export. Every kind answers with ≥1 sheet. */
export function buildExport(
  kind: ExportKind,
  d: ExportData,
  opts: { eventId?: string; fields?: string[]; wishedOnly?: boolean }
): Sheet[] {
  const hhs = liveHouseholds(d.households);
  const st = buildStatusMap(d.statuses);
  const byHH = new Map<string, GuestPerson[]>();
  for (const p of d.persons) {
    const l = byHH.get(p.household_id) ?? [];
    l.push(p);
    byHH.set(p.household_id, l);
  }
  const events = opts.eventId ? d.events.filter((e) => e.id === opts.eventId) : d.events;
  const anyPending = (g: Guest) =>
    (byHH.get(g.id) ?? []).some((p) => d.events.some((e) => st.get(`${p.id}:${e.id}`) === "pending"));

  switch (kind) {
    case "stationer":
      return [{
        name: "Stationer",
        rows: [
          ["Invitation line", "Address", "Language"],
          ...hhs.map((g) => [householdLine(g), addressBlock(g), g.locale])
        ]
      }];

    case "caterer":
      return events.map((ev) => {
        const f = feet(d, ev.id);
        const detail: (string | number | null)[][] = [];
        for (const g of hhs) {
          for (const p of byHH.get(g.id) ?? []) {
            const s = st.get(`${p.id}:${ev.id}`);
            if (!s) continue;
            detail.push([
              p.full_name || householdLine(g),
              p.kind === "child" ? "child" : "adult",
              statusWord(s),
              p.dietary ?? "",
              p.accessibility ?? ""
            ]);
          }
        }
        return {
          name: ev.name.slice(0, 28),
          rows: [
            [`DIETARY ROLLUP — ${ev.name}`],
            ...[...f.diets].map(([k, v]) => [k, v] as (string | number)[]),
            ["Covers (attending)", f.covers],
            [`${f.attending} adults attending · ${f.kids} children · ${f.pending} pending · ${f.declined} declined`],
            [],
            ["Guest", "Adult/child", "Status", "Dietary", "Accessibility"],
            ...detail
          ]
        };
      });

    case "venue":
      return [{
        name: "Counts",
        rows: [
          ["Event", "Date", "Attending", "Pending", "Declined", "Children", "Covers"],
          ...d.events.map((ev) => {
            const f = feet(d, ev.id);
            return [ev.name, ev.event_date ?? "", f.attending, f.pending, f.declined, f.kids, f.covers];
          })
        ]
      }];

    case "rooming":
      return [{
        name: "Rooming",
        rows: [
          ["Household", "Adults", "Children", "Accommodation wished", "Travel & stay note"],
          ...hhs
            .filter((g) => g.accommodation_wished || g.travel)
            .map((g) => [householdLine(g), g.party_adults ?? 1, g.party_children ?? 0, g.accommodation_wished ? "yes" : "", g.travel ?? ""])
        ]
      }];

    case "arrivals":
      return [{
        name: "Arrivals & departures",
        rows: [
          ["Household", "Travel & stay note", "Adults", "Children"],
          ...hhs.filter((g) => g.travel).map((g) => [householdLine(g), g.travel ?? "", g.party_adults ?? 1, g.party_children ?? 0])
        ]
      }];

    case "labels":
      return [{
        name: "Mailing",
        rows: [
          ["Invitation line", "Address", "Address line 2", "City", "Postcode", "Region", "Country"],
          ...hhs.map((g) => [householdLine(g), g.address ?? "", g.address_line2 ?? "", g.city ?? "", g.postal_code ?? "", g.region ?? "", g.country ?? ""])
        ]
      }];

    case "pending":
      return [{
        name: "Pending",
        rows: [
          ["Household", "Email", "Telephone"],
          ...hhs.filter(anyPending).map((g) => [householdLine(g), g.email ?? "", g.phone ?? ""])
        ]
      }];

    case "declined": {
      const declinedRows = hhs
        .map((g) => {
          const ps = byHH.get(g.id) ?? [];
          const words = d.events
            .map((ev) => ({ ev, n: ps.filter((p) => st.get(`${p.id}:${ev.id}`) === "declined").length }))
            .filter((x) => x.n > 0)
            .map((x) => `${x.ev.name} (${x.n})`);
          return words.length ? [householdLine(g), words.join(" · ")] : null;
        })
        .filter(Boolean) as (string | number | null)[][];
      return [{ name: "Declined", rows: [["Household", "Declined at"], ...declinedRows] }];
    }

    case "raw":
      return [{
        name: "Guest list",
        rows: [
          [...CUSTOM_FIELDS.map((f) => f.label), ...d.events.map((e) => `RSVP: ${e.name}`)],
          ...hhs.map((g) => [
            ...CUSTOM_FIELDS.map((f) => f.value(g)),
            ...d.events.map((ev) => {
              const ps = byHH.get(g.id) ?? [];
              const ss = ps.map((p) => st.get(`${p.id}:${ev.id}`)).filter(Boolean) as Status[];
              if (!ss.length) return "";
              const a = ss.filter((s) => s === "attending").length;
              return a === ss.length ? "Attending" : a ? `${a}/${ss.length} attending` : ss.every((s) => s === "declined") ? "Declined" : "Pending";
            })
          ])
        ]
      }];

    case "custom": {
      const fields = CUSTOM_FIELDS.filter((f) => (opts.fields ?? []).includes(f.key));
      const chosen = fields.length ? fields : CUSTOM_FIELDS;
      let rows = hhs;
      if (opts.wishedOnly) rows = rows.filter((g) => g.accommodation_wished);
      if (opts.eventId) {
        rows = rows.filter((g) =>
          (byHH.get(g.id) ?? []).some((p) => st.get(`${p.id}:${opts.eventId as string}`))
        );
      }
      return [{
        name: "Custom",
        rows: [chosen.map((f) => f.label), ...rows.map((g) => chosen.map((f) => f.value(g)))]
      }];
    }

    case "template":
      return [templateSheet(d.events)];
  }
}

/** The completeness eye (§B3): flags, never blocks — Estelle decides. */
export function completeness(kind: ExportKind, d: ExportData) {
  const hhs = liveHouseholds(d.households);
  if (kind === "stationer" || kind === "labels") {
    const missing = hhs.filter((g) => !(g.address || g.city));
    return missing.map((g) => householdLine(g));
  }
  if (kind === "caterer") {
    const st = buildStatusMap(d.statuses);
    const byHH = new Map<string, GuestPerson[]>();
    for (const p of d.persons) {
      const l = byHH.get(p.household_id) ?? [];
      l.push(p);
      byHH.set(p.household_id, l);
    }
    return hhs
      .filter((g) => {
        const ps = byHH.get(g.id) ?? [];
        const attending = ps.some((p) => d.events.some((e) => st.get(`${p.id}:${e.id}`) === "attending"));
        return attending && (g.party_adults == null && !ps.length);
      })
      .map((g) => householdLine(g));
  }
  if (kind === "rooming") {
    return hhs.filter((g) => g.accommodation_wished && !g.travel).map((g) => householdLine(g));
  }
  return [];
}
