"use client";

import { useEffect, useState } from "react";
import { Plus, X, Save, Check } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

export default function TradeSettingsPage() {
  const { t } = useI18n();
  const [entryPoints, setEntryPoints] = useState<string[]>([]);
  const [entryTypes, setEntryTypes] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/settings");
      if (res.ok) {
        const d = await res.json();
        setEntryPoints(d.entryPointOptions);
        setEntryTypes(d.entryTypeOptions);
        setMistakes(d.mistakeOptions);
        setPatterns(d.patternOptions);
      }
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryPointOptions: entryPoints,
          entryTypeOptions: entryTypes,
          mistakeOptions: mistakes,
          patternOptions: patterns,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? t("settings.saveError"));
        return;
      }
      setEntryPoints(d.entryPointOptions);
      setEntryTypes(d.entryTypeOptions);
      setMistakes(d.mistakeOptions);
      setPatterns(d.patternOptions);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-6 py-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">{t("nav.tradeSettings")}</h1>
        <p className="text-sm text-muted">{t("settings.subtitle")}</p>
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : (
        <div className="space-y-5">
          <ListEditor
            title={t("settings.entryPoints")}
            hint={t("settings.entryPointsHint")}
            items={entryPoints}
            onChange={setEntryPoints}
          />
          <ListEditor
            title={t("settings.entryTypes")}
            hint={t("settings.entryTypesHint")}
            items={entryTypes}
            onChange={setEntryTypes}
          />
          <ListEditor
            title={t("settings.mistakes")}
            hint={t("settings.mistakesHint")}
            items={mistakes}
            onChange={setMistakes}
          />
          <ListEditor
            title={t("settings.patterns")}
            hint={t("settings.patternsHint")}
            items={patterns}
            onChange={setPatterns}
          />

          {error && (
            <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition disabled:opacity-50"
          >
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saved ? t("common.saved") : saving ? t("common.saving") : t("common.save")}
          </button>
        </div>
      )}
    </div>
  );
}

function ListEditor({
  title,
  hint,
  items,
  onChange,
}: {
  title: string;
  hint: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  function add() {
    const v = draft.trim();
    if (!v || items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div className="card p-5">
      <h3 className="font-medium text-sm">{title}</h3>
      <p className="text-xs text-faint mb-3">{hint}</p>

      <div className="flex flex-wrap gap-2 mb-3">
        {items.length === 0 && (
          <span className="text-xs text-faint">{t("settings.listEmpty")}</span>
        )}
        {items.map((item, i) => (
          <span
            key={item}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 border border-border px-2.5 py-1 text-sm"
          >
            {item}
            <button
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-faint hover:text-loss"
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          className="input-base flex-1"
          maxLength={60}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={t("settings.addValue")}
        />
        <button
          onClick={add}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg input-base hover:border-border-strong"
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
