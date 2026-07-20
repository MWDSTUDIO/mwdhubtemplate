"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { FormRow } from "@/lib/types";
import { approveReply, saveReply, submitForm } from "@/app/actions/forms";

interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "textarea";
}

/** The client completes an awaiting form. */
export function FormFill({
  form,
  weddingId,
  schema
}: {
  form: FormRow;
  weddingId: string;
  schema: FieldDef[];
}) {
  const t = useTranslations("forms");
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const fields: FieldDef[] =
    schema.length > 0 ? schema : [{ name: "answer", label: t("yourAnswer"), type: "textarea" }];

  if (!open) {
    return (
      <button className="addnote" onClick={() => setOpen(true)}>
        {t("complete")}
      </button>
    );
  }

  return (
    <div style={{ margin: "12px 0", display: "grid", gap: 10 }}>
      {fields.map((field) => (
        <div className="field" key={field.name}>
          <label className="eyebrow">{field.label}</label>
          {field.type === "textarea" ? (
            <textarea
              rows={4}
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            />
          ) : (
            <input
              value={values[field.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
            />
          )}
        </div>
      ))}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await submitForm(form.id, weddingId, values);
              setOpen(false);
            })
          }
        >
          {pending ? "…" : t("send")}
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}

/** Team: the pre-written reply — approve & send, or refine first. */
export function ReplyReview({
  submissionId,
  reply
}: {
  submissionId: string;
  reply: string;
}) {
  const t = useTranslations("forms");
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(reply);
  const [pending, startTransition] = useTransition();

  return (
    <>
      {editing ? (
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ width: "100%", padding: "10px 12px", border: "1px solid var(--champagne)", fontSize: 14, fontFamily: "var(--font-display)", fontStyle: "italic" }}
        />
      ) : (
        <p className="ia-quote">&ldquo;{body}&rdquo;</p>
      )}
      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              if (editing) await saveReply(submissionId, body);
              await approveReply(submissionId);
            })
          }
        >
          {t("approveSend")}
        </button>
        <button
          className="btn ghost"
          disabled={pending}
          onClick={() => {
            if (editing) {
              startTransition(async () => {
                await saveReply(submissionId, body);
                setEditing(false);
              });
            } else {
              setEditing(true);
            }
          }}
        >
          {editing ? t("keep") : t("edit")}
        </button>
      </div>
    </>
  );
}
