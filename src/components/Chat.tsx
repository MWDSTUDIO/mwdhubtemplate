"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { sendMessage } from "@/app/actions/messages";
import type { Message } from "@/lib/types";
import { Dictate } from "@/components/Dictate";

/**
 * Realtime chat over Supabase Realtime. Used for the client↔house line
 * and for "Between us" (Estelle & Jordane) — RLS decides who reads what.
 *
 * Conversations may carry a subject: the general thread stands always,
 * and any subject opens its own thread (migration 0010). "@Name" cites
 * someone of the hub — the name lights up in the bubble.
 */
export function Chat({
  weddingId,
  channel,
  initialMessages,
  names,
  selfId,
  placeholder
}: {
  weddingId: string;
  channel: "client" | "teamwork";
  initialMessages: Message[];
  names: Record<string, string>;
  selfId: string;
  placeholder: string;
}) {
  const t = useTranslations("messages");
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.subject) set.add(m.subject);
    if (subject) set.add(subject);
    return [...set];
  }, [messages, subject]);

  const shown = messages.filter((m) => (m.subject ?? null) === subject);

  useEffect(() => {
    const supabase = createClient();
    const sub = supabase
      .channel(`messages-${weddingId}-${channel}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `wedding_id=eq.${weddingId}`
        },
        (payload) => {
          const message = payload.new as Message;
          if (message.channel !== channel) return;
          setMessages((list) =>
            list.some((m) => m.id === message.id) ? list : [...list, message]
          );
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(sub);
    };
  }, [weddingId, channel]);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [shown.length, subject]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic bubble; realtime will reconcile by id.
    const optimistic: Message = {
      id: `tmp-${Date.now()}`,
      wedding_id: weddingId,
      channel,
      author_id: selfId,
      body: text,
      created_at: new Date().toISOString(),
      subject
    };
    setMessages((list) => [...list, optimistic]);
    await sendMessage(weddingId, channel, text, subject);
    setSending(false);
  }

  // "@Name" lights up — a citation, in the house's bronze.
  const renderBody = (body: string) =>
    body.split(/(@[\p{L}\p{N}][\p{L}\p{N}._-]*)/gu).map((part, i) =>
      part.startsWith("@") ? (
        <span key={i} style={{ color: "var(--bronze)", fontWeight: 400 }}>
          {part}
        </span>
      ) : (
        part
      )
    );

  return (
    <div className="chat">
      <div
        role="tablist"
        aria-label={t("subjects.label")}
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: "10px 12px",
          borderBottom: "1px solid var(--line)"
        }}
      >
        <button
          role="tab"
          aria-selected={subject === null}
          className={`tag${subject === null ? " ok" : ""}`}
          style={{ cursor: "pointer" }}
          onClick={() => setSubject(null)}
        >
          {t("subjects.general")}
        </button>
        {subjects.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={subject === s}
            className={`tag${subject === s ? " ok" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => setSubject(s)}
          >
            {s}
          </button>
        ))}
        {addingSubject ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <input
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder={t("subjects.placeholder")}
              autoFocus
              style={{ padding: "5px 8px", border: "1px solid var(--line)", fontSize: 12, width: 170 }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newSubject.trim()) {
                  setSubject(newSubject.trim());
                  setNewSubject("");
                  setAddingSubject(false);
                }
                if (e.key === "Escape") setAddingSubject(false);
              }}
            />
            <button
              className="addnote"
              onClick={() => {
                if (newSubject.trim()) setSubject(newSubject.trim());
                setNewSubject("");
                setAddingSubject(false);
              }}
            >
              {t("subjects.open")}
            </button>
          </span>
        ) : (
          <button className="addnote" onClick={() => setAddingSubject(true)}>
            {t("subjects.new")}
          </button>
        )}
      </div>
      <div className="chat-msgs" ref={boxRef} aria-live="polite">
        {shown.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--ink2)", fontStyle: "italic", padding: "18px 6px" }}>
            {subject ? t("subjects.emptyThread", { subject }) : t("subjects.emptyGeneral")}
          </p>
        )}
        {shown.map((message) => {
          const mine = message.author_id === selfId;
          return (
            <div key={message.id} className={`bub ${mine ? "us" : "them"}`}>
              <small>{names[message.author_id] ?? t("theHouse")}</small>
              {renderBody(message.body)}
            </div>
          );
        })}
      </div>
      <div className="chat-in" style={{ alignItems: "center", paddingLeft: 8 }}>
        <Dictate title={t("send")} onText={(x) => setDraft((v) => (v ? v.trimEnd() + " " + x : x))} />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={subject ? t("subjects.inputIn", { subject }) : placeholder}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn" style={{ borderRadius: 0 }} onClick={send} disabled={sending}>
          {t("send")}
        </button>
      </div>
    </div>
  );
}
