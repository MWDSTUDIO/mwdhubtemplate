"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { MemberRow } from "@/app/actions/access";
import {
  inviteMember,
  resetMemberPassword,
  removeMember,
  setRoomCode
} from "@/app/actions/access";
import { addForm, addCustomBoard } from "@/app/actions/desk";

/** The Desk — Accès: the house hands the keys itself. */
export function AccessPanel({
  members,
  weddings,
  activeWeddingId,
  isPrincipal
}: {
  members: MemberRow[];
  weddings: { id: string; couple_display_name: string }[];
  activeWeddingId: string | null;
  isPrincipal: boolean;
}) {
  const t = useTranslations("access");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"client" | "coordinator" | "team">("client");
  const [weddingId, setWeddingId] = useState(activeWeddingId ?? "");
  const [reveal, setReveal] = useState<{ who: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function invite() {
    setError(null);
    startTransition(async () => {
      const r = await inviteMember({
        email,
        name,
        role,
        weddingId: role === "team" ? null : weddingId || null
      });
      if (r.ok) {
        setReveal({ who: `${name} (${email})`, password: r.password });
        setEmail("");
        setName("");
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {t("title")} <span className="tag int">{t("internalTag")}</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 16 }}>{t("blurb")}</p>

      <div style={{ overflowX: "auto" }}>
        <table className="sheet-table">
          <thead>
            <tr>
              <th>{t("who")}</th>
              <th>{t("email")}</th>
              <th>{t("role")}</th>
              <th>{t("wedding")}</th>
              <th>{t("keys")}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.profileId}>
                <td>
                  {m.name}
                  {m.isPrincipal && <span className="tag int" style={{ marginLeft: 6 }}>{t("principal")}</span>}
                </td>
                <td style={{ fontSize: 12.5 }}>{m.email}</td>
                <td>
                  <span className="tag">{t(`roles.${m.role}`)}</span>
                </td>
                <td style={{ fontSize: 12.5 }}>{m.role === "team" ? t("allWeddings") : m.weddings.join(" · ") || "—"}</td>
                <td>
                  <button
                    className="addnote"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const r = await resetMemberPassword(m.profileId);
                        if (r.ok) setReveal({ who: `${m.name} (${m.email})`, password: r.password });
                      })
                    }
                  >
                    {t("newKey")}
                  </button>
                  {isPrincipal && !m.isPrincipal && (
                    <button
                      className="addnote"
                      style={{ marginLeft: 10 }}
                      disabled={pending}
                      onClick={() => {
                        if (confirm(t("removeConfirm", { name: m.name }))) {
                          startTransition(() => removeMember(m.profileId).then(() => undefined));
                        }
                      }}
                    >
                      {t("remove")}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reveal && (
        <div className="draftbar" style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13.5 }}>
            {t("keyFor", { who: reveal.who })}{" "}
            <strong className="serif" style={{ fontSize: 17, letterSpacing: "0.04em" }}>{reveal.password}</strong>
            <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{t("keyOnce")}</div>
          </div>
          <button className="btn ghost sm" onClick={() => setReveal(null)}>{t("keyHide")}</button>
        </div>
      )}

      <hr className="hair" />
      <div className="eyebrow" style={{ marginBottom: 10 }}>{t("inviteTitle")}</div>
      <div className="assist" style={{ marginTop: 0 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} style={{ minWidth: 140, flex: "0 1 180px" }} />
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("emailPlaceholder")} />
        <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} style={{ padding: "12px 10px", border: "1px solid var(--line)", background: "#fff" }}>
          <option value="client">{t("roles.client")}</option>
          <option value="coordinator">{t("roles.coordinator")}</option>
          <option value="team">{t("roles.team")}</option>
        </select>
        {role !== "team" && (
          <select value={weddingId} onChange={(e) => setWeddingId(e.target.value)} style={{ padding: "12px 10px", border: "1px solid var(--line)", background: "#fff" }}>
            {weddings.map((w) => (
              <option key={w.id} value={w.id}>{w.couple_display_name}</option>
            ))}
          </select>
        )}
        <button className="btn" disabled={pending || !email || !name} onClick={invite}>
          {pending ? "…" : t("invite")}
        </button>
      </div>
      {error && <p style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 8 }}>{error}</p>}

      {isPrincipal && <RoomCodes />}
    </div>
  );
}

