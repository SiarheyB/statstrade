"use client";

import { useEffect, useRef, useState } from "react";
import { Save, Check, ShieldAlert, ArrowRight, AlertTriangle } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import {
  defaultRiskProfile,
  riskChangeNeedsComment,
  riskPerTradeAmount,
  PERIODS,
  type RiskProfileData,
  type PeriodKey,
  type PeriodLimit,
} from "@/lib/risk";
import { Select } from "@/components/Select";
import RiskHistory from "@/components/RiskHistory";

type Account = { id: string; label: string; exchange: string; source: string; balance: number | null };

export default function RiskManager() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [def, setDef] = useState<RiskProfileData>(defaultRiskProfile());
  const [overrides, setOverrides] = useState<Record<string, RiskProfileData>>({});
  const [customOn, setCustomOn] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Профили, какими они лежат в БД. Нужны, чтобы понять, ПОМЕНЯЛСЯ ли риск:
  // сравнивать текущую форму не с чем, как только человек начал в ней править.
  const [baseline, setBaseline] = useState<Record<string, RiskProfileData>>({});
  const [comment, setComment] = useState("");
  // Счётчик удачных сохранений — по нему карточка истории перечитывает себя.
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    (async () => {
      const [accRes, riskRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/risk/settings"),
      ]);
      if (accRes.ok) {
        // Risk monitoring is for live exchange accounts only — imported (forex)
        // accounts have no real-time state, so they're excluded here.
        const all = (await accRes.json()) as Account[];
        setAccounts(all.filter((a) => a.source === "exchange"));
      }
      if (riskRes.ok) {
        const { profiles } = (await riskRes.json()) as {
          profiles: Record<string, RiskProfileData>;
        };
        if (profiles[""]) setDef(profiles[""]);
        const ov: Record<string, RiskProfileData> = {};
        const on: Record<string, boolean> = {};
        for (const [id, p] of Object.entries(profiles)) {
          if (id === "") continue;
          ov[id] = p;
          on[id] = true;
        }
        setOverrides(ov);
        setCustomOn(on);
        setBaseline(profiles);
      }
      setLoading(false);
    })();
  }, []);

  function toggleCustom(id: string, on: boolean) {
    setCustomOn((c) => ({ ...c, [id]: on }));
    if (on && !overrides[id]) {
      // seed an override from the current default
      setOverrides((o) => ({ ...o, [id]: structuredClone(def) }));
    }
  }

  // Что отправится на сервер — одно и то же и для сохранения, и для подсчёта
  // изменений риска, иначе форма и журнал решений разъехались бы.
  function buildProfiles(): Record<string, RiskProfileData | null> {
    const profiles: Record<string, RiskProfileData | null> = { "": def };
    for (const a of accounts) {
      profiles[a.id] = customOn[a.id] ? overrides[a.id] ?? structuredClone(def) : null;
    }
    return profiles;
  }

  // Профили, у которых риск на сделку реально меняется этим сохранением.
  // Правило — riskChangeNeedsComment (lib/risk.ts), ровно то же, что на
  // сервере: расхождение означало бы либо отказ в сохранении без объяснения,
  // либо требование комментария там, где сервер его не ждёт.
  const OFF: PeriodLimit = { on: false, value: 0, unit: "pct" };
  const baseDefault = baseline[""] ?? defaultRiskProfile();
  const pending = buildProfiles();
  const riskChanges = Object.entries(pending)
    .map(([accountId, prof]) => {
      const prev =
        baseline[accountId]?.riskPerTrade ??
        (accountId === "" ? OFF : baseDefault.riskPerTrade);
      const next = prof === null ? pending[""]?.riskPerTrade ?? OFF : prof.riskPerTrade;
      return { accountId, prev, next };
    })
    .filter((c) => riskChangeNeedsComment(c.prev, c.next));
  const needsComment = riskChanges.length > 0;

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const profiles = buildProfiles();
      const res = await fetch("/api/risk/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles, comment: comment.trim() || undefined }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        // Сохранённое становится новой точкой отсчёта: иначе блок «риск
        // изменён» остался бы висеть над уже сохранёнными настройками.
        const next: Record<string, RiskProfileData> = { "": def };
        for (const a of accounts) {
          if (customOn[a.id]) next[a.id] = overrides[a.id] ?? structuredClone(def);
        }
        setBaseline(next);
        setComment("");
        setHistoryVersion((v) => v + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm text-faint">{t("common.loading")}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <ShieldAlert size={20} className="text-accent shrink-0 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold">{t("risk.title")}</h2>
          <p className="text-sm text-muted">{t("risk.subtitle")}</p>
        </div>
      </div>

      <div className="card p-4 text-sm text-muted bg-surface-2/40 border-accent/20">
        <span className="font-medium text-fg">{t("risk.riskPerTrade")}.</span> {t("risk.autoMistake")}
      </div>

      <ProfileEditor
        heading={t("risk.default")}
        value={def}
        onChange={setDef}
        balance={accounts.reduce((s, a) => s + (a.balance ?? 0), 0) || null}
        change={riskChanges.find((c) => c.accountId === "") ?? null}
      />

      {accounts.map((a) => (
        <div key={a.id} className="card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">{a.label}</div>
              <div className="text-xs text-faint">
                {a.balance != null ? `${t("risk.balance")}: ${fmtUsd(a.balance)}` : t("risk.noBalance")}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!customOn[a.id]}
                onChange={(e) => toggleCustom(a.id, e.target.checked)}
                className="accent-accent h-4 w-4"
              />
              {t("risk.perAccount")}
            </label>
          </div>
          {customOn[a.id] && (
            <div className="mt-4 pt-4 border-t border-border">
              <ProfileEditor
                value={overrides[a.id] ?? def}
                onChange={(v) => setOverrides((o) => ({ ...o, [a.id]: v }))}
                balance={a.balance}
                change={riskChanges.find((c) => c.accountId === a.id) ?? null}
              />
            </div>
          )}
        </div>
      ))}

      {/* Комментарий ОДИН на сохранение, хотя изменений риска может быть
          несколько (общий профиль + свои настройки счетов): на сервере одно
          решение человека разворачивается в версию на каждый счёт, и просить
          по тексту на каждую — требовать переписывать одно и то же. Поэтому
          у строк риска стоит только маркер «было → стало», а поле здесь. */}
      {needsComment && (
        <div className="card p-4 border-warn/40 bg-warn/5 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-warn shrink-0" />
            <span className="text-sm font-medium">{t("risk.comment.title")}</span>
          </div>
          <label htmlFor="risk-comment" className="block text-sm text-muted">
            {t("risk.comment.label")} <span className="text-loss">*</span>
          </label>
          <textarea
            id="risk-comment"
            rows={2}
            maxLength={300}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t("risk.comment.placeholder")}
            className="input-base w-full text-sm resize-y"
          />
          <div className="flex justify-between text-xs text-faint">
            <span>{t("risk.comment.hint")}</span>
            <span className="tabular-nums">{comment.trim().length} / 300</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={save}
          disabled={saving || (needsComment && !comment.trim())}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
        >
          {saved ? <Check size={16} /> : <Save size={16} />}
          {saved ? t("common.saved") : saving ? t("common.saving") : t("common.save")}
        </button>
        {needsComment && !comment.trim() && (
          <span className="text-sm text-warn">{t("risk.comment.required")}</span>
        )}
      </div>

      <RiskHistory reloadKey={historyVersion} />
    </div>
  );
}

