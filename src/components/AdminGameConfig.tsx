"use client";

// Админ-панель раздела «Игра»: доступ + БАЛАНС игры.
//
// Всё лежит в общей таблице FeatureConfig (та же, что /admin/features):
// ключи "game" (общий выключатель + числовые настройки баланса) и
// "gamePublicAccess" (доступ обычным пользователям). Здесь — прицельный UI
// вместо универсальной формы: у игры настроек больше, чем у остальных фич,
// и каждой нужен человеческий подпис — что произойдёт, если поставить
// больше или меньше.
//
// Числа приезжают к игроку при загрузке /dashboard/game (страница читает
// конфиг на сервере и отдаёт его движку пропсом), поэтому правка действует
// сразу после перезагрузки страницы игры — без передеплоя и без правок в
// чужих сохранениях.
import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Save } from "lucide-react";

type FeatureRow = {
  key: string;
  label: string;
  description: string;
  fieldHelp: Record<string, string>;
  value: Record<string, unknown> & { enabled: boolean };
};

// Порядок и группировка полей — как их читает человек, а не как они лежат в
// объекте: сначала «с чего начинает игрок», потом «какой у него рынок»,
// потом «как быстро он растёт».
const GROUPS: { title: string; hint: string; fields: { key: string; label: string; unit: string; step: number }[] }[] = [
  {
    title: "Старт партии",
    hint: "Влияет только на тех, кто начинает новую партию: у уже играющих баланс не трогается.",
    fields: [{ key: "startingBalance", label: "Стартовый капитал", unit: "$", step: 500 }],
  },
  {
    title: "Рынок",
    hint: "Насколько живой и опасный рынок видит игрок.",
    fields: [
      { key: "volatilityPct", label: "Волатильность", unit: "%", step: 5 },
      { key: "newsPerGameDay", label: "Новостей в игровой день", unit: "шт", step: 0.5 },
      { key: "blackSwanPerMille", label: "Чёрных лебедей", unit: "‰", step: 1 },
    ],
  },
  {
    title: "Экономика игрока",
    hint: "Доходы, расходы и скорость прогресса.",
    fields: [
      { key: "dividendPct", label: "Дивиденды", unit: "%", step: 10 },
      { key: "upkeepPct", label: "Содержание покупок", unit: "%", step: 10 },
      { key: "xpPct", label: "Скорость прокачки", unit: "%", step: 10 },
      { key: "taxRatePct", label: "Налог на прибыль", unit: "%", step: 1 },
      { key: "maxLeverageCap", label: "Потолок плеча (0 — без ограничения)", unit: "x", step: 1 },
    ],
  },
];

export default function AdminGameConfig({ section = "all" }: { section?: "all" | "access" | "balance" }) {
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const apply = useCallback((all: FeatureRow[]) => {
    const mine = all.filter((f) => f.key === "game" || f.key === "gamePublicAccess");
    setRows(mine);
    const game = mine.find((f) => f.key === "game");
    if (!game) return;
    // В value лежат и enabled (boolean), и числа баланса — в форму берём
    // только числа, остальное правится тумблерами выше.
    const numbers: Record<string, number> = {};
    for (const [k, v] of Object.entries(game.value)) if (typeof v === "number") numbers[k] = v;
    setDraft(numbers);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/features");
    if (!res.ok) return;
    apply((await res.json()).features ?? []);
  }, [apply]);

  useEffect(() => {
    // Тот же приём, что в остальных админ-панелях проекта: загрузка внутри
    // эффекта с флагом отмены, а не setState прямо в теле эффекта.
    let alive = true;
    (async () => {
      const res = await fetch("/api/admin/features");
      if (res.ok && alive) apply((await res.json()).features ?? []);
    })();
    return () => {
      alive = false;
    };
  }, [apply]);

  async function toggle(key: string, enabled: boolean) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  }

  async function saveBalance() {
    setBusy("balance");
    setSaved(false);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "game", config: draft }),
      });
      if (res.ok) {
        await load();
        setSaved(true);
      }
    } finally {
      setBusy(null);
    }
  }

  const game = rows.find((f) => f.key === "game");
  const gamePublicAccess = rows.find((f) => f.key === "gamePublicAccess");
  const fieldHelp = game?.fieldHelp ?? {};

  if (rows.length === 0) return <div className="text-xs text-faint">Загрузка…</div>;

  return (
    <div className="space-y-8">
      {section !== "balance" && (
      <section>
        <h2 className="text-lg font-medium">Доступ к разделу</h2>
        <p className="mt-1 text-sm text-muted">
          Те же переключатели, что и в{" "}
          <a href="/admin/features" className="text-accent hover:underline">
            Функции
          </a>{" "}
          — продублированы здесь для удобства.
        </p>
        <div className="mt-4 card p-4 max-w-3xl space-y-4">
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
        </div>
      </section>
      )}

      {section !== "access" && (
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Баланс игры</h2>
            <p className="mt-1 text-sm text-muted">
              Применяется у игрока при следующей загрузке страницы игры. Прогресс и сохранения не трогаются.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saved && <span className="text-xs text-profit">Сохранено</span>}
            <button
              type="button"
              onClick={saveBalance}
              disabled={busy === "balance"}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-50"
            >
              <Save size={14} />
              Сохранить
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="card p-4 max-w-3xl">
              <div className="text-sm font-medium">{group.title}</div>
              <div className="text-xs text-faint mt-0.5">{group.hint}</div>
              <div className="mt-3 space-y-4">
                {group.fields.map((field) => (
                  <div key={field.key}>
                    <label className="flex items-center justify-between gap-3">
                      <span className="text-sm text-fg">{field.label}</span>
                      <span className="flex items-center gap-2">
                        <input
                          type="number"
                          step={field.step}
                          value={draft[field.key] ?? 0}
                          onChange={(e) => {
                            setSaved(false);
                            setDraft((d) => ({ ...d, [field.key]: Number(e.target.value) }));
                          }}
                          className="input-base w-32 text-right tabular-nums"
                        />
                        <span className="text-xs text-faint w-4">{field.unit}</span>
                      </span>
                    </label>
                    {fieldHelp[field.key] && <p className="mt-1 text-xs text-muted">{fieldHelp[field.key]}</p>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => void load()}
          className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-fg"
        >
          <RotateCcw size={12} />
          Вернуть сохранённые значения
        </button>
      </section>
      )}
    </div>
  );
}
