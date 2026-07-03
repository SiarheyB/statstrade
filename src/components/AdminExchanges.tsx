"use client";

import { useEffect, useState } from "react";

// Тумблеры вкл/выкл бирж для синхронизации аккаунтов. Выключенная биржа
// пропадает из формы добавления аккаунта; уже подключённые аккаунты и карты
// ордеров/ликвидаций не затрагиваются.

type Row = {
  id: string;
  name: string;
  needsPassphrase: boolean;
  supportsDemo: boolean;
  enabled: boolean;
  demoEnabled: boolean;
};

export default function AdminExchanges() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/exchanges");
      if (res.ok && alive) setRows((await res.json()).exchanges ?? []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(id: string, patch: { enabled?: boolean; demoEnabled?: boolean }) {
    setBusy(id);
    try {
      const res = await fetch("/api/admin/exchanges", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exchange: id, ...patch }),
      });
      if (res.ok) setRows((await res.json()).exchanges ?? []);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 max-w-xl">
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 px-4 pb-1 text-xs text-faint">
        <span>Биржа</span>
        <span className="text-center w-24">Включена</span>
        <span className="text-center w-16">Демо</span>
      </div>
      <div className="card divide-y divide-border overflow-hidden">
        {rows.map((r) => (
          <div key={r.id} className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-center px-4 py-3">
            <div>
              <div className="text-sm font-medium">{r.name}</div>
              <div className="text-xs text-faint">
                {r.id}
                {r.needsPassphrase ? " · passphrase" : ""}
              </div>
            </div>
            <div className="w-24 flex justify-center">
              <Switch on={r.enabled} disabled={busy === r.id} onClick={() => toggle(r.id, { enabled: !r.enabled })} />
            </div>
            <div className="w-16 flex justify-center">
              <Switch on={r.demoEnabled} disabled={busy === r.id} onClick={() => toggle(r.id, { demoEnabled: !r.demoEnabled })} />
            </div>
          </div>
        ))}
        {rows.length === 0 && <div className="px-4 py-6 text-sm text-faint">Загрузка…</div>}
      </div>
      <p className="mt-2 text-xs text-faint">
        «Демо» — доступен ли на этой бирже тестовый/demo-счёт при добавлении аккаунта. Для бирж без
        sandbox в ccxt подключение демо может не сработать.
      </p>
    </div>
  );
}

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
        on ? "bg-accent" : "bg-surface-2 border border-border"
      }`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}
