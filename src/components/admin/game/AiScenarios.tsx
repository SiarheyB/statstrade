"use client";

// Сценарии ИИ — текст, который каждая роль бота получает ПЕРЕД просьбой
// принять решение (см. lib/game/bots.ts, botMandate).
//
// До этого блока эти тексты были зашиты в код: чтобы понять, КАК бот вообще
// разговаривает с моделью, приходилось читать исходники. Здесь — то же
// самое текстом, с возможностью править прямо из админки, без передеплоя.
//
// Формат ответа (JSON, разбор parseDecision) сюда НЕ входит и не
// редактируется: это НЕ то же самое, что «промпт целиком» — сломанный
// формат означает, что бот перестанет понимать, что ответила модель, ни у
// одной роли сразу. Здесь редактируется только характер и мандат.
import { useEffect, useState } from "react";

const ROLES = [
  { id: "regular", label: "Обычные боты", vars: "{{nickname}}, {{style}}" },
  { id: "central_bank", label: "Центробанк", vars: "{{context}}" },
  { id: "hedge_fund", label: "Хедж-фонд", vars: "{{nickname}}, {{context}}" },
  { id: "market_maker", label: "Маркетмейкер", vars: "{{nickname}}, {{context}}" },
] as const;

type Scenarios = Record<string, string>;

export default function AiScenarios() {
  const [scenarios, setScenarios] = useState<Scenarios | null>(null);
  const [draft, setDraft] = useState<Scenarios>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Остальные (числовые) поля конфига "game" — PATCH заменяет config
  // целиком, поэтому при сохранении сценариев нужно вернуть их как есть,
  // а не только новый aiScenarios.
  const [restConfig, setRestConfig] = useState<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/features");
      if (!res.ok || !alive) return;
      const data = (await res.json()) as { features: { key: string; value: Record<string, unknown> }[] };
      const game = data.features.find((f) => f.key === "game");
      if (!game) return;
      const numbers: Record<string, number> = {};
      for (const [k, v] of Object.entries(game.value)) if (typeof v === "number") numbers[k] = v;
      const raw = (game.value.aiScenarios as Scenarios | undefined) ?? {};
      setRestConfig(numbers);
      setScenarios(raw);
      setDraft(raw);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "game", config: { ...restConfig, aiScenarios: draft } }),
      });
      if (res.ok) {
        setScenarios(draft);
        setSaved(true);
      } else {
        setError("Не удалось сохранить");
      }
    } finally {
      setBusy(false);
    }
  }

  const dirty = scenarios != null && ROLES.some((r) => draft[r.id] !== scenarios[r.id]);

  if (!scenarios) return <div className="card p-4 text-xs text-faint">Загрузка…</div>;

  return (
    <div className="card p-4 space-y-4">
      <div>
        <div className="text-sm font-medium">Сценарии ИИ</div>
        <p className="mt-1 text-xs text-faint max-w-prose">
          Текст перед просьбой принять решение — своя реплика на каждую роль. Подставляются переменные вида
          {" {{nickname}}"} — они заполняются автоматически, редактировать можно только текст вокруг них. Формат
          ответа (JSON) не отсюда и не меняется — иначе боты перестанут понимать ответ модели.
        </p>
      </div>

      {ROLES.map((role) => (
        <div key={role.id} className="space-y-1">
          <div className="flex items-baseline justify-between">
            <label className="text-xs font-medium text-muted">{role.label}</label>
            <span className="text-[11px] text-faint">доступно: {role.vars}</span>
          </div>
          <textarea
            value={draft[role.id] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [role.id]: e.target.value }))}
            rows={3}
            className="input-base w-full px-3 py-2 text-sm leading-relaxed"
          />
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
        >
          Сохранить
        </button>
        {saved && !dirty && <span className="text-xs text-profit">Сохранено</span>}
        {error && <span className="text-xs text-loss">{error}</span>}
      </div>
    </div>
  );
}
