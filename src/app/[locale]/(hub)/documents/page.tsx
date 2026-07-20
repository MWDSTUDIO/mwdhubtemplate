import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireHouseSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { DocumentRow } from "@/lib/types";

export default async function DocumentsPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireHouseSession();
  const t = await getTranslations("documents");
  const tc = await getTranslations("common");
  const { wedding } = session;
  if (!wedding) return null;

  const supabase = await createClient();
  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("wedding_id", wedding.id)
    .order("created_at", { ascending: false });

  const all = (documents ?? []) as DocumentRow[];
  const shared = all.filter((d) => !d.internal);
  const internal = all.filter((d) => d.internal);
  const driveUrl = wedding.drive_folder_shared_id
    ? `https://drive.google.com/drive/folders/${wedding.drive_folder_shared_id}`
    : null;

  // Filed originals live in Storage — a signed hour-long link each,
  // minted under the caller's own rights (RLS holds at the bucket).
  const signedUrls = new Map<string, string>();
  await Promise.all(
    all
      .filter((d) => d.storage_path)
      .map(async (d) => {
        const [bucket, ...rest] = d.storage_path!.split("/");
        const { data } = await supabase.storage.from(bucket).createSignedUrl(rest.join("/"), 3600);
        if (data?.signedUrl) signedUrls.set(d.id, data.signedUrl);
      })
  );

  const item = (doc: DocumentRow) => {
    const href = doc.url ?? signedUrls.get(doc.id);
    return (
      <li key={doc.id}>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            {doc.label}
          </a>
        ) : (
          <span>{doc.label}</span>
        )}
      </li>
    );
  };

  return (
    <section className="sheet">
      <div className="eyebrow">{t("eyebrow")}</div>
      <h1 className="title">{t("headline")}</h1>
      <p className="lead">{t("lead")}</p>
      <div className="grid2">
        <div className="card">
          <div className="eyebrow">{t("shared")}</div>
          <ul className="steps" style={{ marginTop: 12 }}>
            {shared.map(item)}
          </ul>
          {driveUrl && (
            <>
              <hr className="hair" />
              <a className="btn ghost" href={driveUrl} target="_blank" rel="noreferrer">
                {t("openDrive")}
              </a>
            </>
          )}
        </div>
        {session.isTeam && (
          <div className="card team-only">
            <div className="eyebrow">
              {t("internal")} <span className="tag int">{tc("internal")}</span>
            </div>
            <ul className="steps" style={{ marginTop: 12 }}>
              {internal.map(item)}
            </ul>
            {wedding.drive_folder_internal_id && (
              <>
                <hr className="hair" />
                <a
                  className="btn ghost"
                  href={`https://drive.google.com/drive/folders/${wedding.drive_folder_internal_id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("openDrive")}
                </a>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
