"use client";

import { useEffect, useState } from "react";
import { Save, Check, ShieldAlert } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { defaultRiskProfile, PERIODS, type RiskProfileData, type PeriodKey } from "@/lib/risk";

type Account = { id: string; label: string; exchange: string; balance: number | null };

export default function RiskManager() {
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [def, setDef] = useState<RiskProfileData>(defaultRiskProfile());
  const [overrides, setOverrides] = useState<Record<string, RiskProfileData>>({});
  const [customOn, setCustomOn] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const [accRes, riskRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/risk/settings"),
      ]);
      if (accRes.ok) setAccounts(await accRes.json());
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

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const profiles: Record<string, RiskProfileData | null> = { "": def };
      for (const a of accounts) {
        profiles[a.id] = customOn[a.id] ? overrides[a.id] ?? structuredClone(def) : null;
      }
      const res = await fetch("/api/risk/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
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

      <ProfileEditor
        heading={t("risk.default")}
        value={def}
        onChange={setDef}
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
              />
            </div>
          )}
        </div>
      ))}

      <button
        onClick={save}
        disabled={saving}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
      >
        {saved ? <Check size={16} /> : <Save size={16} />}
        {saved ? t("common.saved") : saving ? t("common.saving") : t("common.save")}
      </button>
    </div>
  );
}

function ProfileEditor({
  heading,
  value,
  onChange,
}: {
  heading?: string;
  value: RiskProfileData;
  onChange: (v: RiskProfileData) => void;
}) {
  const { t } = useI18n();
  const set = (patch: Partial<RiskProfileData>) => onChange({ ...value, ...patch });
  const setLimit = (key: PeriodKey, patch: Partial<RiskProfileData["lossLimits"][PeriodKey]>) =>
    onChange({
      ...value,
      lossLimits: { ...value.lossLimits, [key]: { ...value.lossLimits[key], ...patch } },
    });

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
            value={value.maxStopsPerDay ?? ""}
            placeholder="—"
            onChange={(e) =>
              set({ maxStopsPerDay: e.target.value ? Math.max(0, Number(e.target.value)) : null })
            }
            className="input-base w-24 text-right text-sm py-1"
          />
        </div>

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
              <input
                type="number"
                min={0}
                value={l.value || ""}
                placeholder="0"
                disabled={!l.on}
                onChange={(e) => setLimit(p, { value: Math.max(0, Number(e.target.value) || 0) })}
                className="input-base w-28 text-right text-sm py-1 disabled:opacity-40"
              />
              <select
                value={l.unit}
                disabled={!l.on}
                onChange={(e) => setLimit(p, { unit: e.target.value as "pct" | "amount" })}
                className="input-base text-sm py-1 cursor-pointer disabled:opacity-40"
              >
                <option value="pct">% {t("risk.ofDeposit")}</option>
                <option value="amount">$</option>
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
