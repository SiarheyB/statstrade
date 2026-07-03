"use client";

import { useEffect, useState } from "react";
import { Trash2, Plus, Save } from "lucide-react";

type Wallet = { id: string; network: string; coin: string; address: string; enabled: boolean };

export default function AdminDonate() {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { network: string; address: string; coin: string }>>({});
  const [newWallet, setNewWallet] = useState({ network: "", coin: "USDT", address: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/donate");
      if (res.ok && alive) {
        const ws: Wallet[] = (await res.json()).wallets ?? [];
        setWallets(ws);
        setDrafts(Object.fromEntries(ws.map((w) => [w.id, { network: w.network, coin: w.coin, address: w.address }])));
      }
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  function updateDraft(id: string, patch: Partial<{ network: string; coin: string; address: string }>) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  }

  async function saveEdits(id: string) {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/donate/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(drafts[id]),
      });
      if (res.ok) setWallets((await res.json()).wallets ?? []);
      else setError((await res.json()).error ?? "Ошибка сохранения");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(id: string, enabled: boolean) {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/donate/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) setWallets((await res.json()).wallets ?? []);
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить кошелёк? Действие необратимо.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/donate/${id}`, { method: "DELETE" });
      if (res.ok) setWallets((await res.json()).wallets ?? []);
    } finally {
      setBusy(null);
    }
  }

  async function addWallet() {
    if (!newWallet.network.trim() || !newWallet.address.trim() || !newWallet.coin.trim()) return;
    setBusy("new");
    setError(null);
    try {
      const res = await fetch("/api/admin/donate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newWallet),
      });
      if (res.ok) {
        const ws: Wallet[] = (await res.json()).wallets ?? [];
        setWallets(ws);
        setDrafts(Object.fromEntries(ws.map((w) => [w.id, { network: w.network, coin: w.coin, address: w.address }])));
        setNewWallet({ network: "", coin: "USDT", address: "" });
      } else {
        setError((await res.json()).error ?? "Ошибка добавления");
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="mt-6 text-sm text-faint">Загрузка…</div>;

  return (
    <div className="mt-6 space-y-3">
      {error && <div className="text-sm text-loss">{error}</div>}

      {wallets.map((w) => {
        const d = drafts[w.id] ?? { network: w.network, coin: w.coin, address: w.address };
        const dirty = d.network !== w.network || d.coin !== w.coin || d.address !== w.address;
        return (
          <div key={w.id} className={`card p-4 ${!w.enabled ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-[1fr_100px] gap-2 mb-2">
              <input
                className="input-base text-sm py-1.5"
                value={d.network}
                onChange={(e) => updateDraft(w.id, { network: e.target.value })}
                placeholder="Сеть, напр. TRC20 (Tron)"
              />
              <input
                className="input-base text-sm py-1.5"
                value={d.coin}
                onChange={(e) => updateDraft(w.id, { coin: e.target.value })}
                placeholder="Монета"
              />
            </div>
            <input
              className="input-base text-sm py-1.5 w-full font-mono"
              value={d.address}
              onChange={(e) => updateDraft(w.id, { address: e.target.value })}
              placeholder="Адрес кошелька"
            />
            <div className="flex items-center justify-between mt-3">
              <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
                <button
                  role="switch"
                  aria-checked={w.enabled}
                  disabled={busy === w.id}
                  onClick={() => toggle(w.id, !w.enabled)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition disabled:opacity-50 ${
                    w.enabled ? "bg-accent" : "bg-surface-2 border border-border"
                  }`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition ${
                      w.enabled ? "translate-x-4" : "translate-x-1"
                    }`}
                  />
                </button>
                {w.enabled ? "Показывается" : "Скрыт"}
              </label>
              <div className="flex items-center gap-2">
                {dirty && (
                  <button
                    onClick={() => saveEdits(w.id)}
                    disabled={busy === w.id}
                    className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 text-accent border-accent/40 hover:border-accent disabled:opacity-40"
                  >
                    <Save size={14} /> Сохранить
                  </button>
                )}
                <button
                  onClick={() => remove(w.id)}
                  disabled={busy === w.id}
                  className="input-base p-1.5 text-muted hover:text-loss disabled:opacity-40"
                  title="Удалить"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <div className="card p-4 border-dashed">
        <div className="text-sm font-medium mb-2">Добавить кошелёк</div>
        <div className="grid grid-cols-[1fr_100px] gap-2 mb-2">
          <input
            className="input-base text-sm py-1.5"
            value={newWallet.network}
            onChange={(e) => setNewWallet((s) => ({ ...s, network: e.target.value }))}
            placeholder="Сеть, напр. ERC20 (Ethereum)"
          />
          <input
            className="input-base text-sm py-1.5"
            value={newWallet.coin}
            onChange={(e) => setNewWallet((s) => ({ ...s, coin: e.target.value }))}
            placeholder="Монета"
          />
        </div>
        <input
          className="input-base text-sm py-1.5 w-full font-mono mb-2"
          value={newWallet.address}
          onChange={(e) => setNewWallet((s) => ({ ...s, address: e.target.value }))}
          placeholder="Адрес кошелька"
        />
        <button
          onClick={addWallet}
          disabled={busy === "new"}
          className="input-base text-sm py-1.5 px-3 inline-flex items-center gap-1.5 hover:border-border-strong disabled:opacity-40"
        >
          <Plus size={14} /> Добавить
        </button>
      </div>
    </div>
  );
}
