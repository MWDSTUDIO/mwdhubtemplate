"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { setBoardStatus, updateSheet, type SheetTarget } from "@/app/actions/design";
import { Link } from "@/i18n/navigation";
import { Dictate } from "@/components/Dictate";
import type { BoardStatus } from "@/lib/types";

export interface SheetData {
  eyebrow: string;
  conceptTitle: string;
  conceptText: string;
  signature: string;
  palette: string[];
  materials: string[];
  photoPaths: Record<string, string>;
  photoUrls: Record<string, string>;
  backdropUrl: string | null;
  footerRef: string;
}

export interface SheetLinks {
  globalId: string | null;
  neighbor: { id: string; title: string } | null;
  hasSubs: boolean;
  /** Every board of the wedding — the house chooses the kinship link. */
  options: { id: string; title: string }[];
  relatedId: string | null;
}

const SLOTS = [0, 1, 2, 3, 4, 5, 6];

/**
 * The editorial board sheet — the validated template. One mould for
 * every board of every wedding: the team fills it (words, hexes,
 * photos, chips); the couple receives it finished.
 */
export function BoardSheet({
  target,
  data,
  links,
  isTeam,
  pdfHref,
  status
}: {
  target: SheetTarget;
  data: SheetData;
  links: SheetLinks;
  isTeam: boolean;
  pdfHref: string;
  status: BoardStatus | null;
}) {
  const t = useTranslations("boardSheet");
  const [palette, setPalette] = useState<string[]>(
    data.palette.length ? data.palette : ["#22382B", "#fbf8f3", "#c9b291", "#9fae8f", "#5b4a38"]
  );
  const [materials, setMaterials] = useState<string[]>(
    data.materials.length ? data.materials : []
  );
  const [urls, setUrls] = useState(data.photoUrls);
  const [backdrop, setBackdrop] = useState(data.backdropUrl);
  const [busySlot, setBusySlot] = useState<number | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fsHint, setFsHint] = useState(false);

  // Full screen for presentations — the sheet alone, edge to edge.
  function enterFullscreen() {
    const el = stageRef.current;
    if (!el?.requestFullscreen) return;
    void el
      .requestFullscreen()
      .then(() => setFsHint(true))
      .catch(() => {});
  }
  useEffect(() => {
    if (!fsHint) return;
    const timer = setTimeout(() => setFsHint(false), 5000);
    const onChange = () => {
      if (!document.fullscreenElement) setFsHint(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, [fsHint]);
  const [, startTransition] = useTransition();

  const eyebrowRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const refRef = useRef<HTMLDivElement>(null);

  // 3D tilt — fine pointers only, never under reduced motion.
  useEffect(() => {
    if (!matchMedia("(pointer:fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion:reduce)").matches) return;
    const tiles = document.querySelectorAll<HTMLElement>(".bsheet .tile");
    const move = (tile: HTMLElement) => (e: MouseEvent) => {
      const b = tile.getBoundingClientRect();
      const x = (e.clientX - b.left) / b.width - 0.5;
      const y = (e.clientY - b.top) / b.height - 0.5;
      tile.style.transform = `perspective(900px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) scale(1.025)`;
    };
    const cleanups: (() => void)[] = [];
    tiles.forEach((tile) => {
      const onMove = move(tile);
      const onLeave = () => { tile.style.transform = ""; };
      tile.addEventListener("mousemove", onMove);
      tile.addEventListener("mouseleave", onLeave);
      cleanups.push(() => {
        tile.removeEventListener("mousemove", onMove);
        tile.removeEventListener("mouseleave", onLeave);
      });
    });
    return () => cleanups.forEach((fn) => fn());
  }, [urls]);

  const persist = (patch: Record<string, unknown>) =>
    startTransition(() => updateSheet(target, patch).then(() => undefined));

  const saveText = () =>
    persist({
      eyebrow: eyebrowRef.current?.textContent?.trim() ?? "",
      concept_title: titleRef.current?.textContent?.trim() ?? "",
      concept_text: textRef.current?.textContent?.trim() ?? "",
      footer_ref: refRef.current?.textContent?.trim() ?? ""
    });

  async function upload(slot: number | "backdrop", file: File) {
    setBusySlot(slot === "backdrop" ? -1 : slot);
    const supabase = createClient();
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${target.weddingId}/boards/${target.boardId}${target.sub ? `-${target.sub}` : ""}/${slot}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("shared").upload(path, file, { upsert: true });
    if (!error) {
      const { data: signed } = await supabase.storage.from("shared").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (slot === "backdrop") {
        setBackdrop(signed?.signedUrl ?? null);
        persist({ backdrop_path: path });
      } else {
        setUrls((u) => ({ ...u, [slot]: signed?.signedUrl ?? "" }));
        persist({ photos: { ...data.photoPaths, [slot]: path } });
        data.photoPaths[slot] = path;
      }
    }
    setBusySlot(null);
  }

  async function composeConcept(indications: string) {
    const r = await fetch("/api/agents/board-concept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weddingId: target.weddingId,
        boardTitle: data.eyebrow,
        indications
      })
    });
    const d = await r.json();
    if (d.title && titleRef.current) titleRef.current.textContent = d.title;
    if (d.text && textRef.current) textRef.current.textContent = d.text;
    saveText();
  }

  const tile = (slot: number) => (
    <label key={slot} className={`tile${isTeam ? "" : " readonly"}`}>
      {urls[slot] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={urls[slot]} alt="" />
      ) : (
        <span className="ph" style={busySlot === slot ? { opacity: 0.4 } : undefined} />
      )}
      {isTeam && (
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(slot, f);
            e.target.value = "";
          }}
        />
      )}
    </label>
  );

  return (
    <div className="bsheet-stage" ref={stageRef}>
      {fsHint && (
        <div className="fs-hint" role="status">
          {t("fullscreenHint")}
        </div>
      )}
      {isTeam && (
        <div className="bsheet-bar team-only" style={{ alignItems: "center" }}>
          {status && !target.sub && <StatusControl boardId={target.boardId} status={status} />}
          <label className="btn ghost sm" style={{ cursor: "pointer" }}>
            {busySlot === -1 ? "…" : t("backdrop")}
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload("backdrop", f);
                e.target.value = "";
              }}
            />
          </label>
          <button className="btn ghost sm" onClick={() => setComposeOpen((v) => !v)}>
            {t("letMadame")}
          </button>
          <button className="btn ghost sm" onClick={enterFullscreen}>
            {t("fullscreen")}
          </button>
          <a className="btn sm" href={pdfHref}>
            {t("savePdf")}
          </a>
        </div>
      )}
      {!isTeam && (
        <div className="bsheet-bar">
          <button className="btn ghost sm" onClick={enterFullscreen}>
            {t("fullscreen")}
          </button>
          <a className="btn ghost sm" href={pdfHref}>
            {t("savePdf")}
          </a>
        </div>
      )}

      {composeOpen && isTeam && (
        <ComposeBox
          onCompose={async (s) => {
            await composeConcept(s);
            setComposeOpen(false);
          }}
        />
      )}

      <div className="bsheet">
        <div className="bg" style={backdrop ? { backgroundImage: `url(${backdrop})` } : { opacity: 0 }} />
        <div className="veil" />
        <div className="in">
          <div className="hd">
            <div
              ref={eyebrowRef}
              className="eyebrow"
              contentEditable={isTeam}
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={saveText}
            >
              {data.eyebrow}
            </div>
            <h1
              ref={titleRef}
              contentEditable={isTeam}
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={saveText}
            >
              {data.conceptTitle || (isTeam ? t("titlePlaceholder") : "")}
            </h1>
            <p
              ref={textRef}
              contentEditable={isTeam}
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={saveText}
            >
              {data.conceptText || (isTeam ? t("textPlaceholder") : "")}
            </p>
            <div className="sig">{data.signature}</div>
            <div className="links">
              {links.globalId && <Link href={`/design/${links.globalId}`}>{t("partOfGlobal")}</Link>}
              {links.hasSubs && !target.sub && (
                <>
                  <Link href={`/design/${target.boardId}?sub=rental`}>{t("rentalDetails")}</Link>
                  <Link href={`/design/${target.boardId}?sub=stationery`}>{t("stationeryDetails")}</Link>
                </>
              )}
              {target.sub && <Link href={`/design/${target.boardId}`}>{t("backToBoard")}</Link>}
              {links.neighbor && (
                <Link href={`/design/${links.neighbor.id}`}>{links.neighbor.title}</Link>
              )}
            </div>
            {isTeam && !target.sub && (
              <div className="team-only" style={{ marginTop: 10, display: "flex", justifyContent: "center", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--ink2)" }}>
                  {t("relatedLabel")}
                </span>
                <select
                  value={links.relatedId ?? ""}
                  onChange={(e) =>
                    persist({ related_board_id: e.target.value || null })
                  }
                  style={{ border: "1px solid var(--line)", background: "none", fontSize: 10, padding: "3px 6px", color: "var(--ink2)" }}
                >
                  <option value="">{t("relatedAuto")}</option>
                  {links.options
                    .filter((o) => o.id !== target.boardId)
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          <div className="bodygrid">
            <div className="pal">
              {palette.map((hex, i) => (
                <div className="row" key={i}>
                  <span className="dot" style={{ background: /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex : "transparent" }} />
                  {isTeam ? (
                    <input
                      value={hex}
                      onChange={(e) =>
                        setPalette((p) => p.map((x, j) => (j === i ? e.target.value : x)))
                      }
                      onBlur={() => persist({ palette })}
                    />
                  ) : (
                    <span style={{ fontSize: 8.5, letterSpacing: "0.08em", color: "var(--ink2)" }}>{hex}</span>
                  )}
                </div>
              ))}
            </div>

            <div className="collage">
              <div className="r1">{[0, 1, 2, 3].map(tile)}</div>
              <div className="r2">{[4, 5, 6].map(tile)}</div>
            </div>
          </div>

          <div className="mats">
            {materials.map((m, i) =>
              isTeam ? (
                <span
                  key={i}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onBlur={(e) => {
                    const next = materials.map((x, j) =>
                      j === i ? (e.target.textContent ?? "").trim() : x
                    ).filter(Boolean);
                    setMaterials(next);
                    persist({ materials: next });
                  }}
                >
                  {m}
                </span>
              ) : (
                <span key={i}>{m}</span>
              )
            )}
            {isTeam && (
              <button
                className="addnote team-only"
                onClick={() => setMaterials((m) => [...m, t("newMaterial")])}
              >
                +
              </button>
            )}
          </div>

          <div className="foot">
            <div
              ref={refRef}
              className="ref"
              contentEditable={isTeam}
              suppressContentEditableWarning
              spellCheck={false}
              onBlur={saveText}
            >
              {data.footerRef}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="mark" src="/brand/plaque.png" alt="Madame Wedding Design" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ComposeBox({ onCompose }: { onCompose: (s: string) => Promise<void> }) {
  const t = useTranslations("boardSheet");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="assist team-only" style={{ maxWidth: 720, marginBottom: 14 }}>
      <Dictate
        title={t("dictate")}
        onText={(text) => setValue((v) => (v ? `${v.trimEnd()} ${text}` : text))}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("composePlaceholder")}
        onKeyDown={async (e) => {
          if (e.key === "Enter" && value.trim() && !busy) {
            setBusy(true);
            await onCompose(value.trim());
            setBusy(false);
          }
        }}
      />
      <button
        className="btn sm"
        disabled={busy || !value.trim()}
        onClick={async () => {
          setBusy(true);
          await onCompose(value.trim());
          setBusy(false);
        }}
      >
        {busy ? "…" : t("compose")}
      </button>
    </div>
  );
}

/**
 * The board's status, right where the work happens: in creation →
 * submit to the client's word → approved. Sending to review notifies
 * the couple; approval usually arrives from their own hand below.
 */
function StatusControl({ boardId, status }: { boardId: string; status: BoardStatus }) {
  const t = useTranslations("boardSheet.statusCtl");
  const [pending, startTransition] = useTransition();
  const set = (s: BoardStatus) =>
    startTransition(() => setBoardStatus(boardId, s).then(() => undefined));

  const seg = (s: BoardStatus, label: string) => (
    <button
      key={s}
      className={status === s ? "on" : undefined}
      disabled={pending}
      onClick={() => status !== s && set(s)}
      style={{ padding: "8px 14px", background: status === s ? "var(--hunter)" : "none", color: status === s ? "var(--cream)" : "var(--ink2)", border: "none", cursor: "pointer", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" }}
    >
      {label}
    </button>
  );

  return (
    <div className="toggle" role="group" aria-label={t("label")}>
      {seg("in_creation", t("inCreation"))}
      {seg("to_review", t("toReview"))}
      {seg("approved", t("approved"))}
    </div>
  );
}
