"use client";

import { useEffect, useState } from "react";
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
  TrendingUp,
  Sparkles,
  Wrench,
  SlidersHorizontal,
  Tags,
  Share2,
  ShieldAlert,
  ChevronDown,
  Menu,
  X,
  LogOut,
  ShieldCheck,
  NotebookPen,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { useSidebar } from "@/lib/sidebar/provider";
import { isDemoBlocked } from "@/lib/demoAccess";
import SupportButton from "@/components/SupportButton";
import DonateButton from "@/components/DonateButton";
import NotificationBell from "@/components/NotificationBell";

// Опрос числа непрочитанных сообщений поддержки — только для админов, только
// для колокольчика в меню (лёгкий эндпоинт, не полный список).
const SUPPORT_POLL_MS = 30_000;

const LINKS = [
  { href: "/dashboard", key: "nav.overview", icon: LayoutDashboard },
  { href: "/dashboard/calendar", key: "nav.calendar", icon: CalendarDays },
  { href: "/dashboard/analytics", key: "nav.analytics", icon: PieChart },
  { href: "/dashboard/trades", key: "nav.trades", icon: ListOrdered },
  { href: "/dashboard/playbooks", key: "nav.playbooks", icon: NotebookPen, featureKey: "playbooks" },
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
  {
    href: "/dashboard/recommendations",
    key: "nav.recommendations",
    icon: Sparkles,
    featureKey: "tradeRecommendations",
    userOnlyFeatureKey: "tradeRecommendationsPublicAccess",
  },
  // featureKey: скрыт для ВСЕХ (включая админа), когда общий выключатель
  // "forex" выключен. userOnlyFeatureKey: скрыт только для НЕ-админов, когда
  // "forexPublicAccess" выключен (админ видит раздел в любом случае).
  { href: "/dashboard/forex", key: "nav.forex", icon: TrendingUp, featureKey: "forex", userOnlyFeatureKey: "forexPublicAccess" },
  { href: "/dashboard/settings/risk", key: "nav.risk", icon: ShieldAlert },
];

function isServiceRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/dashboard/liqmap") ||
    pathname.startsWith("/dashboard/forex") ||
    pathname.startsWith("/dashboard/orderflow") ||
    pathname.startsWith("/dashboard/recommendations") ||
    pathname.startsWith("/dashboard/settings/risk")
  );
}

const SETTINGS_CHILDREN = [
  { href: "/dashboard/settings", key: "nav.general", icon: SlidersHorizontal },
  { href: "/dashboard/accounts", key: "nav.exchanges", icon: Plug },
  { href: "/dashboard/settings/trades", key: "nav.tradeSettings", icon: Tags },
  { href: "/dashboard/settings/mentor", key: "nav.mentor", icon: Share2 },
];

// featureKey — пункт скрыт для ВСЕХ (включая админа), когда та фича
// выключена. userOnlyFeatureKey — пункт скрыт только для НЕ-админов
// (у админа доступ остаётся). Оба независимы: если задан featureKey и он
// скрыт — пункт пропадает у всех вне зависимости от userOnlyFeatureKey.
function isNavItemVisible(
  item: { featureKey?: string; userOnlyFeatureKey?: string },
  hiddenFeatures: Set<string>,
  hiddenForUsersOnly: Set<string>,
  isAdmin: boolean,
): boolean {
  if (item.featureKey && hiddenFeatures.has(item.featureKey)) return false;
  if (item.userOnlyFeatureKey && !isAdmin && hiddenForUsersOnly.has(item.userOnlyFeatureKey)) return false;
  return true;
}

function isSettingsRoute(pathname: string): boolean {
  // Risk now lives under the Service group, so exclude it here.
  if (pathname.startsWith("/dashboard/settings/risk")) return false;
  return pathname.startsWith("/dashboard/settings") || pathname.startsWith("/dashboard/accounts");
}

