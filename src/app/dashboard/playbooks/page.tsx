"use client";

import { useEffect, useState } from "react";
import { NotebookPen, Plus, Trash2 } from "lucide-react";
import type { StatsResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtPct } from "@/lib/format";

type Playbook = { id: string; name: string; rules: string; updatedAt: string };
type FeatureValue = { enabled: boolean; maxPerUser: number };

export default function PlaybooksPage() {
  const { t } = useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [stats, setStats] = useState<StatsResponse["metrics"]["byPattern"]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function load() {
    const [featureRes, pbRes, statsRes] = await Promise.all([
      fetch("/api/features?key=playbooks"),
      fetch("/api/playbooks"),
      fetch("/api/stats?accountId=all"),
    ]);
    if (featureRes.ok) setFeature((await featureRes.json()).value);
    if (pbRes.ok) {
      const j = await pbRes.json();
      setPlaybooks(j.playbooks ?? []);
      setDrafts(Object.fromEntries((j.playbooks ?? []).map((p: Playbook) => [p.name, p.rules])));
    }
    if (statsRes.ok) setStats((await statsRes.json()).metrics?.byPattern ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function save(name: string) {
    setBusy(name);
    try {
      const res = await fetch("/api/playbooks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rules: drafts[name] ?? "" }),
      });
      if (res.ok) {
        const j = await res.json();
        setPlaybooks((ps) => {
          const rest = ps.filter((p) => p.name !== name);
          return [...rest, j.playbook].sort((a, b) => a.name.localeCompare(b.name));
        });
      } else {
        alert((await res.json()).error ?? t("playbooks.error"));
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove(name: string) {
    if (!confirm(t("playbooks.confirmDelete", { name }))) return;
    setBusy(name);
    try {
      await fetch(`/api/playbooks?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      setPlaybooks((ps) => ps.filter((p) => p.name !== name));
      setDrafts((d) => {
        const next = { ...d };
        delete next[name];
        return next;
      });
    } finally {
      setBusy(null);
    }
  }

  function addNew() {
    const name = newName.trim();
    if (!name) return;
    if (playbooks.some((p) => p.name === name)) {
      setNewName("");
      return;
    }
    setDrafts((d) => ({ ...d, [name]: "" }));
    setPlaybooks((ps) => [...ps, { id: `draft:${name}`, name, rules: "", updatedAt: new Date().toISOString() }]);
    setNewName("");
  }

  if (loading) return <div className="px-6 py-5 max-w-3xl mx-auto text-sm text-faint">{t("common.loading")}</div>;
  if (!feature?.enabled) return null;

  const statByName = new Map(stats.map((s) => [s.label, s]));

  return (
    <div className="px-6 py-5 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <NotebookPen size={20} className="text-accent" />
          {t("playbooks.title")}
        </h1>
        <p className="text-sm text-muted">{t("playbooks.subtitle")}</p>
      </div>

      <div className="mb-4 flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addNew()}
          placeholder={t("playbooks.newPlaceholder")}
          className="input-base flex-1 px-3 py-2 text-sm"
          maxLength={60}
        />
        <button
          onClick={addNew}
          disabled={playbooks.length >= (feature.maxPerUser ?? 20)}
          className="input-base px-3 py-2 text-sm inline-flex items-center gap-1.5 hover:border-border-strong disabled:opacity-50"
        >
          <Plus size={15} /> {t("playbooks.add")}
        </button>
      </div>
      <p className="text-xs text-faint mb-5">
        {t("playbooks.limitNote", { n: playbooks.length, max: feature.maxPerUser ?? 20 })}
      </p>

      <div className="space-y-3">
        {playbooks.map((p) => {
          const s = statByName.get(p.name);
          return (
            <div key={p.name} className="card p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="font-medium text-sm">{p.name}</h3>
                <button
                  onClick={() => remove(p.name)}
                  disabled={busy === p.name}
                  className="text-xs inline-flex items-center gap-1 text-muted hover:text-loss disabled:opacity-50"
                >
                  <Trash2 size={13} /> {t("playbooks.delete")}
                </button>
              </div>

              {s ? (
                <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
                  <Stat label={t("playbooks.trades")} value={String(s.trades)} />
                  <Stat label={t("playbooks.winRate")} value={fmtPct(s.winRate * 100, 0)} />
                  <Stat label={t("playbooks.netPnl")} value={fmtUsd(s.netPnl, { sign: true })} tone={s.netPnl >= 0 ? "profit" : "loss"} />
                </div>
              ) : (
                <p className="text-xs text-faint mb-3">{t("playbooks.noTrades")}</p>
              )}

              <textarea
                value={drafts[p.name] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.name]: e.target.value }))}
                placeholder={t("playbooks.rulesPlaceholder")}
                rows={4}
                maxLength={5000}
                className="input-base w-full px-3 py-2 text-sm resize-y"
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => save(p.name)}
                  disabled={busy === p.name}
                  className="input-base px-3 py-1.5 text-xs hover:border-border-strong disabled:opacity-50"
                >
                  {t("playbooks.save")}
                </button>
              </div>
            </div>
          );
        })}
        {playbooks.length === 0 && (
          <div className="card p-8 text-center text-sm text-muted">{t("playbooks.empty")}</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div>
      <div className="text-faint">{label}</div>
      <div className={`font-medium tabular-nums ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
    </div>
  );
}
