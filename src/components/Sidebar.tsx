"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export interface NavAccess {
  isTeam: boolean;
  isTeamwork: boolean;
  isPrincipal: boolean;
  isCoordinator: boolean;
}

interface Item {
  href: string;
  key: string;
  teamOnly?: boolean;
  teamworkOnly?: boolean;
  principalOnly?: boolean;
  coordinatorAllowed?: boolean;
}

const GROUPS: { key: string | null; items: Item[] }[] = [
  {
    key: null,
    items: [
      { href: "/", key: "home" },
      { href: "/timeline", key: "timeline" },
      { href: "/process", key: "process" }
    ]
  },
  { key: "creation", items: [{ href: "/design", key: "design" }] },
  {
    key: "production",
    items: [
      { href: "/vendors", key: "vendors" },
      { href: "/budget", key: "budget" },
      { href: "/guests", key: "guests" },
      { href: "/communication", key: "communication" }
    ]
  },
  {
    key: "exchanges",
    items: [
      { href: "/documents", key: "documents" },
      { href: "/messages", key: "messages" },
      { href: "/forms", key: "forms" },
      { href: "/wedding-days", key: "weddingDays", teamOnly: true, coordinatorAllowed: true }
    ]
  },
  {
    key: "house",
    items: [
      { href: "/desk", key: "desk", teamOnly: true },
      { href: "/teamwork", key: "teamwork", teamworkOnly: true },
      { href: "/vault", key: "vault", principalOnly: true }
    ]
  }
];

export function Sidebar({ access }: { access: NavAccess }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const visible = (item: Item) => {
    if (item.principalOnly) return access.isPrincipal;
    if (item.teamworkOnly) return access.isTeamwork;
    if (item.teamOnly) return access.isTeam || (item.coordinatorAllowed && access.isCoordinator);
    // Coordinators only enter The Wedding Days.
    if (access.isCoordinator) return false;
    return true;
  };

  return (
    <aside className="house">
      <div className="logo">
        <Image
          src="/brand/logo-ivory.png"
          alt="Madame Wedding Design"
          width={150}
          height={112}
          style={{ height: "auto" }}
        />
        <span>{t("theInnerHouse")}</span>
      </div>
      <nav>
        {GROUPS.map((group) => {
          const items = group.items.filter(visible);
          if (items.length === 0) return null;
          return (
            <div key={group.key ?? "root"}>
              {group.key && (
                <div className={`grp${items.every((i) => i.teamOnly || i.teamworkOnly || i.principalOnly) ? " team-only" : ""}`}>
                  {t(`groups.${group.key}`)}
                </div>
              )}
              {items.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                const internal = item.teamOnly || item.teamworkOnly || item.principalOnly;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`${active ? "active" : ""}${internal ? " team-only" : ""}`}
                  >
                    {t(item.key)}
                    {item.key === "teamwork" && " 🔑"}
                    {item.key === "vault" && " 🔒"}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="aside-foot">{t("tagline")}</div>
    </aside>
  );
}
