"use client";

import { useCallback, useEffect, useState } from "react";

// Переключатель ОДНОЙ фичи из /admin/features, встроенный прямо в её
// собственную админ-страницу — тот же приём, что AccessToggles в
// AdminForexConfig.tsx (forex) и AdminGameConfig.tsx (game): хранилище общее
// (FeatureConfig), просто управлять им удобнее рядом с остальными
// настройками раздела, а не искать среди несвязанных фич в общем списке.
// Соответствующий ключ должен быть добавлен в HIDDEN_HERE в AdminFeatures.tsx,
// чтобы не дублироваться в общем списке.

type Feature = { key: string; label: string; description: string; value: { enabled: boolean } };

export default function FeatureAccessToggle({
  featureKey,
  compact = false,
}: {
  featureKey: string;
  /** Без заголовка и без обёртки card — для встраивания в уже существующую
   *  карточку раздела (например, /admin/content), а не как отдельная секция. */
  compact?: boolean;
}) {
  const [feature, setFeature] = useState<Feature | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/features");
    if (res.ok) {
      const all: Feature[] = (await res.json()).features ?? [];
      setFeature(all.find((f) => f.key === featureKey) ?? null);
    }
  }, [featureKey]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(enabled: boolean) {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: featureKey, enabled }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const body = feature ? (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={feature.value.enabled}
        disabled={busy}
        onChange={(e) => toggle(e.target.checked)}
        className="accent-accent mt-1"
      />
      <span>
        <span className="block text-sm font-medium text-fg">{feature.label}</span>
        <span className="block text-xs text-muted mt-0.5">{feature.description}</span>
      </span>
    </label>
  ) : (
    <div className="text-xs text-faint">Загрузка…</div>
  );

  if (compact) {
    return <div className="mt-3 pt-3 border-t border-border">{body}</div>;
  }

  return (
    <section>
      <h2 className="text-lg font-medium">Доступ к разделу</h2>
      <div className="mt-4 card p-4 max-w-2xl">{body}</div>
    </section>
  );
}
