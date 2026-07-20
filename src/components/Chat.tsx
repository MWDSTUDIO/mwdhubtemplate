"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { sendMessage } from "@/app/actions/messages";
import type { Message } from "@/lib/types";

/**
 * Realtime chat over Supabase Realtime. Used for the client↔house line
 * and for "Between us" (Estelle & Jordane) — RLS decides who reads what.
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
  const boxRef = useRef<HTMLDivElement>(null);

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
  }, [messages.length]);

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
      created_at: new Date().toISOString()
    };
    setMessages((list) => [...list, optimistic]);
    await sendMessage(weddingId, channel, text);
    setSending(false);
  }

  return (
    <div className="chat">
      <div className="chat-msgs" ref={boxRef} aria-live="polite">
        {messages.map((message) => {
          const mine = message.author_id === selfId;
          return (
            <div key={message.id} className={`bub ${mine ? "us" : "them"}`}>
              <small>{names[message.author_id] ?? t("theHouse")}</small>
              {message.body}
            </div>
          );
        })}
      </div>
      <div className="chat-in">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button className="btn" style={{ borderRadius: 0 }} onClick={send} disabled={sending}>
          {t("send")}
        </button>
      </div>
    </div>
  );
}
