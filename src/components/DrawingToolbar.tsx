/**
 * DrawingToolbar — панель инструментов рисования (слева от графика, как в TradingView).
 *
 * Позволяет выбрать инструмент: трендовая, горизонтальная линия, луч, прямоугольник.
 * Активный инструмент подсвечивается, повторный клик отключает.
 */
"use client";

import { Minus, ArrowRight, TrendingUp, Square, Magnet } from "lucide-react";
import type { DrawingToolType } from "@/lib/drawings";

export type { DrawingToolType };

type Props = {
  activeTool: DrawingToolType | null;
  onSelectTool: (tool: DrawingToolType | null) => void;
  magnet: boolean;
  onToggleMagnet: () => void;
};

const TOOLS: { type: DrawingToolType; label: string; icon: React.ReactNode }[] = [
  { type: "trend_line", label: "Трендовая", icon: <TrendingUp size={16} /> },
  { type: "horizontal_line", label: "Горизонт. линия", icon: <Minus size={16} /> },
  { type: "horizontal_ray", label: "Горизонт. луч", icon: <ArrowRight size={16} /> },
  { type: "rectangle", label: "Прямоугольник", icon: <Square size={16} /> },
];

export default function DrawingToolbar({ activeTool, onSelectTool, magnet, onToggleMagnet }: Props) {
  return (
    <div className="flex flex-col gap-1 py-2 px-1">
      {TOOLS.map((tool) => (
        <button
          key={tool.type}
          onClick={() => onSelectTool(activeTool === tool.type ? null : tool.type)}
          className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
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
      <div className="w-6 h-px bg-border-strong my-1 mx-auto" />
      {/* Кнопка магнита */}
      <button
        onClick={onToggleMagnet}
        className={`flex items-center justify-center w-8 h-8 rounded transition-colors ${
          magnet
            ? "bg-accent/20 text-accent border border-accent/40"
            : "text-muted hover:text-fg hover:bg-bg-muted border border-transparent"
        }`}
        title={magnet ? "Привязка к свечам (вкл)" : "Привязка к свечам (выкл)"}
      >
        <Magnet size={16} />
      </button>
    </div>
  );
}