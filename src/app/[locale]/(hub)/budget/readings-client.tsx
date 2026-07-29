"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { acceptReading, dismissReading, type ReadingInstalment, type ReadingItem } from "@/app/actions/readings";

export interface ReadingPayload {
  doc_type?: string;
  vendor_name?: string | null;
  currency?: string | null;
  total_ht?: number | null;
  total_ttc?: number | null;
  total_amount?: number | null;
  vat_summary?: { rate: number; base?: number | null; amount?: number | null }[] | null;
  service_charge?: { pct?: number | null; amount?: number | null } | null;
  minimum_spend?: number | null;
  buyout?: number | null;
  deposit?: { amount?: number | null; refundable?: boolean | null; deadline?: string | null } | null;
  cancellation_terms?: string | null;
  validity_date?: string | null;
  banking?: { iban?: string | null; swift?: string | null } | null;
  schedule?: ReadingInstalment[];
  items?: ReadingItem[];
  terms?: string | null;
  confidence?: { vendor?: number; totals?: number; items?: number; schedule?: number };
  flagged?: { field: string; reason: string; quote?: string }[];
  items_lost?: boolean;
}

export interface ReadingRow {
  id: string;
  label: string;
  created_at: string;
  vendorName: string | null;
  payload: ReadingPayload;
  current: {
    committed: number | null;
    itemsCount: number;
    itemsTotal: number;
    paymentsCount: number;
    paymentsTotal: number;
  };
}

/**
 * The analyst's desk (brief C6): each reading sits beside what the hub
 * already holds, and Estelle accepts line by line or in one gesture.
 * The agent proposes; it never decrees.
 */
export function ReadingsDesk({ readings }: { readings: ReadingRow[] }) {
  const t = useTranslations("budget.readings");
  if (readings.length === 0) return null;
  return (
    <div className="card team-only" style={{ marginBottom: 14 }}>
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("awaiting", { count: readings.length })}</span>
      </div>
      <p style={{ margin: "8px 0 4px", fontSize: 13.5, color: "var(--ink2)" }}>{t("blurb")}</p>
      {readings.map((r) => (
        <Reading key={r.id} reading={r} />
      ))}
    </div>
  );
}

