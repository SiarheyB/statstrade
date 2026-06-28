"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck, LayoutDashboard, Layers, Users, Plug, Newspaper, Database, ScrollText, ArrowLeft, Menu, X } from "lucide-react";
import clsx from "clsx";

// Навигация админ-панели. Раздел отделён от пользовательского дашборда: своя
// шапка, доступ только администраторам (см. admin/layout.tsx).
const LINKS = [
  { href: "/admin", label: "Обзор", icon: LayoutDashboard, exact: true },
  { href: "/admin/collector", label: "Карта ордеров", icon: Layers },
  { href: "/admin/users", label: "Пользователи", icon: Users },
  { href: "/admin/accounts", label: "Аккаунты бирж", icon: Plug },
  { href: "/admin/content", label: "Контент-фиды", icon: Newspaper },
  { href: "/admin/system", label: "Здоровье БД", icon: Database },
  { href: "/admin/audit", label: "Аудит действий", icon: ScrollText },
];

export default function AdminNav({ email }: { email: string }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const body = (onNavigate: () => void) => (
    <>
      <div className="flex items-center gap-2 font-semibold px-5 h-16 border-b border-border shrink-0">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <ShieldCheck size={18} />
        </span>
        Админка
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
            className={clsx(
              "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
              isActive(l.href, l.exact)
                ? "bg-accent/15 text-accent"
                : "text-muted hover:text-fg hover:bg-surface-2",
            )}
          >
            <l.icon size={18} />
            {l.label}
          </Link>
        ))}
      </nav>

      <div className="p-3 border-t border-border shrink-0">
        <div className="px-3 py-2 text-xs text-faint truncate">{email}</div>
        <Link
          href="/dashboard"
          onClick={onNavigate}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-fg hover:bg-surface-2 transition"
        >
          <ArrowLeft size={18} />
          К приложению
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
          Админка
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
