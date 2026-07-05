"use client";

import { useEffect, useState } from "react";
import { Share2, Copy, Trash2, Check, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Link = { id: string; token: string; label: string | null; createdAt: string; lastViewedAt: string | null };
type FeatureValue = { enabled: boolean; maxLinksPerUser: number };

export default function MentorShareSettings() {
  const { t } = useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    const [featureRes, linksRes] = await Promise.all([
      fetch("/api/features?key=mentorMode"),
      fetch("/api/share-links"),
    ]);
    if (featureRes.ok) setFeature((await featureRes.json()).value);
    if (linksRes.ok) setLinks((await linksRes.json()).links ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  if (!feature?.enabled) return null;

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/share-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      if (res.ok) {
        setLabel("");
        await load();
      } else {
        alert((await res.json()).error ?? t("mentor.error"));
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm(t("mentor.confirmRevoke"))) return;
    setBusy(true);
    try {
      await fetch(`/api/share-links?id=${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  function copy(link: Link) {
    const url = `${window.location.origin}/share/${link.token}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(link.id);
      setTimeout(() => setCopiedId(null), 1500);
    });
  }

  return (
    <div className="card p-5 mb-5">
      <h3 className="font-medium text-sm flex items-center gap-1.5">
        <Share2 size={15} className="text-accent" /> {t("mentor.title")}
      </h3>
      <p className="text-xs text-faint mt-0.5">{t("mentor.hint")}</p>

      <p className="text-xs text-faint mt-2">{t("mentor.whatIsShown")}</p>

      <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5 mt-3 mb-4 text-xs text-muted">
        <AlertTriangle size={14} className="text-warn shrink-0 mt-0.5" />
        <span>{t("mentor.securityWarning")}</span>
      </div>

      <label className="text-xs text-faint block mb-1">{t("mentor.labelFieldLabel")}</label>
      <div className="flex items-center gap-2 mb-1">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("mentor.labelPlaceholder")}
          className="input-base flex-1 px-3 py-1.5 text-sm"
          maxLength={80}
        />
        <button
          onClick={create}
          disabled={busy || links.length >= (feature.maxLinksPerUser ?? 5)}
          title={t("mentor.createHint")}
          className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
        >
          {t("mentor.create")}
        </button>
      </div>
      <p className="text-xs text-faint mb-1">{t("mentor.labelFieldHint")}</p>
      <p className="text-xs text-faint mb-3">
        {t("mentor.limitNote", { n: links.length, max: feature.maxLinksPerUser ?? 5 })}
      </p>

      <div className="space-y-2">
        {links.map((l) => (
          <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate">{l.label || t("mentor.unlabeled")}</div>
              <div className="text-xs text-faint">
                {l.lastViewedAt ? t("mentor.lastViewed", { date: new Date(l.lastViewedAt).toLocaleString() }) : t("mentor.neverViewed")}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => copy(l)} className="input-base p-1.5 text-muted hover:text-fg" title={t("mentor.copy")}>
                {copiedId === l.id ? <Check size={14} className="text-profit" /> : <Copy size={14} />}
              </button>
              <button onClick={() => revoke(l.id)} className="input-base p-1.5 text-muted hover:text-loss" title={t("mentor.revoke")}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {links.length === 0 && <p className="text-xs text-faint">{t("mentor.empty")}</p>}
        {links.length > 0 && <p className="text-[11px] text-faint pt-1">{t("mentor.iconsLegend")}</p>}
      </div>
    </div>
  );
}
