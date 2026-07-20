"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import type { VaultContract } from "@/lib/types";
import { addVaultContract, draftReminder, toggleInstalmentPaid } from "@/app/actions/vault";

export function VaultContracts({
  contracts,
  weddingId
}: {
  contracts: VaultContract[];
  weddingId: string | null;
}) {
  const t = useTranslations("vault");
  const format = useFormatter();
  const [reminder, setReminder] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const money = (n: number) =>
    format.number(n, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

  async function remind(contract: VaultContract, i: number) {
    if (!weddingId) return;
    const inst = contract.instalments[i];
    setBusyKey(`${contract.id}-${i}`);
    const r = await draftReminder(weddingId, contract.label, inst);
    setReminder(r.text);
    setBusyKey(null);
  }

  return (
    <>
      {contracts.map((contract) => (
        <div className="card" key={contract.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div className="eyebrow">{contract.label}</div>
            {contract.schedule_label && (
              <span style={{ fontSize: 12, color: "var(--ink2)" }} className="num">
                {contract.schedule_label}
              </span>
            )}
          </div>
          <table className="sheet-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>{t("instalment")}</th>
                <th>{t("amount")}</th>
                <th>{t("due")}</th>
                <th>{t("state")}</th>
                <th>{t("reminder")}</th>
              </tr>
            </thead>
            <tbody>
              {contract.instalments.map((inst, i) => (
                <tr key={i}>
                  <td>{inst.label}</td>
                  <td className="num">{money(inst.amount)}</td>
                  <td>{inst.due_date}</td>
                  <td>
                    <button
                      className={`tag${inst.paid ? " ok" : " wait"}`}
                      style={{ cursor: "pointer" }}
                      disabled={pending}
                      onClick={() => startTransition(() => toggleInstalmentPaid(contract.id, i))}
                    >
                      {inst.paid ? t("settledState") : t("openState")}
                    </button>
                  </td>
                  <td>
                    {!inst.paid && (
                      <button
                        className="addnote"
                        onClick={() => remind(contract, i)}
                        disabled={busyKey === `${contract.id}-${i}`}
                      >
                        {busyKey === `${contract.id}-${i}` ? "…" : t("draftReminder")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {reminder && (
        <div className="ia">
          <div className="eyebrow">{t("reminderDraft")}</div>
          <p className="ia-quote" style={{ marginTop: 10 }} aria-live="polite">
            &ldquo;{reminder}&rdquo;
          </p>
        </div>
      )}
      <AddContract weddingId={weddingId} />
    </>
  );
}

function AddContract({ weddingId }: { weddingId: string | null }) {
  const t = useTranslations("vault.add");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [schedule, setSchedule] = useState("");
  const [rows, setRows] = useState([{ label: "", amount: "", due_date: "" }]);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button className="btn ghost" onClick={() => setOpen(true)}>
        {t("open")}
      </button>
    );
  }

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 14 }}>{t("title")}</div>
      <div className="grid2" style={{ gap: 12 }}>
        <div className="field">
          <label className="eyebrow">{t("label")}</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow">{t("schedule")}</label>
          <input value={schedule} onChange={(e) => setSchedule(e.target.value)} placeholder={t("schedulePlaceholder")} />
        </div>
      </div>
      <div className="eyebrow" style={{ margin: "14px 0 8px" }}>{t("instalments")}</div>
      {rows.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <input
            placeholder={t("instLabel")}
            value={row.label}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            style={{ flex: 2, minWidth: 120, padding: "9px 10px", border: "1px solid var(--line)" }}
          />
          <input
            type="number"
            placeholder="€"
            value={row.amount}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
            style={{ flex: 1, minWidth: 90, padding: "9px 10px", border: "1px solid var(--line)" }}
          />
          <input
            type="date"
            value={row.due_date}
            onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, due_date: e.target.value } : x)))}
            style={{ flex: 1, minWidth: 130, padding: "9px 10px", border: "1px solid var(--line)" }}
          />
        </div>
      ))}
      <button className="addnote" onClick={() => setRows((r) => [...r, { label: "", amount: "", due_date: "" }])}>
        {t("addInstalment")}
      </button>
      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button
          className="btn"
          disabled={pending || !label.trim()}
          onClick={() =>
            startTransition(async () => {
              await addVaultContract({
                weddingId,
                label: label.trim(),
                scheduleLabel: schedule.trim(),
                instalments: rows
                  .filter((r) => r.label && r.amount)
                  .map((r) => ({
                    label: r.label,
                    amount: Number(r.amount),
                    due_date: r.due_date,
                    paid: false
                  }))
              });
              setOpen(false);
              setLabel("");
              setSchedule("");
              setRows([{ label: "", amount: "", due_date: "" }]);
            })
          }
        >
          {pending ? "…" : t("save")}
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