export default function DashboardNav({
  email,
  isAdmin = false,
  demo = false,
}: {
  email: string;
  isAdmin?: boolean;
  /** Демо-сессия: закрытые разделы прячем (доступ к ним рубит middleware). */
  demo?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const [open, setOpen] = useState(() => isSettingsRoute(pathname));
  const [newsOpen, setNewsOpen] = useState(() => isNewsRoute(pathname));
  const [serviceOpen, setServiceOpen] = useState(() => isServiceRoute(pathname));
  const { collapsed, toggle } = useSidebar();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [supportUnread, setSupportUnread] = useState(0);
  const [errorsUnread, setErrorsUnread] = useState(0);
  // Скрываем пункты, привязанные к отключённой в /admin/features фиче.
  // Оптимистично показываем, пока не пришёл ответ — не мигает при обычном on.
  // featureKey — скрыт для ВСЕХ (включая админа); userOnlyFeatureKey — скрыт
  // только для не-админов (см. SERVICE_CHILDREN.forex выше).
  const [hiddenFeatures, setHiddenFeatures] = useState<Set<string>>(new Set());
  const [hiddenForUsersOnly, setHiddenForUsersOnly] = useState<Set<string>>(new Set());

  useEffect(() => {
    const allItems = [...LINKS, ...SERVICE_CHILDREN];
    const keys = Array.from(new Set(
      allItems.map((l) => ("featureKey" in l ? l.featureKey : null)).filter((k): k is string => !!k),
    ));
    const userOnlyKeys = Array.from(new Set(
      allItems.map((l) => ("userOnlyFeatureKey" in l ? l.userOnlyFeatureKey : null)).filter((k): k is string => !!k),
    ));
    let alive = true;
    const fetchDisabled = (keys: string[]) =>
      Promise.all(
        keys.map((key) =>
          fetch(`/api/features?key=${key}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => ({ key, enabled: j?.value?.enabled ?? true })),
        ),
      ).then((results) => new Set(results.filter((r) => !r.enabled).map((r) => r.key as string)));

    fetchDisabled(keys).then((s) => alive && setHiddenFeatures(s));
    fetchDisabled(userOnlyKeys).then((s) => alive && setHiddenForUsersOnly(s));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
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
        // тихо игнорируем — это лишь индикатор
      }
    };
    poll();
    const iv = setInterval(poll, SUPPORT_POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [isAdmin]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  // Пункты групп после всех фильтров: если в демо от группы ничего не
  // осталось, прячем и её заголовок — пустой раскрывающийся «Сервис» выглядит
  // как поломка.
  const visibleService = SERVICE_CHILDREN.filter(
    (c) => isNavItemVisible(c, hiddenFeatures, hiddenForUsersOnly, isAdmin) && !(demo && isDemoBlocked(c.href)),
  );
  const visibleSettings = SETTINGS_CHILDREN.filter((c) => !(demo && isDemoBlocked(c.href)));

  const childActive = (href: string) =>
    href === "/dashboard/settings" ? pathname === "/dashboard/settings" : pathname.startsWith(href);

  const body = (onNavigate: () => void) => (
    <>
      <div className={clsx("flex items-center shrink-0 border-b border-border", collapsed ? "flex-col h-auto py-2 gap-1" : "h-16 px-3 gap-2")}>
        {collapsed ? (
          <>
            <button
              onClick={toggle}
              className="p-1.5 text-muted hover:text-fg transition"
              aria-label="expand sidebar"
            >
              <PanelLeftOpen size={18} />
            </button>
            {!demo && <NotificationBell collapsed />}
          </>
        ) : (
          <>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent shrink-0">
              <BarChart3 size={18} />
            </span>
            <span className="font-semibold">TradeStats</span>
            <div className="flex-1" />
            {!demo && <NotificationBell />}
            <button
              onClick={toggle}
              className="p-1.5 text-muted hover:text-fg transition shrink-0"
              aria-label="collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          </>
        )}
      </div>

      <nav className={clsx("flex-1 space-y-1 overflow-y-auto", collapsed ? "p-2" : "p-3")}>
        <button
          onClick={() => setNewsOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center py-2 rounded-lg text-sm transition",
            collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
            isNewsRoute(pathname) && !newsOpen
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
          title={collapsed ? t("nav.news") : undefined}
        >
          <Newspaper size={18} />
          <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "flex-1 text-left")}>{t("nav.news")}</span>
          <ChevronDown size={15} className={clsx("transition shrink-0", collapsed && "opacity-0", newsOpen && "rotate-180")} />
        </button>

        {newsOpen && (
          <div className={clsx("space-y-1", collapsed ? "ml-0 pl-0" : "ml-4 pl-3 border-l border-border")}>
            {NEWS_CHILDREN.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center py-2 rounded-lg text-sm transition",
                  collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
                title={collapsed ? t(c.key) : undefined}
              >
                <c.icon size={16} />
                <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t(c.key)}</span>
              </Link>
            ))}
          </div>
        )}

        {LINKS.filter(
          (l) => isNavItemVisible(l, hiddenFeatures, hiddenForUsersOnly, isAdmin) && !(demo && isDemoBlocked(l.href)),
        ).map((l) => {
          const active =
            l.href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              onClick={onNavigate}
              className={clsx(
                "flex items-center py-2 rounded-lg text-sm transition",
                collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
                active ? "bg-accent/15 text-accent" : "text-muted hover:text-fg hover:bg-surface-2",
              )}
              title={collapsed ? t(l.key) : undefined}
            >
              <l.icon size={18} />
              <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t(l.key)}</span>
            </Link>
          );
        })}

        {visibleService.length > 0 && (
        <button
          onClick={() => setServiceOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center py-2 rounded-lg text-sm transition",
            collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
            isServiceRoute(pathname) && !serviceOpen
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
          title={collapsed ? t("nav.service") : undefined}
        >
          <Wrench size={18} />
          <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "flex-1 text-left")}>{t("nav.service")}</span>
          <ChevronDown size={15} className={clsx("transition shrink-0", collapsed && "opacity-0", serviceOpen && "rotate-180")} />
        </button>
        )}

        {serviceOpen && visibleService.length > 0 && (
          <div className={clsx("space-y-1", collapsed ? "ml-0 pl-0" : "ml-4 pl-3 border-l border-border")}>
            {visibleService.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center py-2 rounded-lg text-sm transition",
                  collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
                title={collapsed ? t(c.key) : undefined}
              >
                <c.icon size={16} />
                <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t(c.key)}</span>
              </Link>
            ))}
          </div>
        )}

        {visibleSettings.length > 0 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className={clsx(
            "w-full flex items-center py-2 rounded-lg text-sm transition",
            collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
            isSettingsRoute(pathname) && !open
              ? "text-accent"
              : "text-muted hover:text-fg hover:bg-surface-2",
          )}
          title={collapsed ? t("nav.settings") : undefined}
        >
          <Settings size={18} />
          <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "flex-1 text-left")}>{t("nav.settings")}</span>
          <ChevronDown size={15} className={clsx("transition shrink-0", collapsed && "opacity-0", open && "rotate-180")} />
        </button>
        )}

        {open && visibleSettings.length > 0 && (
          <div className={clsx("space-y-1", collapsed ? "ml-0 pl-0" : "ml-4 pl-3 border-l border-border")}>
            {visibleSettings.map((c) => (
              <Link
                key={c.href}
                href={c.href}
                onClick={onNavigate}
                className={clsx(
                  "flex items-center py-2 rounded-lg text-sm transition",
                  collapsed ? "px-1.5 gap-0" : "px-3 gap-3",
                  childActive(c.href)
                    ? "bg-accent/15 text-accent"
                    : "text-muted hover:text-fg hover:bg-surface-2",
                )}
                title={collapsed ? t(c.key) : undefined}
              >
                <c.icon size={16} />
                <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t(c.key)}</span>
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className={clsx("border-t border-border shrink-0", collapsed ? "p-2" : "p-3")}>
        <div className={clsx("text-xs text-faint truncate", collapsed ? "px-1.5 py-1" : "px-3 py-2")}>
          <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{email}</span>
        </div>
        {isAdmin && !demo && (
          <Link
            href="/admin"
            onClick={onNavigate}
            className={clsx("flex w-full items-center py-2 rounded-lg text-sm text-muted hover:text-accent hover:bg-surface-2 transition", collapsed ? "px-1.5 gap-0" : "px-3 gap-3")}
            title={collapsed ? t("nav.admin") : undefined}
          >
            <span className="relative inline-flex">
              <ShieldCheck size={18} />
              {supportUnread + errorsUnread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[15px] h-[15px] px-[3px] rounded-full bg-loss text-white text-[9px] font-semibold leading-[15px] text-center">
                  {supportUnread + errorsUnread > 99 ? "99+" : supportUnread + errorsUnread}
                </span>
              )}
            </span>
            <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t("nav.admin")}</span>
          </Link>
        )}
        {!demo && <SupportButton onOpen={onNavigate} collapsed={collapsed} />}
        <DonateButton onOpen={onNavigate} collapsed={collapsed} />
        <button
          onClick={() => {
            onNavigate();
            logout();
          }}
          className={clsx("flex w-full items-center py-2 rounded-lg text-sm text-muted hover:text-loss hover:bg-surface-2 transition", collapsed ? "px-1.5 gap-0" : "px-3 gap-3")}
          title={collapsed ? t("nav.logout") : undefined}
        >
          <LogOut size={18} />
          <span className={clsx("transition-opacity duration-300", collapsed ? "opacity-0 w-0 overflow-hidden" : "")}>{t("nav.logout")}</span>
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
      <aside className={clsx(
          "hidden md:flex shrink-0 border-r border-border glass-panel flex-col h-screen sticky top-0 z-50 transition-[width] duration-300 ease-premium overflow-hidden",
          collapsed ? "w-14" : "w-60",
        )}>
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