// Маркер «риск изменён» под строкой риска: было → стало и во что это выльется
// в деньгах. Поля для комментария тут нет намеренно — он один на сохранение,
// см. комментарий у блока в RiskManager.
function RiskChangeMark({
  change,
  balance,
}: {
  change: { prev: PeriodLimit; next: PeriodLimit };
  balance: number | null;
}) {
  const { t } = useI18n();
  const fmtLimit = (l: PeriodLimit) =>
    l.unit === "pct" ? l.value + " %" : fmtUsd(l.value);
  // 1R в деньгах считаем через riskPerTradeAmount, а не вручную: там учтены и
  // единица, и выключенный профиль, и отсутствие баланса.
  const asProfile = (l: PeriodLimit): RiskProfileData => ({
    ...defaultRiskProfile(),
    enabled: true,
    riskPerTrade: l,
  });
  const prevR = riskPerTradeAmount(asProfile(change.prev), balance);
  const nextR = riskPerTradeAmount(asProfile(change.next), balance);
  return (
    <div className="ml-6 border-l-2 border-warn rounded-r-lg bg-warn/5 px-3 py-2 flex items-center gap-2 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wide text-warn">
        {t("risk.change.badge")}
      </span>
      <span className="text-sm text-muted tabular-nums">{fmtLimit(change.prev)}</span>
      <ArrowRight size={13} className="text-faint" />
      <span className="text-sm font-medium text-warn tabular-nums">{fmtLimit(change.next)}</span>
      {prevR != null && nextR != null && (
        <span className="text-xs text-faint tabular-nums">
          · 1R: {fmtUsd(prevR)} → {fmtUsd(nextR)}
        </span>
      )}
    </div>
  );
}

