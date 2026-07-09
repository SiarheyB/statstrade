"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, LayoutDashboard, Layers, Users, Plug, Coins, Newspaper, Database, ScrollText, ArrowLeft, Menu, X, Headset, AlertTriangle, HeartHandshake, SlidersHorizontal, ChevronDown, ChevronRight } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

// Навигация админ-панели. Раздел отделён от пользовательского дашборда: своя
// шапка, доступ только администраторам (см. admin/layout.tsx).
const LINKS = [
  { href: "/admin", key: "admin.nav.overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/collector", key: "admin.nav.collector", icon: Layers },
  { href: "/admin/users", key: "admin.nav.users", icon: Users },
  { href: "/admin/accounts", key: "admin.nav.accounts", icon: Plug },
  { href: "/admin/exchanges", key: "admin.nav.exchanges", icon: Coins },
  { href: "/admin/features", key: "admin.nav.features", icon: SlidersHorizontal },
  { href: "/admin/support", key: "admin.nav.support", icon: Headset },
  { href: "/admin/errors", key: "admin.nav.errors", icon: AlertTriangle },
  { href: "/admin/donate", key: "admin.nav.donate", icon: HeartHandshake },
  { href: "/admin/content", key: "admin.nav.content", icon: Newspaper },
  { href: "/admin/audit", key: "admin.nav.audit", icon: ScrollText },
  {
    key: "admin.nav.database",
    icon: Database,
    children: [
      { href: "/admin/system", key: "admin.nav.system", icon: Database },
      { href: "/admin/backup", key: "admin.nav.backup", icon: Database },
    ],
  },
];

const POLL_MS = 30_000;

export default function AdminNav({ email }: { email: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [supportUnread, setSupportUnread] = useState(0);
  const [errorsUnread, setErrorsUnread] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const [s, e] = await Promise.all([
          fetch("/api/admin/support/unread"),
          fetch("/api/admin/errors/unread"),
        ]);
        if (s.ok && alive) setSupportUnread((await s.json()).count ?? 0);
        if (e.ok && alive) setErrorsUnread((await e.json()).count ?? 0);
      } catch {
        // тихо игнорируем
      }
    };
    poll();
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isGroupOpen = (key: string) => expanded.has(key);

  const hasChildren = (item: typeof LINKS[number]) =>
    "children" in item && (item as any).children?.length > 0;

  const body = (onNavigate: () => void) => (
    <>
      <div className="flex items-center gap-2 font-semibold px-5 h-16 border-b border-border shrink-0">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <ShieldCheck size={18} />
        </span>
        {t("admin.title")}
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {LINKS.map((l) => {
          if (hasChildren(l)) {
            const item = l as { children: typeof LINKS; key: string; icon: any };
            return (
              <div key={item.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(item.key)}
                  className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-fg hover:bg-surface-2 transition"
                >
                  <item.icon size={18} />
                  <span className="flex-1 text-left">{t(item.key)}</span>
                  {isGroupOpen(item.key) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </button>
                {isGroupOpen(item.key) && (
                  <div className="ml-4 mt-1 space-y-1 border-l border-border pl-2">
                    {item.children.map((c) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        onClick={onNavigate}
                        className={clsx(
                          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                          isActive(c.href)
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
              </div>
            );
          }

          // Regular Link
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                isActive(l.href, (l as any).exact)
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-fg hover:bg-surface-2",
              )}
            >
              <span className="relative inline-flex">
                <l.icon size={18} />
                {(() => {
                  const n =
                    l.href === "/admin/support"
                      ? supportUnread
                      : l.href === "/admin/errors"
                        ? errorsUnread
                        : 0;
                  if (n === 0) return null;
                  return (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-loss text-white text-[9px] font-semibold leading-[15px] text-center">
                      {n > 99 ? "99+" : n}
                    </span>
                  );
                })()}
              </span>
              {t(l.key)}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border shrink-0">
        <div className="px-3 py-2 text-xs text-faint truncate">{email}</div>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-fg hover:bg-surface-2 transition"
        >
          <ArrowLeft size={18} />
          {t("admin.backToApp")}
        </Link>
      </div>
    </>
  );

  return (
    <>
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
            <ShieldCheck size={15} />
          </span>
          {t("admin.title")}
        </span>
      </div>

      <aside className="hidden md:flex w-60 shrink-0 border-r border-border glass-panel flex-col h-screen sticky top-0">
        {body(() => {})}
      </aside>

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
