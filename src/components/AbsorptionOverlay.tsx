/**
 * AbsorptionOverlay — pure function для отрисовки маркеров absorption на canvas.
 * Не React-компонент, а функция, вызываемая внутри draw() в orderflow/page.tsx.
 *
 * Absorption: узкий диапазон + аномальный объём + дельта ~0.
 * Рисует горизонтальную скобку "[" под графиком над паттерном.
 */
import type { AbsorptionSignal } from "@/lib/orderflow";

// Цвет: фиолетовый/сиреневый — аккумуляция (не бычий/медвежий, а нейтральный).
const COLOR = "rgba(147, 112, 219, 0.7)"; // medium purple
const STRONG_COLOR = "rgba(180, 140, 255, 0.85)"; // яркий для strong

/**
 * Рисует маркеры absorption на canvas графика.
 * Вызывается поверх свечей, перед маркерами дивергенции.
 */
export function drawAbsorptionMarkers(
  ctx: CanvasRenderingContext2D,
  sx: (ms: number) => number,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  plotH: number,
  signals: AbsorptionSignal[],
  candles: { t: number }[],
): void {
  if (!signals.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, plotH);
  ctx.clip();

  for (const sig of signals) {
    // Находим первую и последнюю свечу паттерна по времени.
    const startIdx = candles.findIndex((c) => c.t === sig.t);
    if (startIdx < 0) continue;

    // Ищем конец паттерна: столько же свечей, сколько duration.
    const endIdx = Math.min(startIdx + sig.duration - 1, candles.length - 1);
    const endT = candles[endIdx].t;
    const startT = candles[startIdx].t;

    const x0 = sx(startT);
    const x1 = sx(endT);
    // Пропускаем, если весь паттерн за пределами экрана.
    if (x1 < plotX || x0 > plotX + plotW) continue;

    const isStrong = sig.strength >= 4;
    const color = isStrong ? STRONG_COLOR : COLOR;

    // Рисуем скобку "[" под графиком: вертикальная + горизонтальная линии.
    const bracketY = plotH - 2;
    const bracketH = 8;
    ctx.strokeStyle = color;
    ctx.lineWidth = isStrong ? 2 : 1.5;

    // Левая скобка: вертикальная + нижняя горизонтальная.
    ctx.beginPath();
    ctx.moveTo(x0, bracketY);
    ctx.lineTo(x0, bracketY + bracketH);
    ctx.lineTo(Math.min(x1, plotX + plotW), bracketY + bracketH);
    ctx.stroke();

    // Если помещается — подпись "Abs" или "S-Abs".
    const label = isStrong ? "S-Abs" : "Abs";
    ctx.font = "bold 8px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    const labelW = ctx.measureText(label).width;
    if (x1 - x0 >= labelW + 6) {
      ctx.fillText(label, x0 + 2, bracketY + bracketH + 2);
    }

    // Вертикальный пунктир на всю высоту, если паттерн не слишком широкий.
    if (x1 - x0 < plotW * 0.5) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.15;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo((x0 + x1) / 2, 0);
      ctx.lineTo((x0 + x1) / 2, bracketY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}