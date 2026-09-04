"use client";

// Экран «представься» — первое, что видит игрок без имени.
//
// Имя в проекте (User.name) при регистрации необязательное, а игре оно
// нужно: оно стоит в шапке терминала и в общем рейтинге, где безымянный
// игрок выглядит недоразумением. Поэтому это не подсказка, которую можно
// закрыть, а именно вход: без имени игра не открывается.
//
// Сохраняем в профиль ПРОЕКТА, а не только в игру: человек указывает своё
// имя один раз, и дальше оно живёт везде — в игре, в рейтинге, в кабинете.
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

export default function PlayerNameGate({ onSaved }: { onSaved: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setError(t("game.nameGate.tooShort"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/name", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((data as { error?: string }).error ?? t("game.nameGate.failed"));
        return;
      }
      onSaved((data as { name: string }).name);
    } catch {
      setError(t("game.nameGate.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="card p-6 w-full max-w-md space-y-4">
        <div>
          <div className="text-lg font-semibold">{t("game.nameGate.title")}</div>
          <p className="mt-1 text-sm text-muted">{t("game.nameGate.body")}</p>
        </div>

        <div>
          <input
            autoFocus
            value={name}
            maxLength={20}
            placeholder={t("game.nameGate.placeholder")}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
            }}
            className="input-base w-full px-3 py-2 text-sm"
          />
          <div className="mt-1 text-[11px] text-faint">{t("game.nameGate.rules")}</div>
          {error && <div className="mt-1 text-xs text-loss">{error}</div>}
        </div>

        <button
          type="button"
          disabled={busy || name.trim().length < 3}
          onClick={() => void save()}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
        >
          {busy ? t("common.saving") : t("game.nameGate.submit")}
        </button>
      </div>
    </div>
  );
}
