import type { SignalCandle } from "@/lib/landing";

/**
 * Фоновый дневной график карточки сигнала: настоящие свечи плюс пунктир
 * уровня. Рисуется как подложка (полупрозрачная, внизу карточки) — показать
 * «это живой инструмент, а не абстракция», не отвлекая от текста.
 *
 * Свечи считаем сами, а не тянем библиотеку графиков: два десятка баров в SVG
 * — это тридцать строк арифметики, серверный рендер без единого килобайта JS.
 */
export default function SignalSparkline({
  candles,
  levelPrice,
  className,
}: {
  candles: SignalCandle[];
  levelPrice: number;
  className?: string;
}) {
  if (candles.length < 2) return null;

  const W = 360;
  const H = 120;
  const PAD = 6;

  const lo = Math.min(levelPrice, ...candles.map((c) => c.l)) * 0.995;
  const hi = Math.max(levelPrice, ...candles.map((c) => c.h)) * 1.005;
  const span = hi - lo || 1;

  const step = (W - 2 * PAD) / candles.length;
  const bodyW = Math.max(3, step * 0.62);
  const y = (v: number) => PAD + ((hi - v) / span) * (H - 2 * PAD);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
    >
      <line
        x1={PAD}
        y1={y(levelPrice)}
        x2={W - PAD}
        y2={y(levelPrice)}
        stroke="var(--color-accent)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {candles.map((c, i) => {
        const x = PAD + step * i + step / 2;
        const up = c.c >= c.o;
        const color = up ? "var(--color-profit)" : "var(--color-loss)";
        const top = y(Math.max(c.o, c.c));
        const height = Math.max(1.2, y(Math.min(c.o, c.c)) - top);
        return (
          <g key={i} fill={color} stroke={color}>
            <line x1={x} y1={y(c.h)} x2={x} y2={y(c.l)} strokeWidth={1} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={height} rx={0.6} stroke="none" />
          </g>
        );
      })}
    </svg>
  );
}
