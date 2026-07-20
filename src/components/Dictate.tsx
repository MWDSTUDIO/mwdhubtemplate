"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

/**
 * Dictation — the browser's own speech recognition (Chrome, Safari,
 * Edge). A discreet mic beside the field; it listens in the hub's
 * current language and hands the words back as they settle.
 * Hidden entirely where the browser offers no recognition.
 */

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
};

const LANGS: Record<string, string> = {
  en: "en-US", fr: "fr-FR", zh: "zh-CN", ja: "ja-JP", es: "es-ES"
};

export function Dictate({
  onText,
  title
}: {
  onText: (text: string) => void;
  title: string;
}) {
  const locale = useLocale();
  const t = useTranslations("common.dictation");
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = LANGS[locale] ?? "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) onText(r[0].transcript.trim() + " ");
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      // Say why, briefly — a silent mic reads as a broken house.
      setTrouble(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? t("denied")
          : e.error === "no-speech"
            ? t("noSpeech")
            : t("failed")
      );
      setTimeout(() => setTrouble(null), 6000);
    };
    recRef.current = rec;
    setTrouble(null);
    rec.start();
    setListening(true);
  }

  return (
    <>
    <button
      type="button"
      onClick={toggle}
      title={title}
      aria-label={title}
      aria-pressed={listening}
      style={{
        border: `1px solid ${listening ? "var(--hunter)" : "var(--line)"}`,
        background: listening ? "var(--hunter)" : "none",
        color: listening ? "var(--cream)" : "var(--ink2)",
        borderRadius: "50%",
        width: 38,
        height: 38,
        cursor: "pointer",
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 0.25s var(--ease-out), color 0.25s var(--ease-out)"
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
    </button>
    {trouble && (
      <span role="status" style={{ fontSize: 11.5, color: "var(--bronze)", marginLeft: 8 }}>
        {trouble}
      </span>
    )}
    </>
  );
}
