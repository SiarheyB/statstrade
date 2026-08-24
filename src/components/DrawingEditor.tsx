/**
 * DrawingEditor — плавающая панель редактирования выбранного рисунка
 * (цвет, толщина, удаление). Одна на /dashboard/orderflow и /dashboard/forex.
 *
 * Раньше на обеих страницах лежали две копии одной и той же разметки — широкая
 * полоса `absolute top-0 left-0 right-0` над карточкой графика. С ней было две
 * беды:
 *  - на форексе полоса стояла СНАРУЖИ элемента, который разворачивается на
 *    весь экран, а нативный Fullscreen API рисует только его поддерево, —
 *    в полноэкранном режиме меню просто не существовало на экране;
 *  - на orderflow полоса была внутри, но во всю ширину накрывала верх графика
 *    вместе с панелью инструментов.
 *
 * Поэтому теперь это компактная «таблетка» по центру сверху (как плавающая
 * панель объекта в TradingView): не задевает панель инструментов слева и
 * кнопку фуллскрина справа, одинаково работает в обычном и полноэкранном
 * режиме, и живёт внутри разворачиваемого блока.
 */
"use client";

import { Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { DrawingRow } from "@/lib/drawings";

type Props = {
  drawing: DrawingRow;
  /** Базовый путь API рисунков страницы: /api/orderflow/drawings и т.п. */
  apiBase: string;
  /** Применить изменение к локальному списку (ответ сервера уже успешен). */
  onPatched: (id: string, patch: { color?: string; lineWidth?: number }) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function DrawingEditor({ drawing, apiBase, onPatched, onDelete, onClose }: Props) {
  const { t } = useI18n();

  const patch = async (body: { color?: string; lineWidth?: number }) => {
    try {
      const res = await fetch(`${apiBase}?id=${drawing.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) onPatched(drawing.id, body);
    } catch (err) {
      console.error("Failed to update drawing", err);
    }
  };

  return (
    <div className="absolute left-1/2 top-1 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border/40 bg-bg/90 px-2.5 py-1 text-xs shadow-lg backdrop-blur-sm">
      <label className="flex items-center gap-1.5 text-faint" title={t("of.color")}>
        {/* На узком экране подписи прячем — иначе «таблетка» упирается в панель
            инструментов слева и кнопку фуллскрина справа. */}
        <span className="hidden sm:inline">{t("of.color")}</span>
        <input
          type="color"
          value={drawing.color}
          onChange={(ev) => void patch({ color: ev.target.value })}
          className="h-5 w-5 cursor-pointer rounded border border-border/30 bg-transparent p-0"
        />
      </label>
      <label className="flex items-center gap-1.5 text-faint" title={t("of.lineWidth")}>
        <span className="hidden sm:inline">{t("of.lineWidth")}</span>
        <input
          type="range"
          min={1}
          max={5}
          value={drawing.lineWidth}
          onChange={(ev) => void patch({ lineWidth: Number(ev.target.value) })}
          className="w-12 accent-accent sm:w-16"
        />
        <span className="w-2 tabular-nums text-faint">{drawing.lineWidth}</span>
      </label>
      <span className="h-4 w-px bg-border-strong" />
      <button
        type="button"
        onClick={() => onDelete(drawing.id)}
        title={t("of.delete")}
        aria-label={t("of.delete")}
        className="rounded p-1 text-loss transition-colors hover:bg-loss/20"
      >
        <Trash2 size={13} />
      </button>
      <button
        type="button"
        onClick={onClose}
        title={t("common.close")}
        aria-label={t("common.close")}
        className="rounded p-1 text-faint transition-colors hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}
