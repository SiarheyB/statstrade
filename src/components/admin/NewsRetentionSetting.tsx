"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/provider";

// Срок хранения новостей — настройка конкретного фида, поэтому живёт здесь, в
// карточке «Новости» на /admin/content, а не среди переключателей фич.
export default function NewsRetentionSetting({ value, max }: { value: number; max: number }) {
  const router = useRouter();
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const days = Number(draft);
  // Пустое поле — это НЕ ноль: иначе стёртое значение молча сохранилось бы как
  // «не удалять никогда». Ноль админ должен ввести явно.
  const valid = draft.trim() !== "" && Number.isInteger(days) && days >= 0 && days <= max;
  const dirty = draft !== String(value);

  async function save() {
    if (!valid) return;
    setBusy(true);
    setMsg(null);
    setError(false);
    try {
      const res = await fetch("/api/admin/content", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feed: "news", retentionDays: days }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(true);
        setMsg(json.error ?? t("admin.content.error"));
      } else {
        setMsg(t("admin.content.saved"));
        router.refresh();
      }
    } catch (e) {
      setError(true);
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <label htmlFor="news-retention" className="text-xs font-medium">
        {t("admin.content.retentionLabel")}
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id="news-retention"
          type="number"
          min={0}
          max={max}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-20 input-base px-2 py-1 text-sm"
        />
        <button
          onClick={save}
          disabled={busy || !valid || !dirty}
          className="input-base px-3 py-1 text-sm hover:border-border-strong disabled:opacity-50"
        >
          {t("admin.content.save")}
        </button>
        {msg && (
          <span className={error ? "text-xs text-loss" : "text-xs text-profit"}>{msg}</span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] text-faint leading-relaxed">
        {days === 0 ? t("admin.content.retentionHintOff") : t("admin.content.retentionHint")}
      </p>
    </div>
  );
}
