/**
 * DrawingToolbar — панель инструментов рисования (слева от графика, как в TradingView).
 *
 * Позволяет выбрать инструмент: трендовая, горизонтальная линия, луч, прямоугольник.
 * Активный инструмент подсвечивается, повторный клик отключает.
 */
"use client";

import { Minus, ArrowRight, TrendingUp, Square, Magnet, Eye, EyeOff } from "lucide-react";
import type { DrawingToolType } from "@/lib/drawings";

export type { DrawingToolType };

type Props = {
  activeTool: DrawingToolType | null;
  onSelectTool: (tool: DrawingToolType | null) => void;
  magnet: boolean;
  onToggleMagnet: () => void;
  showDrawings: boolean;
  onToggleShowDrawings: () => void;
};

const TOOLS: { type: DrawingToolType; label: string; icon: React.ReactNode }[] = [
  { type: "trend_line", label: "Трендовая", icon: <TrendingUp size={14} /> },
  { type: "horizontal_line", label: "Горизонт. линия", icon: <Minus size={14} /> },
  { type: "horizontal_ray", label: "Горизонт. луч", icon: <ArrowRight size={14} /> },
  { type: "rectangle", label: "Прямоугольник", icon: <Square size={14} /> },
];

export default function DrawingToolbar({ activeTool, onSelectTool, magnet, onToggleMagnet, showDrawings, onToggleShowDrawings }: Props) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 px-0.5">
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
    </div>
  );
}