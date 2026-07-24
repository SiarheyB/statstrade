"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import clsx from "clsx";
import { format } from "date-fns";

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdAt: string;
};

export default function AdminAnnouncements() {
  const { t } = useI18n();
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchAnnouncements = useCallback(async () => {
    try {
      // Fetch all announcements (including inactive) for admin view
      const res = await fetch("/api/announcements?all=1");
      if (res.ok) {
        const data = await res.json();
        setAnnouncements(data.announcements);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const handleCreate = useCallback(async () => {
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim() }),
      });
      if (res.ok) {
        setTitle("");
        setBody("");
        setCreateOpen(false);
        await fetchAnnouncements();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [title, body, fetchAnnouncements]);

  const handleToggle = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await fetch(`/api/admin/announcements/${id}`, { method: "DELETE" });
        await fetchAnnouncements();
      } catch {
        // ignore
      } finally {
        setBusyId(null);
      }
    },
    [fetchAnnouncements],
  );

  return (
    <div className="mt-6 space-y-4">
      {/* Create button */}
      <button
        onClick={() => setCreateOpen((o) => !o)}
        className="btn-primary text-sm"
      >
        {t("admin.announcements.create")}
      </button>

      {/* Create modal */}
      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="card p-6 w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-4">{t("admin.announcements.create")}</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-muted mb-1">{t("admin.announcements.createTitle")}</label>
                <input
                  className="input-base w-full text-sm"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("admin.announcements.createTitle")}
                  maxLength={200}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">{t("admin.announcements.createBody")}</label>
                <textarea
                  className="input-base w-full text-sm min-h-[120px] resize-y"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t("admin.announcements.createBody")}
                  maxLength={10000}
                  rows={5}
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button
                onClick={() => {
                  setCreateOpen(false);
                  setTitle("");
                  setBody("");
                }}
                className="btn-ghost text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleCreate}
                disabled={saving || !title.trim() || !body.trim()}
                className="btn-primary text-sm"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    {t("common.saving")}
                  </span>
                ) : (
                  t("common.save")
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-xs text-faint">
          <span className="h-3 w-3 rounded-full border-2 border-faint/40 border-t-accent animate-spin" />
          {t("common.loading")}
        </div>
      ) : announcements.length === 0 ? (
        <div className="card p-10 text-center text-muted text-sm">
          {t("admin.announcements.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {announcements.map((a) => (
            <div
              key={a.id}
              className={clsx(
                "card p-4 flex items-start justify-between gap-4",
                !a.active && "opacity-50",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className={clsx("text-sm font-medium", a.active ? "text-fg" : "text-faint")}>
                    {a.title}
                  </h3>
                  {!a.active && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-muted">
                      hidden
                    </span>
                  )}
                  <span className="text-[10px] text-faint">
                    {format(new Date(a.createdAt), "dd.MM.yyyy HH:mm")}
                  </span>
                </div>
                <p className="text-xs text-muted mt-1 whitespace-pre-wrap line-clamp-3">
                  {a.body}
                </p>
              </div>
              <button
                onClick={() => handleToggle(a.id)}
                disabled={busyId === a.id}
                className={clsx(
                  "shrink-0 text-xs px-2.5 py-1 rounded-lg transition",
                  a.active
                    ? "text-loss hover:bg-loss/10"
                    : "text-profit hover:bg-profit/10",
                )}
              >
                {busyId === a.id ? (
                  <span className="h-3 w-3 block rounded-full border-2 border-faint/40 border-t-accent animate-spin" />
                ) : a.active ? (
                  t("admin.announcements.hide")
                ) : (
                  t("admin.announcements.show")
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}