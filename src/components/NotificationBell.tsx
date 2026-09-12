"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellDot, Megaphone, TrendingUp, CalendarClock } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
};

// Личное уведомление пользователя: подход цены к уровню, скорый выход новости
// (см. lib/notifications.ts). В колокольчик попадает наравне с объявлениями.
type UserNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
  readAt: string | null;
};

// Колокольчик показывает ДВА разных источника одним списком: объявления
// администратора (общие для всех, своя отметка о прочтении) и личные
// уведомления. Приводим их к одному виду, чтобы список сортировался по
// времени, а не по тому, откуда строка пришла.
type Item = {
  id: string;
  source: "announcement" | "notification";
  kind: string;
  title: string;
  body: string;
  url: string | null;
  createdAt: string;
  readAt: string | null;
};

const KIND_ICON: Record<string, typeof Megaphone> = {
  announcement: Megaphone,
  level_alert: TrendingUp,
  econcal: CalendarClock,
};

const POLL_MS = 60_000;

function fmtAge(iso: string, t: (k: string) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("announcements.justNow");
  if (min < 60) return t("announcements.minutesAgo").replace("{n}", String(min));
  const hours = Math.floor(min / 60);
  if (hours < 24) return t("announcements.hoursAgo").replace("{n}", String(hours));
  const days = Math.floor(hours / 24);
  return t("announcements.daysAgo").replace("{n}", String(days));
}

export default function NotificationBell({ collapsed: _collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const items: Item[] = [
    ...announcements.map((a) => ({
      id: a.id,
      source: "announcement" as const,
      kind: "announcement",
      title: a.title,
      body: a.body,
      url: null,
      createdAt: a.createdAt,
      readAt: a.readAt,
    })),
    ...notifications.map((n) => ({
      id: n.id,
      source: "notification" as const,
      kind: n.kind,
      title: n.title,
      body: n.body,
      url: n.url,
      createdAt: n.createdAt,
      readAt: n.readAt,
    })),
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const unreadItems = items.filter((i) => !i.readAt);
  const unread = unreadItems.length;

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const fetchAnnouncements = useCallback(async () => {
    try {
      // Оба источника одним заходом. allSettled, а не Promise.all: недоступность
      // одного не должна прятать второй — в колокольчике это выглядело бы как
      // «уведомлений нет», хотя они есть.
      const [annRes, notifRes] = await Promise.allSettled([
        fetch("/api/announcements"),
        fetch("/api/notifications"),
      ]);
      let ok = false;
      if (annRes.status === "fulfilled" && annRes.value.ok) {
        setAnnouncements((await annRes.value.json()).announcements ?? []);
        ok = true;
      }
      if (notifRes.status === "fulfilled" && notifRes.value.ok) {
        setNotifications((await notifRes.value.json()).notifications ?? []);
        ok = true;
      }
      setError(!ok);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchAnnouncements();
    const iv = setInterval(fetchAnnouncements, POLL_MS);
    return () => clearInterval(iv);
  }, [fetchAnnouncements]);

  // Отметка о прочтении у двух источников своя: у объявлений отдельная таблица
  // на пару «объявление + пользователь», у личных уведомлений — поле в самой
  // строке. Наружу это одна операция.
  const markRead = useCallback(async (item: Item) => {
    const now = new Date().toISOString();
    if (item.source === "announcement") {
      setAnnouncements((prev) => prev.map((a) => (a.id === item.id ? { ...a, readAt: now } : a)));
    } else {
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: now } : n)));
    }

    try {
      const res =
        item.source === "announcement"
          ? await fetch("/api/announcements/read", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ announcementId: item.id }),
            })
          : await fetch("/api/notifications", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: item.id }),
            });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      // Не сохранилось — возвращаем как было, иначе счётчик врал бы до
      // перезагрузки страницы.
      if (item.source === "announcement") {
        setAnnouncements((prev) => prev.map((a) => (a.id === item.id ? { ...a, readAt: null } : a)));
      } else {
        setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, readAt: null } : n)));
      }
    }
  }, []);

  const handleClick = useCallback(
    (item: Item) => {
      // У личного уведомления есть адрес — по клику ведём туда, ради этого
      // оно и пришло («цена у уровня» без перехода к уровню бесполезна).
      if (item.url) {
        if (!item.readAt) markRead(item);
        setOpen(false);
        router.push(item.url);
        return;
      }
      // У объявления адреса нет — по клику разворачиваем текст на месте.
      if (expandedId === item.id) {
        setExpandedId(null);
      } else {
        setExpandedId(item.id);
        if (!item.readAt) markRead(item);
      }
    },
    [expandedId, markRead, router],
  );

  const toggleOpen = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((o) => !o);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggleOpen}
        className={clsx(
          "relative p-1.5 text-muted hover:text-fg transition rounded-lg hover:bg-surface-2",
          open && "text-fg bg-surface-2",
        )}
        aria-label={t("notifications.title")}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <BellDot size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold leading-none text-white bg-loss rounded-full">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="fixed z-[100] w-96 bg-surface border border-border rounded-xl shadow-xl overflow-hidden"
          style={{ top: pos.top, left: pos.left }}
        >
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">{t("notifications.title")}</h3>
          </div>

          <div className="divide-y divide-border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                <span className="h-3 w-3 rounded-full border-2 border-faint/40 border-t-accent animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="py-8 text-xs text-muted text-center">{t("common.error")}</div>
            ) : unreadItems.length === 0 ? (
              <div className="py-8 text-xs text-muted text-center">{t("notifications.empty")}</div>
            ) : (
              unreadItems.map((item) => {
                const isUnread = !item.readAt;
                const isExpanded = expandedId === item.id;
                // Значок сразу говорит, что это: объявление, подход цены к
                // уровню или скорая новость. В смешанном списке без него
                // приходится вчитываться в каждую строку.
                const Icon = KIND_ICON[item.kind] ?? Megaphone;
                return (
                  <button
                    key={`${item.source}:${item.id}`}
                    onClick={() => handleClick(item)}
                    className={clsx(
                      "w-full min-w-0 text-left px-4 py-2.5 transition border-l-2 hover:bg-surface-2",
                      isUnread
                        ? "border-l-accent font-semibold"
                        : "border-l-transparent font-normal",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span className="flex items-start gap-2 min-w-0">
                        <Icon
                          size={14}
                          className={clsx(
                            "shrink-0 mt-0.5",
                            item.kind === "level_alert"
                              ? "text-accent"
                              : item.kind === "econcal"
                                ? "text-warn"
                                : "text-muted",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm leading-tight break-words",
                            isUnread ? "text-fg" : "text-faint",
                          )}
                        >
                          {item.title}
                        </span>
                      </span>
                      <span className="text-[10px] text-faint whitespace-nowrap shrink-0 mt-0.5">
                        {fmtAge(item.createdAt, t)}
                      </span>
                    </div>
                    <p
                      className={clsx(
                        "text-xs text-muted mt-1 leading-relaxed whitespace-pre-wrap break-words pl-[22px]",
                        isExpanded ? "" : "line-clamp-2",
                      )}
                    >
                      {item.body}
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}