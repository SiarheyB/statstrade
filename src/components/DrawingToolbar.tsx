/**
 * DrawingToolbar — панель инструментов рисования (слева от графика, как в TradingView).
 *
 * Позволяет выбрать инструмент: трендовая, горизонтальная линия, луч, прямоугольник.
 * Активный инструмент подсвечивается, повторный клик отключает.
 */
"use client";

import { Minus, ArrowRight, TrendingUp, Square, Magnet, Eye, EyeOff, Lock, Unlock, Undo2 } from "lucide-react";
import type { DrawingToolType } from "@/lib/drawings";

export type { DrawingToolType };

type Props = {
  activeTool: DrawingToolType | null;
  onSelectTool: (tool: DrawingToolType | null) => void;
  magnet: boolean;
  onToggleMagnet: () => void;
  showDrawings: boolean;
  onToggleShowDrawings: () => void;
  locked: boolean;
  onToggleLocked: () => void;
  canUndoMove: boolean;
  onUndoMove: () => void;
  // Раньше панель стояла отдельной колонкой рядом с графиком и постоянно
  // занимала её ширину (даже когда сама колонка растягивалась на всю высоту
  // графика по cross-axis flex и визуально выглядела как пустое место).
  // overlay=true кладёт панель поверх canvas (левый верхний угол) —
  // график получает всю ширину контейнера.
  overlay?: boolean;
};

const TOOLS: { type: DrawingToolType; label: string; icon: React.ReactNode }[] = [
  { type: "trend_line", label: "Трендовая", icon: <TrendingUp size={14} /> },
  { type: "horizontal_line", label: "Горизонт. линия", icon: <Minus size={14} /> },
  { type: "horizontal_ray", label: "Горизонт. луч", icon: <ArrowRight size={14} /> },
  { type: "rectangle", label: "Прямоугольник", icon: <Square size={14} /> },
];

export default function DrawingToolbar({ activeTool, onSelectTool, magnet, onToggleMagnet, showDrawings, onToggleShowDrawings, locked, onToggleLocked, canUndoMove, onUndoMove, overlay = false }: Props) {
  return (
    <div
      className={
        overlay
          ? "absolute top-1 left-1 z-10 flex flex-col gap-0.5 py-1.5 px-0.5 rounded bg-bg/80 backdrop-blur-sm border border-border/40"
          : "flex flex-col gap-0.5 py-1.5 px-0.5"
      }
    >
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          onClick={() => onSelectTool(activeTool === tool.type ? null : tool.type)}
          className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
            activeTool === tool.type
              ? "bg-accent/20 text-accent border border-accent/40"
              : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
          }`}
          title={tool.label}
        >
          {tool.icon}
        </button>
      ))}
      {/* Разделитель */}
      <div className="w-5 h-px bg-border-strong my-0.5 mx-auto" />
      {/* Кнопка магнита */}
      <button
        onClick={onToggleMagnet}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          magnet
            ? "bg-accent/20 text-accent border border-accent/40"
            : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
        }`}
        title={magnet ? "Привязка к свечам (вкл)" : "Привязка к свечам (выкл)"}
      >
        <Magnet size={14} />
      </button>
      {/* Кнопка видимости рисунков */}
      <button
        onClick={onToggleShowDrawings}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          !showDrawings
            ? "bg-accent/20 text-accent border border-accent/40"
            : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
        }`}
        title={showDrawings ? "Скрыть рисунки" : "Показать рисунки"}
      >
        {showDrawings ? <Eye size={14} /> : <EyeOff size={14} />}
      </button>
      {/* Кнопка блокировки рисунков (защита от случайного перетаскивания/удаления) */}
      <button
        onClick={onToggleLocked}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          locked
            ? "bg-accent/20 text-accent border border-accent/40"
            : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
        }`}
        title={locked ? "Рисунки заблокированы (нельзя перетащить/удалить)" : "Заблокировать рисунки"}
      >
        {locked ? <Lock size={14} /> : <Unlock size={14} />}
      </button>
      {/* Отменить последнее перемещение/ресайз рисунка */}
      <button
        onClick={onUndoMove}
        disabled={!canUndoMove}
        className={`flex items-center justify-center w-7 h-7 rounded transition-colors ${
          canUndoMove
            ? "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
            : "text-faint/40 border border-transparent cursor-not-allowed"
        }`}
        title="Вернуть рисунок на прежнее место"
      >
        <Undo2 size={14} />
      </button>
    </div>
  );
}