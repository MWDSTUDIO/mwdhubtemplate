"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { sendMessage, withdrawMessage } from "@/app/actions/messages";
import type { Message } from "@/lib/types";
import { Dictate } from "@/components/Dictate";

/**
 * Realtime chat over Supabase Realtime. Used for the client↔house line
 * and for "Between us" (Estelle & Jordane) — RLS decides who reads what.
 *
 * Conversations may carry a subject: the general thread stands always,
 * and any subject opens its own thread (migration 0010). "@Name" cites
 * someone of the hub — the name lights up in the bubble.
 *
 * The salon's growth (0035, validated mockup): the composer is
 * multi-line (Shift+Enter breaks, a paste keeps its paragraphs),
 * **bold** and _italic_ write themselves along the text, a photo
 * slips into the conversation, every message carries its hour under
 * a dated hairline, and an author may withdraw their own word — a
 * quiet trace stays.
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
  const format = useFormatter();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [subject, setSubject] = useState<string | null>(null);
  const [newSubject, setNewSubject] = useState("");
  const [addingSubject, setAddingSubject] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const subjects = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) if (m.subject) set.add(m.subject);
    if (subject) set.add(subject);
    return [...set];
  }, [messages, subject]);

  const shown = messages.filter((m) => (m.subject ?? null) === subject);

  // The server's row takes the seat of its optimistic stand-in — by
  // id when known, else by author and word — so a sent message always
  // ends up real, withdrawable, never doubled.
  const reconcile = (list: Message[], message: Message): Message[] => {
    if (list.some((m) => m.id === message.id)) return list;
    const tmpAt = list.findIndex(
      (m) =>
        m.id.startsWith("tmp-") &&
        m.author_id === message.author_id &&
        m.body === message.body &&
        (m.subject ?? null) === (message.subject ?? null)
    );
    if (tmpAt >= 0) {
      const next = [...list];
      next[tmpAt] = message;
      return next;
    }
    return [...list, message];
  };

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
          setMessages((list) => reconcile(list, message));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `wedding_id=eq.${weddingId}`
        },
        (payload) => {
          // A withdrawal on the other side reaches this view live.
          const message = payload.new as Message;
          if (message.channel !== channel) return;
          setMessages((list) => list.map((m) => (m.id === message.id ? { ...m, ...message } : m)));
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

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "auto";
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
    const result = await sendMessage(weddingId, channel, text, subject);
    if (result.ok && result.message) {
      const confirmed = result.message;
      setMessages((list) => reconcile(list.filter((m) => m.id !== optimistic.id), confirmed));
    } else if (!result.ok) {
      // The word did not land — the stand-in leaves, the draft returns.
      setMessages((list) => list.filter((m) => m.id !== optimistic.id));
      setDraft(text);
    }
    setSending(false);
  }

  async function attachPhoto(file: File) {
    if (sending) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/messages/attachment", { method: "POST", body: fd });
      if (!r.ok) {
        window.alert(t("attachFailed"));
        return;
      }
      const { path } = (await r.json()) as { path: string };
      const caption = draft.trim();
      const result = await sendMessage(weddingId, channel, caption, subject, path);
      if (!result.ok) {
        window.alert(t("attachFailed"));
        return;
      }
      if (result.message) {
        const confirmed = result.message;
        setMessages((list) => reconcile(list, confirmed));
      }
      setDraft("");
      if (inputRef.current) inputRef.current.style.height = "auto";
    } catch {
      window.alert(t("attachFailed"));
    } finally {
      setSending(false);
    }
  }

  async function withdraw(message: Message) {
    if (!window.confirm(t("withdrawConfirm"))) return;
    // The trace appears at once; the server's word reconciles live.
    setMessages((list) =>
      list.map((m) => (m.id === message.id ? { ...m, withdrawn_at: new Date().toISOString() } : m))
    );
    const r = await withdrawMessage(message.id);
    if (!r.ok) {
      setMessages((list) =>
        list.map((m) => (m.id === message.id ? { ...m, withdrawn_at: null } : m))
      );
      window.alert(t("withdrawFailed"));
    }
  }

  // **bold**, _italic_ and "@Name" light up along the text; line
  // breaks are kept as written (pre-wrap on the container).
  const renderInline = (body: string) =>
    body
      .split(/(\*\*[^*\n]+\*\*|_[^_\n]+_|@[\p{L}\p{N}][\p{L}\p{N}._-]*)/gu)
      .map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
          return <em key={i}>{part.slice(1, -1)}</em>;
        }
        if (part.startsWith("@")) {
          return (
            <span key={i} style={{ color: "var(--bronze)", fontWeight: 400 }}>
              {part}
            </span>
          );
        }
        return part;
      });

  const dayKey = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  };
  const dayLabel = (iso: string) => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);
    if (dayKey(iso) === dayKey(now.toISOString())) return t("today");
    if (dayKey(iso) === dayKey(yesterday.toISOString())) return t("yesterday");
    return format.dateTime(new Date(iso), { weekday: "long", day: "numeric", month: "long" });
  };
  const hourOf = (iso: string) =>
    format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });

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
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", marginLeft: "auto" }}>
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
          <button className="addnote" style={{ marginLeft: "auto" }} onClick={() => setAddingSubject(true)}>
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
        {shown.map((message, i) => {
          const mine = message.author_id === selfId;
          const author = names[message.author_id] ?? t("theHouse");
          const newDay = i === 0 || dayKey(shown[i - 1].created_at) !== dayKey(message.created_at);
          const separator = newDay && (
            <div className="day-sep" key={`sep-${message.id}`}>
              <span className="day-sep-line" />
              <span className="day-sep-label">{dayLabel(message.created_at)}</span>
              <span className="day-sep-line" />
            </div>
          );
          if (message.withdrawn_at) {
            return (
              <div key={message.id} style={{ display: "contents" }}>
                {separator}
                <div style={{ alignSelf: "center", fontSize: 12.5, fontStyle: "italic", color: "var(--ink2)" }}>
                  {t("withdrawn", { name: author, time: hourOf(message.created_at) })}
                </div>
              </div>
            );
          }
          return (
            <div key={message.id} style={{ display: "contents" }}>
              {separator}
              <div className={`bubwrap ${mine ? "us" : "them"}`}>
                <div className={`bub ${mine ? "us" : "them"}`}>
                  <small>
                    {author} · {hourOf(message.created_at)}
                  </small>
                  {message.attachment_path && (
                    <a href={`/api/messages/${message.id}/attachment`} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/messages/${message.id}/attachment`}
                        alt={message.body || t("photoAlt")}
                        style={{ display: "block", maxWidth: "100%", width: 300, border: "1px solid var(--line)", background: "var(--surface)", margin: "2px 0 6px" }}
                      />
                    </a>
                  )}
                  {message.body && <div style={{ whiteSpace: "pre-wrap" }}>{renderInline(message.body)}</div>}
                </div>
                {mine && !message.id.startsWith("tmp-") && (
                  <button className="addnote withdraw-btn" onClick={() => void withdraw(message)}>
                    {t("withdraw")}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-in" style={{ alignItems: "flex-end", paddingLeft: 8 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", paddingBottom: 14 }}>
          <Dictate title={t("send")} onText={(x) => setDraft((v) => (v ? v.trimEnd() + " " + x : x))} />
          <label className="addnote" title={t("attachPhoto")} style={{ cursor: "pointer", display: "inline-flex", padding: "4px 6px" }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="var(--bronze)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="2.5" y="4" width="15" height="12" />
              <circle cx="7" cy="8.5" r="1.4" />
              <path d="M 2.5 14 L 8 9.5 L 12 13 L 14.5 11 L 17.5 13.5" />
            </svg>
            <input
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void attachPhoto(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              autosize();
            }}
            placeholder={subject ? t("subjects.inputIn", { subject }) : placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div style={{ fontSize: 11, letterSpacing: "0.08em", color: "var(--ink2)", padding: "0 20px 8px" }}>
            {t("composerHint")}
          </div>
        </div>
        <button className="btn" style={{ borderRadius: 0, alignSelf: "stretch" }} onClick={() => void send()} disabled={sending}>
          {t("send")}
        </button>
      </div>
    </div>
  );
}
