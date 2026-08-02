import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { CeremonyList, type CeremonyBundle } from "@/components/CeremonyEditor";
import type {
  Ceremony,
  CeremonyDocumentLink,
  CeremonyFlowItem,
  CeremonyLogistic,
  CeremonyMusic,
  CeremonyParticipant,
  CeremonyReading
} from "@/lib/types";

/**
 * The Ceremony — the heart the whole weekend beats around. A living
 * operational object (PRD Ceremony): overview, participants, flow,
 * music, readings, papers, logistics, readiness, publication.
 */
export default async function CeremonyPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("ceremony");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: ceremonies }, partsRes, flowRes, musicRes, readRes, logRes, docLinksRes] = await Promise.all([
    supabase
      .from("ceremonies")
      .select("*")
      .eq("wedding_id", wedding.id)
      .order("ceremony_date", { ascending: true, nullsFirst: false })
      .order("sort"),
    // The sections are born with 0028 — the page keeps its manners before.
    supabase.from("ceremony_participants").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("ceremony_flow").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("ceremony_music").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("ceremony_readings").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("ceremony_logistics").select("*").eq("wedding_id", wedding.id).order("sort"),
    supabase.from("ceremony_documents").select("*").eq("wedding_id", wedding.id)
  ]);

  const participants = ((partsRes as { data: unknown }).data ?? []) as CeremonyParticipant[];
  const flow = ((flowRes as { data: unknown }).data ?? []) as CeremonyFlowItem[];
  const music = ((musicRes as { data: unknown }).data ?? []) as CeremonyMusic[];
  const readings = ((readRes as { data: unknown }).data ?? []) as CeremonyReading[];
  const logistics = ((logRes as { data: unknown }).data ?? []) as CeremonyLogistic[];
  const docLinks = ((docLinksRes as { data: unknown }).data ?? []) as CeremonyDocumentLink[];

  // The pickers reference the owning modules — people from the guest
  // sheets, vendors from Vendors, papers from Documents, lines from
  // Budget. Team material; the couple's reading never needs them.
  let people: { id: string; label: string }[] = [];
  let vendors: { id: string; name: string }[] = [];
  let documents: { id: string; label: string; internal: boolean }[] = [];
  let lines: { id: string; label: string }[] = [];
  if (session.isTeam) {
    const [personsRes, vendorsRes, docsRes, linesRes] = await Promise.all([
      supabase.from("guest_persons").select("id, full_name").eq("wedding_id", wedding.id).order("sort"),
      supabase.from("vendors").select("id, name").eq("wedding_id", wedding.id).eq("archived", false).order("name"),
      supabase.from("documents").select("id, label, internal").eq("wedding_id", wedding.id).order("created_at", { ascending: false }),
      supabase.from("budget_lines").select("id, label").eq("wedding_id", wedding.id).order("sort")
    ]);
    people = (((personsRes as { data: unknown }).data ?? []) as { id: string; full_name: string | null }[])
      .filter((p) => p.full_name?.trim())
      .map((p) => ({ id: p.id, label: p.full_name! }));
    let vendorRows = ((vendorsRes as { data: unknown }).data ?? []) as { id: string; name: string }[];
    if (!vendorRows.length && (vendorsRes as { error: unknown }).error) {
      // Pre-0026 the archived column is absent — the names still stand.
      const { data: bare } = await supabase.from("vendors").select("id, name").eq("wedding_id", wedding.id).order("name");
      vendorRows = (bare ?? []) as { id: string; name: string }[];
    }
    vendors = vendorRows;
    documents = ((docsRes as { data: unknown }).data ?? []) as { id: string; label: string; internal: boolean }[];
    lines = ((linesRes as { data: unknown }).data ?? []) as { id: string; label: string }[];
  } else {
    // The couple's reading joins names it may already read (RLS-bound).
    const [personsRes, docsRes] = await Promise.all([
      supabase.from("guest_persons").select("id, full_name").eq("wedding_id", wedding.id),
      supabase.from("documents").select("id, label, internal").eq("wedding_id", wedding.id)
    ]);
    people = (((personsRes as { data: unknown }).data ?? []) as { id: string; full_name: string | null }[])
      .filter((p) => p.full_name?.trim())
      .map((p) => ({ id: p.id, label: p.full_name! }));
    documents = ((docsRes as { data: unknown }).data ?? []) as { id: string; label: string; internal: boolean }[];
  }

  // What moved since the last published version (§22) — team's eyes.
  const changedByCeremony = new Map<string, string[]>();
  if (session.isTeam) {
    const { data: versions } = await supabase
      .from("publication_versions")
      .select("summary, snapshot, created_at")
      .eq("wedding_id", wedding.id)
      .eq("kind", "ceremony")
      .order("created_at", { ascending: false })
      .limit(60);
    for (const c of (ceremonies ?? []) as Ceremony[]) {
      // Whatever the current state, once a version was shown to the
      // couple, any drift from it is named (§22).
      const v = (versions ?? []).find((x) => (x.summary as { ceremonyId?: string } | null)?.ceremonyId === c.id);
      const snap = (v?.snapshot as { ceremony?: Record<string, unknown> } | null)?.ceremony;
      if (snap) {
        const moved: string[] = [];
        for (const k of ["kind", "title", "ceremony_date", "start_time", "venue", "officiant", "notes"] as const) {
          if ((snap[k] ?? null) !== (c[k] ?? null)) moved.push(k);
        }
        if (moved.length) changedByCeremony.set(c.id, moved);
      }
    }
  }

  const bundles: CeremonyBundle[] = ((ceremonies ?? []) as Ceremony[]).map((c) => ({
    ceremony: c,
    participants: participants.filter((x) => x.ceremony_id === c.id),
    flow: flow.filter((x) => x.ceremony_id === c.id),
    music: music.filter((x) => x.ceremony_id === c.id),
    readings: readings.filter((x) => x.ceremony_id === c.id),
    logistics: logistics.filter((x) => x.ceremony_id === c.id),
    documents: docLinks.filter((x) => x.ceremony_id === c.id),
    changed: changedByCeremony.get(c.id) ?? []
  }));

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      {bundles.length === 0 && !session.isTeam && (
        <div className="card">
          <p className="serif" style={{ fontSize: 18, fontStyle: "italic", color: "var(--ink2)" }}>
            {t("emptyClient")}
          </p>
        </div>
      )}

      <CeremonyList
        bundles={bundles}
        weddingId={wedding.id}
        isTeam={session.isTeam}
        people={people}
        vendors={vendors}
        documents={documents}
        lines={lines}
      />
    </section>
  );
}
