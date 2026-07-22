/**
 * DivergenceOverlay — pure function для отрисовки маркеров дивергенции на canvas.
 * Не React-компонент, а функция, вызываемая внутри draw() в orderflow/page.tsx.
 */
import type { DivergenceSignal } from "@/lib/orderflow";

// Цвета для каждого типа дивергенции.
const COLORS: Record<string, string> = {
  regular_bearish: "#ce323b", // красный
  regular_bullish: "#13af74", // зелёный
  hidden_bearish: "#8a5f1a", // тёмно-жёлтый/коричневый
  hidden_bullish: "#2a7a5a", // тёмно-зелёный
};

// Короткие подписи для каждого типа.
const SHORT_LABELS: Record<string, string> = {
  regular_bearish: "R-Bear",
  regular_bullish: "R-Bull",
  hidden_bearish: "H-Bear",
  hidden_bullish: "H-Bull",
};

/**
 * Рисует стрелки/маркеры дивергенции на canvas графика.
 * Вызывается между отрисовкой свечей и линией текущей цены.
 */
export function drawDivergenceMarkers(
  ctx: CanvasRenderingContext2D,
  sx: (ms: number) => number,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  plotH: number,
  signals: DivergenceSignal[],
): void {
  if (!signals.length) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, plotH);
  ctx.clip();

  for (const sig of signals) {
    const x = sx(sig.t);
    // Пропускаем сигналы за пределами видимой области.
    if (x < plotX || x > plotX + plotW) continue;

    const isBearish = sig.type === "regular_bearish" || sig.type === "hidden_bearish";
    const isHidden = sig.type === "hidden_bearish" || sig.type === "hidden_bullish";
    const isRegular = !isHidden;

    // Цена второго экстремума = для bearish это pricePeak, для bullish priceTrough.
    const price = isBearish ? sig.pricePeak : sig.priceTrough;
    const y = sy(price);
    if (y < 0 || y > plotH) continue;

    const color = COLORS[sig.type] ?? "#888";
    const size = isRegular ? 8 : 5; // hidden-сигналы мельче
    const alpha = isRegular ? 1 : 0.55;

    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;

    // Рисуем стрелку: вверх для bullish, вниз для bearish.
    const arrowY = isBearish ? y + 2 : y - 2;
    ctx.beginPath();
    if (isBearish) {
      // Стрелка вниз.
      ctx.moveTo(x, arrowY + size);
      ctx.lineTo(x - size * 0.6, arrowY);
      ctx.lineTo(x + size * 0.6, arrowY);
    } else {
      // Стрелка вверх.
      ctx.moveTo(x, arrowY - size);
      ctx.lineTo(x - size * 0.6, arrowY);
      ctx.lineTo(x + size * 0.6, arrowY);
    }
    ctx.closePath();
    ctx.fill();

    // Подпись рядом со стрелкой.
    const label = SHORT_LABELS[sig.type] ?? sig.type;
    ctx.font = isRegular ? "bold 9px ui-sans-serif, system-ui" : "8px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + size + 3, arrowY);

    // Если confirmed — рисуем обводку вокруг стрелки для большей заметности.
    if (sig.confirmed) {
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (isBearish) {
        ctx.moveTo(x, arrowY + size);
        ctx.lineTo(x - size * 0.6, arrowY);
        ctx.lineTo(x + size * 0.6, arrowY);
      } else {
        ctx.moveTo(x, arrowY - size);
        ctx.lineTo(x - size * 0.6, arrowY);
        ctx.lineTo(x + size * 0.6, arrowY);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  ctx.restore();
}