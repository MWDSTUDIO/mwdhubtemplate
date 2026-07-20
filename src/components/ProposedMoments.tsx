"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import type { AvailabilityProposal } from "@/lib/types";
import { confirmMoment } from "@/app/actions/schedule";

/**
 * The moments the couple proposed — the house picks one, and the
 * Google Meet invitation leaves for both sides. Team only.
 */
export function ProposedMoments({
  proposals,
  names
}: {
  proposals: AvailabilityProposal[];
  names: Record<string, string>;
}) {
  const t = useTranslations("home.moments");
  const format = useFormatter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (proposals.length === 0) return null;

  return (
    <div className="card team-only">
      <div className="eyebrow">
        {t("title")} <span className="tag int">{t("internalTag")}</span>
      </div>
      <p style={{ margin: "8px 0 4px", fontSize: 13.5 }}>{t("blurb")}</p>
      {proposals.map((p) => (
        <div key={p.id} style={{ marginTop: 14 }}>
          <hr className="hair" style={{ margin: "0 0 12px" }} />
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            {t("proposedBy", {
              name: (p.proposed_by && names[p.proposed_by]) || t("theCouple"),
              minutes: p.duration_minutes
            })}
          </div>
          {p.status === "confirmed" && p.confirmed_slot ? (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <span className="tag ok">
                {format.dateTime(new Date(`${p.confirmed_slot.date}T${p.confirmed_slot.time}:00`), {
                  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
                })}
              </span>
              {p.meet_url && (
                <a className="btn ghost sm" href={p.meet_url} target="_blank" rel="noreferrer">
                  {t("joinMeet")}
                </a>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.slots.map((slot) => (
                <button
                  key={`${slot.date}-${slot.time}`}
                  className="btn ghost sm"
                  disabled={pending}
                  onClick={() => {
                    setConfirming(p.id);
                    startTransition(async () => {
                      await confirmMoment(p.id, slot);
                      setConfirming(null);
                      router.refresh();
                    });
                  }}
                >
                  {confirming === p.id && pending
                    ? "…"
                    : format.dateTime(new Date(`${slot.date}T${slot.time}:00`), {
                        weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit"
                      })}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <p style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 12 }}>{t("hint")}</p>
    </div>
  );
}
