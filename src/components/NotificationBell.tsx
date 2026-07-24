"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellDot } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

type Announcement = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
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

export default function NotificationBell({ collapsed }: { collapsed?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef<HTMLDivElement>(null);

  const unread = announcements.filter((a) => !a.readAt).length;
  const unreadAnnouncements = announcements.filter((a) => !a.readAt);

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
      const res = await fetch("/api/announcements");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements ?? []);
        setError(false);
      } else {
        setError(true);
      }
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

  const markRead = useCallback(async (id: string) => {
    // Optimistic update
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, readAt: new Date().toISOString() } : a)),
    );
    setExpandedId((prev) => (prev === id ? id : prev));

    try {
      await fetch("/api/announcements/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementId: id }),
      });
    } catch {
      // Revert on failure
      setAnnouncements((prev) =>
        prev.map((a) => (a.id === id ? { ...a, readAt: null } : a)),
      );
    }
  }, []);

  const handleClick = useCallback(
    (a: Announcement) => {
      if (expandedId === a.id) {
        setExpandedId(null);
      } else {
        setExpandedId(a.id);
        if (!a.readAt) markRead(a.id);
      }
    },
    [expandedId, markRead],
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
        aria-label={t("announcements.title")}
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
            <h3 className="text-sm font-semibold">{t("announcements.title")}</h3>
          </div>

          <div className="divide-y divide-border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
                <span className="h-3 w-3 rounded-full border-2 border-faint/40 border-t-accent animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="py-8 text-xs text-muted text-center">{t("common.error")}</div>
            ) : unreadAnnouncements.length === 0 ? (
              <div className="py-8 text-xs text-muted text-center">{t("announcements.empty")}</div>
            ) : (
              unreadAnnouncements.map((a) => {
                const isUnread = !a.readAt;
                const isExpanded = expandedId === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => handleClick(a)}
                    className={clsx(
                      "w-full min-w-0 text-left px-4 py-2.5 transition border-l-2 hover:bg-surface-2",
                      isUnread
                        ? "border-l-accent font-semibold"
                        : "border-l-transparent font-normal",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span
                        className={clsx(
                          "text-sm leading-tight break-words",
                          isUnread ? "text-fg" : "text-faint",
                        )}
                      >
                        {a.title}
                      </span>
                      <span className="text-[10px] text-faint whitespace-nowrap shrink-0 mt-0.5">
                        {fmtAge(a.createdAt, t)}
                      </span>
                    </div>
                    <p
                      className={clsx(
                        "text-xs text-muted mt-1 leading-relaxed whitespace-pre-wrap break-words",
                        isExpanded ? "" : "line-clamp-2",
                      )}
                    >
                      {a.body}
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