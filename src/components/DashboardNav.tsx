"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  CalendarDays,
  PieChart,
  ListOrdered,
  Plug,
  Settings,
  Newspaper,
  CalendarClock,
  Flame,
  Layers,
  Wrench,
  SlidersHorizontal,
  Tags,
  ShieldAlert,
  ChevronDown,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

const LINKS = [
  { href: "/dashboard", key: "nav.overview", icon: LayoutDashboard },
  { href: "/dashboard/calendar", key: "nav.calendar", icon: CalendarDays },
  { href: "/dashboard/analytics", key: "nav.analytics", icon: PieChart },
  { href: "/dashboard/trades", key: "nav.trades", icon: ListOrdered },
];

const NEWS_CHILDREN = [
  { href: "/dashboard/news", key: "nav.news", icon: Newspaper },
  { href: "/dashboard/econcal", key: "nav.econcal", icon: CalendarClock },
];

function isNewsRoute(pathname: string): boolean {
  return pathname.startsWith("/dashboard/news") || pathname.startsWith("/dashboard/econcal");
}

const SERVICE_CHILDREN = [
  { href: "/dashboard/liqmap", key: "nav.liqmap", icon: Flame },
  { href: "/dashboard/orderflow", key: "nav.orderflow", icon: Layers },
  { href: "/dashboard/settings/risk", key: "nav.risk", icon: ShieldAlert },
];

function isServiceRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/liqmap") ||
    pathname.startsWith("/dashboard/orderflow") ||
    pathname.startsWith("/dashboard/settings/risk")
  );
}

const SETTINGS_CHILDREN = [
  { href: "/dashboard/settings", key: "nav.general", icon: SlidersHorizontal },
  { href: "/dashboard/accounts", key: "nav.exchanges", icon: Plug },
  { href: "/dashboard/settings/trades", key: "nav.tradeSettings", icon: Tags },
];

function isSettingsRoute(pathname: string): boolean {
  // Risk now lives under the Service group, so exclude it here.
  if (pathname.startsWith("/dashboard/settings/risk")) return false;
  return pathname.startsWith("/dashboard/settings") || pathname.startsWith("/dashboard/accounts");
}

export default function DashboardNav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(() => isSettingsRoute(pathname));
  const [newsOpen, setNewsOpen] = useState(() => isNewsRoute(pathname));
  const [serviceOpen, setServiceOpen] = useState(() => isServiceRoute(pathname));
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const childActive = (href: string) =>
    href === "/dashboard/settings" ? pathname === "/dashboard/settings" : pathname.startsWith(href);

  const body = (onNavigate: () => void) => (
    <>
      <div className="flex items-center gap-2 font-semibold px-5 h-16 border-b border-border shrink-0">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <BarChart3 size={18} />
        </span>
        TradeStats
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <button
          onClick={() => setNewsOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
            isNewsRoute(pathname) && !newsOpen
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
        >
          <Newspaper size={18} />
          <span className="flex-1 text-left">{t("nav.news")}</span>
          <ChevronDown size={15} className={clsx("transition", newsOpen && "rotate-180")} />
        </button>

        {newsOpen && (
          <div className="ml-4 pl-3 border-l border-border space-y-1">
            {NEWS_CHILDREN.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
              >
                <c.icon size={16} />
                {t(c.key)}
              </Link>
            ))}
          </div>
        )}

        {LINKS.map((l) => {
          const active =
            l.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                active ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-surface-2",
              )}
            >
              <l.icon size={18} />
              {t(l.key)}
            </Link>
          );
        })}

        <button
          onClick={() => setServiceOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
            isServiceRoute(pathname) && !serviceOpen
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
        >
          <Wrench size={18} />
          <span className="flex-1 text-left">{t("nav.service")}</span>
          <ChevronDown size={15} className={clsx("transition", serviceOpen && "rotate-180")} />
        </button>

        {serviceOpen && (
          <div className="ml-4 pl-3 border-l border-border space-y-1">
            {SERVICE_CHILDREN.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
              >
                <c.icon size={16} />
                {t(c.key)}
              </Link>
            ))}
          </div>
        )}

        <button
          onClick={() => setOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
            isSettingsRoute(pathname) && !open
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
        >
          <Settings size={18} />
          <span className="flex-1 text-left">{t("nav.settings")}</span>
          <ChevronDown size={15} className={clsx("transition", open && "rotate-180")} />
        </button>

        {open && (
          <div className="ml-4 pl-3 border-l border-border space-y-1">
            {SETTINGS_CHILDREN.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
              >
                <c.icon size={16} />
                {t(c.key)}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="p-3 border-t border-border shrink-0">
        <div className="px-3 py-2 text-xs text-faint truncate">{email}</div>
        <button
          onClick={() => {
            onNavigate();
            logout();
          }}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-loss hover:bg-surface-2 transition"
        >
          <LogOut size={18} />
          {t("nav.logout")}
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 h-14 px-4 border-b border-border glass-panel">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 -ml-1.5 text-muted hover:text-fg"
          aria-label="menu"
        >
          <Menu size={20} />
        </button>
        <span className="font-semibold flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <BarChart3 size={15} />
          </span>
          TradeStats
        </span>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-60 shrink-0 border-r border-border glass-panel flex-col h-screen sticky top-0">
        {body(() => {})}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 max-w-[80%] bg-bg border-r border-border flex flex-col">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-3 z-10 text-faint hover:text-fg"
              aria-label="close menu"
            >
              <X size={18} />
            </button>
            {body(() => setMobileOpen(false))}
          </aside>
        </div>
      )}
    </>
  );
}
