import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { Vendor, VendorDocument } from "@/lib/types";
import { AddVendor, DocChip, OutreachComposer, StageSelect, VendorDocDrop } from "./vendors-client";

export default async function VendorsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("vendors");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const [{ data: vendors }, { data: docs }] = await Promise.all([
    supabase.from("vendors").select("*").eq("wedding_id", wedding.id).order("created_at"),
    supabase.from("vendor_documents").select("*").eq("wedding_id", wedding.id)
  ]);

  const allVendors = (vendors ?? []) as Vendor[];
  const docsFor = (id: string) =>
    ((docs ?? []) as VendorDocument[]).filter((d) => d.vendor_id === id);

  const stageTag = (stage: Vendor["stage"]) =>
    stage === "contracted" ? (
      <span className="tag ok">{t("stages.contracted")}</span>
    ) : stage === "proposal" ? (
      <span className="tag wait">{t("stages.proposalReceived")}</span>
    ) : (
      <span className="tag">{t(`stages.${stage}`)}</span>
    );

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <div className="card">
        <div style={{ overflowX: "auto" }}>
          <table className="sheet-table">
            <thead>
              <tr>
                <th>{t("vendor")}</th>
                <th>{t("category")}</th>
                <th>{t("status")}</th>
                <th>{t("documents")}</th>
                {session.isTeam && <th className="team-only">{t("pipeline")}</th>}
              </tr>
            </thead>
            <tbody>
              {allVendors.map((vendor) => (
                <tr key={vendor.id}>
                  <td>{vendor.name}</td>
                  <td>{vendor.category}</td>
                  <td>{stageTag(vendor.stage)}</td>
                  <td>
                    {docsFor(vendor.id).length === 0 ? (
                      <span style={{ fontSize: 12, color: "var(--ink2)" }}>—</span>
                    ) : (
                      docsFor(vendor.id).map((doc) =>
                        session.isTeam ? (
                          <DocChip
                            key={doc.id}
                            docId={doc.id}
                            typeLabel={t(`docTypes.${doc.type}`)}
                            label={doc.label}
                          />
                        ) : (
                          <span key={doc.id} className="doc">
                            {t(`docTypes.${doc.type}`)} <em>{doc.label}</em>
                          </span>
                        )
                      )
                    )}
                  </td>
                  {session.isTeam && (
                    <td className="team-only">
                      <StageSelect vendor={vendor} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {session.isTeam && <AddVendor weddingId={wedding.id} />}
      </div>

      <div className="ia">
        <div className="eyebrow">{t("reading.title")}</div>
        <p style={{ marginTop: 8, fontSize: 13.5 }}>{t("reading.blurb")}</p>
      </div>

      {session.isTeam && (
        <>
          <VendorDocDrop weddingId={wedding.id} vendors={allVendors} />
          <OutreachComposer weddingId={wedding.id} vendors={allVendors} />
        </>
      )}
    </section>
  );
}
