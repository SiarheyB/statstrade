"use client";

import { useEffect, useState } from "react";

// Переключатели доступа к разделу «Игра» — тот же паттерн, что у
// AdminForexConfig.tsx: значения живут в общей таблице FeatureConfig (та же,
// что /admin/features), здесь просто удобный дублирующий UI рядом с
// остальными настройками игры. Ключи: "game" (общий выключатель, скрыт даже
// для админа) и "gamePublicAccess" (доступ для обычных пользователей, админ
// не затронут).

type AccessFeature = { key: "game" | "gamePublicAccess"; label: string; description: string; value: { enabled: boolean } };

export default function AdminGameConfig() {
  const [features, setFeatures] = useState<AccessFeature[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/features");
      if (res.ok && alive) {
        const all = (await res.json()).features ?? [];
        setFeatures(all.filter((f: AccessFeature) => f.key === "game" || f.key === "gamePublicAccess"));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (res.ok) {
        const all = (await res.json()).features ?? [];
        setFeatures(all.filter((f: AccessFeature) => f.key === "game" || f.key === "gamePublicAccess"));
      }
    } finally {
      setBusy(null);
    }
  }

  const game = features.find((f) => f.key === "game");
  const gamePublicAccess = features.find((f) => f.key === "gamePublicAccess");

  return (
    <section>
      <h2 className="text-lg font-medium">Доступ к разделу</h2>
      <p className="mt-1 text-sm text-muted">
        Те же переключатели, что и в <a href="/admin/features" className="text-accent hover:underline">Функции</a> — просто продублированы здесь для удобства.
      </p>
      <div className="mt-4 card p-4 max-w-2xl space-y-4">
        {[game, gamePublicAccess].map((f) =>
          f ? (
            <label key={f.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={f.value.enabled}
                disabled={busy === f.key}
                onChange={(e) => toggle(f.key, e.target.checked)}
                className="accent-accent mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-fg">{f.label}</span>
                <span className="block text-xs text-muted mt-0.5">{f.description}</span>
              </span>
            </label>
          ) : null,
        )}
        {features.length === 0 && <div className="text-xs text-faint">Загрузка…</div>}
      </div>
    </section>
  );
}
