import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/lib/types";
import { DocumentsRoom, InternalRegister } from "./documents-client";

/**
 * The Documents room. The page answers one question for the couple —
 * everything the house has placed in their hands — and every paper is
 * one click from a real download, judged server-side at each call.
 * The team additionally sees the internal register and the publish
 * gesture; Drive stays the house's backstage, never the client's.
 */
export default async function DocumentsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("documents");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("wedding_id", wedding.id)
    .order("created_at", { ascending: false });

  const all = (documents ?? []) as DocumentRow[];
  const internal = all.filter((d) => d.internal);

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>

      <DocumentsRoom documents={all} isTeam={session.isTeam} />

      {session.isTeam && <InternalRegister documents={internal} />}

      {session.isTeam && (wedding.drive_folder_shared_id || wedding.drive_folder_internal_id) && (
        <div className="card team-only">
          <div className="eyebrow">{t("backstage")}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {wedding.drive_folder_shared_id && (
              <a
                className="btn ghost sm"
                href={`https://drive.google.com/drive/folders/${wedding.drive_folder_shared_id}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("openDrive")}
              </a>
            )}
            {wedding.drive_folder_internal_id && (
              <a
                className="btn ghost sm"
                href={`https://drive.google.com/drive/folders/${wedding.drive_folder_internal_id}`}
                target="_blank"
                rel="noreferrer"
              >
                {t("openDriveInternal")}
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