function ProfileEditor({
  heading,
  value,
  onChange,
  balance,
  change,
}: {
  heading?: string;
  value: RiskProfileData;
  onChange: (v: RiskProfileData) => void;
  balance: number | null;
  // Несохранённое изменение риска этого профиля — маркер «было → стало».
  change?: { prev: PeriodLimit; next: PeriodLimit } | null;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<RiskProfileData>) => onChange({ ...value, ...patch });
  const setLimit = (key: PeriodKey, patch: Partial<RiskProfileData["lossLimits"][PeriodKey]>) =>
    onChange({
      ...value,
      lossLimits: { ...value.lossLimits, [key]: { ...value.lossLimits[key], ...patch } },
    });

  // $ equivalent of a percent-based limit (nothing for $ limits or no balance).
  function moneyHint(l: { on: boolean; value: number; unit: "pct" | "amount" }) {
    if (!l.on || l.unit !== "pct" || !l.value || balance == null || balance <= 0) return null;
    return (
      <span className="text-xs text-faint tabular-nums whitespace-nowrap">
        ≈ {fmtUsd((balance * l.value) / 100)}
      </span>
    );
  }

  return (
    <div className={heading ? "card p-4" : ""}>
      {heading && <h3 className="font-medium mb-3">{heading}</h3>}

      <label className="flex items-center gap-2 text-sm cursor-pointer select-none mb-4">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => set({ enabled: e.target.checked })}
          className="accent-accent h-4 w-4"
        />
        <span className="font-medium">{t("risk.enable")}</span>
      </label>

      <div className={value.enabled ? "space-y-3" : "space-y-3 opacity-40 pointer-events-none"}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">{t("risk.stopsPerDay")}</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={value.maxStopsPerDay ?? ""}
            placeholder="—"
            onChange={(e) =>
              set({ maxStopsPerDay: e.target.value ? Math.max(0, Number(e.target.value)) : null })
            }
            className="input-base w-24 text-right text-sm py-1"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            checked={value.riskPerTrade.on}
            onChange={(e) => set({ riskPerTrade: { ...value.riskPerTrade, on: e.target.checked } })}
            className="accent-accent h-4 w-4"
          />
          <span className="text-sm flex-1">{t("risk.riskPerTrade")}</span>
          <NumField
            value={value.riskPerTrade.value}
            disabled={!value.riskPerTrade.on}
            onChange={(n) => set({ riskPerTrade: { ...value.riskPerTrade, value: n } })}
            className="input-base w-28 text-right text-sm py-1 disabled:opacity-40"
          />
          <Select
            value={value.riskPerTrade.unit}
            disabled={!value.riskPerTrade.on}
            onChange={(e) =>
              set({
                riskPerTrade: {
                  ...value.riskPerTrade,
                  unit: e.target.value as "pct" | "amount",
                },
              })
            }
            className="input-base text-sm py-1 cursor-pointer disabled:opacity-40"
          >
            <option value="pct">% {t("risk.ofDeposit")}</option>
            <option value="amount">$</option>
          </Select>
          {moneyHint(value.riskPerTrade)}
        </div>
        {change && <RiskChangeMark change={change} balance={balance} />}
        <p className="text-xs text-faint -mt-1">{t("risk.riskPerTradeHint")}</p>

        <div className="text-xs text-faint uppercase tracking-wide pt-1">{t("risk.lossLimits")}</div>
        {PERIODS.map((p) => {
          const l = value.lossLimits[p];
          return (
            <div key={p} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={l.on}
                onChange={(e) => setLimit(p, { on: e.target.checked })}
                className="accent-accent h-4 w-4"
              />
              <span className="text-sm w-20">{t(`risk.period.${p}`)}</span>
              <NumField
                value={l.value}
                disabled={!l.on}
                onChange={(n) => setLimit(p, { value: n })}
                className="input-base w-28 text-right text-sm py-1 disabled:opacity-40"
              />
              <Select
                value={l.unit}
                disabled={!l.on}
                onChange={(e) => setLimit(p, { unit: e.target.value as "pct" | "amount" })}
                className="input-base text-sm py-1 cursor-pointer disabled:opacity-40"
              >
                <option value="pct">% {t("risk.ofDeposit")}</option>
                <option value="amount">$</option>
              </Select>
              {moneyHint(l)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Numeric input that keeps a string draft while focused, so partial values like
// "0.25" can be typed without the leading 0 being swallowed. Commits a parsed
// number (>= 0) on every keystroke; empty/invalid -> 0.
function NumField({
  value,
  onChange,
  disabled,
  placeholder = "0",
  className,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value ? String(value) : "");
  }, [value]);

  function parse(raw: string): number {
    const cleaned = raw.replace(",", ".").trim();
    if (cleaned === "" || cleaned === ".") return 0;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      maxLength={15}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        const s = e.target.value.replace(/[^\d.,]/g, "");
        setDraft(s);
        onChange(parse(s));
      }}
      onBlur={() => {
        focused.current = false;
        setDraft(value ? String(value) : "");
      }}
      className={className}
    />
  );
}
