"use client";

import { useEffect, useState } from "react";
import { Share2, Copy, Trash2, Check, AlertTriangle } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Link = {
  id: string;
  token: string;
  label: string | null;
  createdAt: string;
  lastViewedAt: string | null;
  // null = ссылка показывает сделки всех счетов сразу.
  accountId: string | null;
  // Границы периода в ISO; null с любой стороны = граница не задана.
  periodFrom: string | null;
  periodTo: string | null;
};
type FeatureValue = { enabled: boolean; maxLinksPerUser: number };
type Account = { id: string; label: string; exchange: string };

// Значение пункта «все биржи» в выпадающем списке: пустая строка, а не null —
// у <select> значения всегда строки.
const ALL_ACCOUNTS = "";


export default function MentorShareSettings() {
  const { t } = useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [links, setLinks] = useState<Link[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState(ALL_ACCOUNTS);
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function load() {
    const [featureRes, linksRes, accountsRes] = await Promise.all([
      fetch("/api/features?key=mentorMode"),
      fetch("/api/share-links"),
      fetch("/api/accounts"),
    ]);
    if (featureRes.ok) setFeature((await featureRes.json()).value);
    if (linksRes.ok) setLinks((await linksRes.json()).links ?? []);
    // /api/accounts отдаёт массив; на всякий случай не даём неожиданному
    // ответу уронить весь блок настроек.
    if (accountsRes.ok) {
      const data = await accountsRes.json();
      setAccounts(Array.isArray(data) ? data : []);
    }
  }

  // Подпись периода: «01.06.2026 — 30.06.2026», «с 01.06.2026», «по 30.06.2026»
  // или «всё время», если границ нет.
  function periodLabel(l: Link): string {
    const from = l.periodFrom ? new Date(l.periodFrom).toLocaleDateString() : null;
    // Конец хранится как начало следующих суток — показываем выбранный день.
    const to = l.periodTo ? new Date(new Date(l.periodTo).getTime() - 86_400_000).toLocaleDateString() : null;
    if (from && to) return `${from} — ${to}`;
    if (from) return t("mentor.periodFromOnly", { date: from });
    if (to) return t("mentor.periodToOnly", { date: to });
    return t("mentor.periodAll");
  }

  // Подпись счёта в списке ссылок: «Основной · BYBIT». Счёт могли удалить
  // после создания ссылки — тогда честно говорим, что его больше нет.
  function accountLabel(id: string | null): string {
    if (!id) return t("mentor.allAccounts");
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.label} · ${a.exchange.toUpperCase()}` : t("mentor.accountGone");
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
        body: JSON.stringify({
          label: label.trim() || undefined,
          accountId: accountId || undefined,
          periodFrom: periodFrom || undefined,
          periodTo: periodTo || undefined,
        }),
      });
      if (res.ok) {
        setLabel("");
        setAccountId(ALL_ACCOUNTS);
        setPeriodFrom("");
        setPeriodTo("");
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

      <label className="text-xs text-faint block mb-1">{t("mentor.accountFieldLabel")}</label>
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="input-base w-full px-3 py-1.5 text-sm mb-1"
      >
        <option value={ALL_ACCOUNTS}>{t("mentor.allAccounts")}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label} · {a.exchange.toUpperCase()}
          </option>
        ))}
      </select>
      <p className="text-xs text-faint mb-3">{t("mentor.accountFieldHint")}</p>

      <label className="text-xs text-faint block mb-1">{t("mentor.periodFieldLabel")}</label>
      <div className="flex items-center gap-2 mb-1">
        <input
          type="date"
          value={periodFrom}
          // Календарь «по» не даёт выбрать дату раньше начала — иначе ссылка
          // получилась бы заведомо пустой.
          max={periodTo || undefined}
          onChange={(e) => setPeriodFrom(e.target.value)}
          aria-label={t("mentor.periodFrom")}
          className="input-base flex-1 min-w-0 px-3 py-1.5 text-sm"
        />
        <span className="text-xs text-faint shrink-0">—</span>
        <input
          type="date"
          value={periodTo}
          min={periodFrom || undefined}
          onChange={(e) => setPeriodTo(e.target.value)}
          aria-label={t("mentor.periodTo")}
          className="input-base flex-1 min-w-0 px-3 py-1.5 text-sm"
        />
        {(periodFrom || periodTo) && (
          <button
            onClick={() => {
              setPeriodFrom("");
              setPeriodTo("");
            }}
            title={t("mentor.periodClear")}
            className="input-base px-2 py-1.5 text-xs text-muted hover:text-fg shrink-0"
          >
            {t("mentor.periodClear")}
          </button>
        )}
      </div>
      <p className="text-xs text-faint mb-3">{t("mentor.periodFieldHint")}</p>

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
              <div className="text-xs text-faint truncate">
                {accountLabel(l.accountId)} · {periodLabel(l)}
              </div>
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