function Reading({ reading }: { reading: ReadingRow }) {
  const t = useTranslations("budget.readings");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const p = reading.payload;
  const cur = reading.current;
  const currency = p.currency ?? "EUR";

  const money = (n: number | null | undefined) =>
    n == null ? "—" : format.number(n, { style: "currency", currency, maximumFractionDigits: 0 });

  const items = p.items ?? [];
  const schedule = p.schedule ?? [];
  const [acceptLine, setAcceptLine] = useState(true);
  const [itemSel, setItemSel] = useState<boolean[]>(items.map(() => true));
  const [schedSel, setSchedSel] = useState<boolean[]>(schedule.map(() => true));
  const [acceptBanking, setAcceptBanking] = useState(Boolean(p.banking?.iban || p.banking?.swift));
  const [acceptMinSpend, setAcceptMinSpend] = useState(false);

  const itemsTotal = items.reduce((s, it) => s + Number(it.total_ttc ?? it.total_ht ?? 0), 0);
  const schedTotal = schedule.reduce((s, x) => s + Number(x.amount ?? 0), 0);
  const docTotal = p.total_amount ?? p.total_ttc ?? null;
  const conf = p.confidence ?? {};
  const lowConf = Object.entries(conf).filter(([, v]) => typeof v === "number" && v < 0.7);

  const compareRow = (label: string, doc: string, hub: string) => (
    <tr>
      <td>{label}</td>
      <td className="num" style={{ fontWeight: 500 }}>{doc}</td>
      <td className="num" style={{ color: "var(--ink2)" }}>{hub}</td>
    </tr>
  );

  return (
    <div style={{ marginTop: 16 }}>
      <hr className="hair" style={{ margin: "0 0 12px" }} />
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14.5 }}>{reading.label}</strong>
        {reading.vendorName && <span style={{ fontSize: 13, color: "var(--ink2)" }}>{reading.vendorName}</span>}
        <span style={{ fontSize: 12, color: "var(--ink2)" }}>
          {format.dateTime(new Date(reading.created_at), { day: "numeric", month: "long" })}
        </span>
        {lowConf.map(([k]) => (
          <span key={k} className="tag wait">{t("lowConfidence", { field: t(`conf.${k}`) })}</span>
        ))}
        {p.items_lost && <span className="tag alert">{t("itemsLost")}</span>}
      </div>

      <div style={{ overflowX: "auto", marginTop: 10 }}>
        <table className="sheet-table" style={{ background: "#fff", fontSize: 13 }}>
          <thead>
            <tr>
              <th></th>
              <th className="num">{t("docSays")}</th>
              <th className="num">{t("hubHolds")}</th>
            </tr>
          </thead>
          <tbody>
            {compareRow(
              t("committed"),
              docTotal != null ? money(docTotal) : "—",
              cur.committed != null ? money(cur.committed) : t("nothingYet")
            )}
            {compareRow(
              t("subLines"),
              items.length ? `${items.length} · ${money(itemsTotal)}` : "—",
              cur.itemsCount ? `${cur.itemsCount} · ${money(cur.itemsTotal)}` : t("nothingYet")
            )}
            {compareRow(
              t("instalments"),
              schedule.length ? `${schedule.length} · ${money(schedTotal)}` : "—",
              cur.paymentsCount ? `${cur.paymentsCount} · ${money(cur.paymentsTotal)}` : t("nothingYet")
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, fontSize: 12.5, color: "var(--ink2)" }}>
        {p.total_ht != null && <span>HT {money(p.total_ht)}</span>}
        {(p.vat_summary ?? []).map((v, i) => (
          <span key={i}>{t("vat")} {v.rate}% {v.amount != null ? `· ${money(v.amount)}` : ""}</span>
        ))}
        {p.service_charge?.pct != null && <span>{t("serviceCharge")} {p.service_charge.pct}%</span>}
        {p.buyout != null && <span>{t("buyout")} {money(p.buyout)}</span>}
        {p.deposit?.amount != null && (
          <span>
            {t("deposit")} {money(p.deposit.amount)}
            {p.deposit.refundable != null && ` · ${p.deposit.refundable ? t("refundable") : t("nonRefundable")}`}
          </span>
        )}
        {p.validity_date && <span>{t("validUntil", { date: p.validity_date })}</span>}
      </div>
      {p.cancellation_terms && (
        <p style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 6 }}>{t("cancellation")} : {p.cancellation_terms}</p>
      )}

      <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, fontSize: 13 }}>
        <input type="checkbox" checked={acceptLine} onChange={(e) => setAcceptLine(e.target.checked)} />
        {t("acceptTotal", { amount: docTotal != null ? money(docTotal) : "—" })}
      </label>
      {p.minimum_spend != null && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 13 }}>
          <input type="checkbox" checked={acceptMinSpend} onChange={(e) => setAcceptMinSpend(e.target.checked)} />
          {t("acceptMinSpend", { amount: money(p.minimum_spend) })}
        </label>
      )}
      {(p.banking?.iban || p.banking?.swift) && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 13 }}>
          <input type="checkbox" checked={acceptBanking} onChange={(e) => setAcceptBanking(e.target.checked)} />
          {t("acceptBanking")}
        </label>
      )}

      {items.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="addnote" style={{ cursor: "pointer" }}>
            {t("reviewItems", { count: items.length })}
          </summary>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="sheet-table" style={{ background: "#fff", fontSize: 12.5 }}>
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} style={{ opacity: itemSel[i] ? 1 : 0.45 }}>
                    <td style={{ width: 26 }}>
                      <input
                        type="checkbox"
                        checked={itemSel[i]}
                        onChange={(e) => setItemSel((s) => s.map((v, j) => (j === i ? e.target.checked : v)))}
                        aria-label={it.label}
                      />
                    </td>
                    <td>{it.event ? <em style={{ color: "var(--bronze)" }}>{it.event} · </em> : null}{it.label}</td>
                    <td className="num">{it.qty != null ? `${it.qty} × ${money(it.unit_price)}` : ""}</td>
                    <td className="num">{it.total_ht != null ? `HT ${money(it.total_ht)}` : ""}</td>
                    <td className="num">{it.vat_pct != null ? `${t("vat")} ${it.vat_pct}%` : ""}</td>
                    <td className="num">{money(it.total_ttc ?? it.total_ht)}</td>
                    <td className="num" style={{ color: "var(--ink2)", fontSize: 12 }}>{it.page != null ? t("page", { n: it.page }) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {schedule.length > 0 && (
        <details style={{ marginTop: 8 }} open>
          <summary className="addnote" style={{ cursor: "pointer" }}>
            {t("reviewSchedule", { count: schedule.length })}
          </summary>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="sheet-table" style={{ background: "#fff", fontSize: 12.5 }}>
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} style={{ opacity: schedSel[i] ? 1 : 0.45 }}>
                    <td style={{ width: 26 }}>
                      <input
                        type="checkbox"
                        checked={schedSel[i]}
                        onChange={(e) => setSchedSel((x) => x.map((v, j) => (j === i ? e.target.checked : v)))}
                        aria-label={s.label}
                      />
                    </td>
                    <td>{s.label}</td>
                    <td className="num">{money(s.amount)}{s.percentage != null ? ` (${s.percentage}%)` : ""}</td>
                    <td>
                      {s.due_date ? (
                        format.dateTime(new Date(s.due_date), { day: "numeric", month: "short", year: "numeric" })
                      ) : s.trigger ? (
                        <em style={{ color: "var(--bronze)" }}>{s.trigger}</em>
                      ) : (
                        <span className="tag wait">{t("noDate")}</span>
                      )}
                    </td>
                    <td>{s.refundable ? <span className="tag ok">{t("refundable")}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {(p.flagged ?? []).length > 0 && (
        <div style={{ marginTop: 10 }}>
          {(p.flagged ?? []).map((f, i) => (
            <p key={i} style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 4 }}>
              ⚠ <strong>{f.field}</strong> — {f.reason}
              {f.quote ? <span style={{ color: "var(--ink2)" }}> · «&nbsp;{f.quote}&nbsp;»</span> : null}
            </p>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        <button
          className="btn sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await acceptReading({
                readingId: reading.id,
                acceptLine,
                itemIdx: itemSel.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
                scheduleIdx: schedSel.map((v, i) => (v ? i : -1)).filter((i) => i >= 0),
                acceptBanking,
                acceptMinSpend
              });
              router.refresh();
            })
          }
        >
          {pending ? "…" : t("acceptSelection")}
        </button>
        <button
          className="btn ghost sm"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t("dismissConfirm"))) return;
            startTransition(async () => {
              await dismissReading(reading.id);
              router.refresh();
            });
          }}
        >
          {t("dismiss")}
        </button>
        <span style={{ fontSize: 12.5, color: "var(--ink2)", alignSelf: "center" }}>{t("draftNote")}</span>
      </div>
    </div>
  );
}
