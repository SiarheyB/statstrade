"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  LayoutDashboard,
  CalendarDays,
  PieChart,
  BookOpen,
  ListOrdered,
  Plug,
  Settings,
  LogOut,
} from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

const LINKS = [
  { href: "/dashboard", key: "nav.overview", icon: LayoutDashboard },
  { href: "/dashboard/calendar", key: "nav.calendar", icon: CalendarDays },
  { href: "/dashboard/analytics", key: "nav.analytics", icon: PieChart },
  { href: "/dashboard/journal", key: "nav.journal", icon: BookOpen },
  { href: "/dashboard/trades", key: "nav.trades", icon: ListOrdered },
  { href: "/dashboard/accounts", key: "nav.exchanges", icon: Plug },
  { href: "/dashboard/settings", key: "nav.settings", icon: Settings },
];

export default function DashboardNav({ email }: { email: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-60 shrink-0 border-r border-border glass-panel flex flex-col">
      <div className="flex items-center gap-2 font-semibold px-5 h-16 border-b border-border">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <BarChart3 size={18} />
        </span>
        TradeStats
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {LINKS.map((l) => {
          const active =
            l.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition",
                active
                  ? "bg-accent/15 text-accent"
                  : "text-muted hover:text-fg hover:bg-surface-2",
              )}
            >
              <l.icon size={18} />
              {t(l.key)}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-border">
        <div className="px-3 py-2 text-xs text-faint truncate">{email}</div>
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted hover:text-loss hover:bg-surface-2 transition"
        >
          <LogOut size={18} />
          {t("nav.logout")}
        </button>
      </div>
    </aside>
  );
}