function RoomCodes() {
  const t = useTranslations("access.codes");
  const [teamworkCode, setTeamworkCode] = useState("");
  const [vaultCode, setVaultCode] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (scope: "teamwork" | "vault", code: string, clear: () => void) =>
    startTransition(async () => {
      const r = await setRoomCode(scope, code);
      setDone(r.ok ? t("saved", { scope: t(scope) }) : t("invalid"));
      if (r.ok) clear();
    });

  return (
    <>
      <hr className="hair" />
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {t("title")} <span className="tag int">{t("estelleOnly")}</span>
      </div>
      <div className="assist" style={{ marginTop: 0 }}>
        <input
          type="password" inputMode="numeric" value={teamworkCode}
          onChange={(e) => setTeamworkCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder={t("teamworkPlaceholder")} style={{ flex: "0 1 200px", minWidth: 160 }}
        />
        <button className="btn ghost sm" disabled={pending || teamworkCode.length < 4} onClick={() => save("teamwork", teamworkCode, () => setTeamworkCode(""))}>
          {t("saveTeamwork")}
        </button>
        <input
          type="password" inputMode="numeric" value={vaultCode}
          onChange={(e) => setVaultCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
          placeholder={t("vaultPlaceholder")} style={{ flex: "0 1 200px", minWidth: 160 }}
        />
        <button className="btn ghost sm" disabled={pending || vaultCode.length < 4} onClick={() => save("vault", vaultCode, () => setVaultCode(""))}>
          {t("saveVault")}
        </button>
      </div>
      {done && <p style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 8 }} aria-live="polite">{done}</p>}
    </>
  );
}

/** Bespoke form builder + supplementary boards, from The Desk. */
export function TemplatesPanel({ weddingId }: { weddingId: string }) {
  const t = useTranslations("deskTemplates");
  const [formTitle, setFormTitle] = useState("");
  const [fields, setFields] = useState<{ label: string; type: "text" | "textarea" }[]>([
    { label: "", type: "text" }
  ]);
  const [boardTitle, setBoardTitle] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="card">
      <div className="eyebrow" style={{ marginBottom: 6 }}>
        {t("title")} <span className="tag int">{t("internalTag")}</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 14 }}>{t("blurb")}</p>

      <div className="eyebrow" style={{ marginBottom: 8 }}>{t("newForm")}</div>
      <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
        <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder={t("formTitlePlaceholder")} style={{ padding: "11px 12px", border: "1px solid var(--line)" }} />
        {fields.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 8 }}>
            <input
              value={f.label}
              onChange={(e) => setFields((arr) => arr.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              placeholder={t("fieldPlaceholder", { n: i + 1 })}
              style={{ flex: 1, padding: "10px 12px", border: "1px solid var(--line)" }}
            />
            <select
              value={f.type}
              onChange={(e) => setFields((arr) => arr.map((x, j) => (j === i ? { ...x, type: e.target.value as "text" | "textarea" } : x)))}
              style={{ padding: "10px", border: "1px solid var(--line)", background: "#fff" }}
            >
              <option value="text">{t("short")}</option>
              <option value="textarea">{t("long")}</option>
            </select>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="addnote" onClick={() => setFields((arr) => [...arr, { label: "", type: "text" }])}>
            {t("addField")}
          </button>
          <button
            className="btn sm"
            disabled={pending || !formTitle.trim() || fields.every((f) => !f.label.trim())}
            onClick={() =>
              startTransition(async () => {
                await addForm({ weddingId, title: formTitle.trim(), fields: fields.filter((f) => f.label.trim()) });
                setFormTitle("");
                setFields([{ label: "", type: "text" }]);
                setNote(t("formAdded"));
              })
            }
          >
            {t("createForm")}
          </button>
        </div>
      </div>

      <hr className="hair" />
      <div className="eyebrow" style={{ marginBottom: 8 }}>{t("newBoard")}</div>
      <div className="assist" style={{ marginTop: 0, maxWidth: 560 }}>
        <input value={boardTitle} onChange={(e) => setBoardTitle(e.target.value)} placeholder={t("boardTitlePlaceholder")} />
        <button
          className="btn sm"
          disabled={pending || !boardTitle.trim()}
          onClick={() =>
            startTransition(async () => {
              const r = await addCustomBoard(weddingId, boardTitle.trim());
              setNote(r.ok ? t("boardAdded") : r.needsMigration ? t("boardNeedsMigration") : t("boardFailed"));
              if (r.ok) setBoardTitle("");
            })
          }
        >
          {t("createBoard")}
        </button>
      </div>
      {note && <p style={{ fontSize: 12.5, color: "var(--bronze)", marginTop: 10 }} aria-live="polite">{note}</p>}
    </div>
  );
}
