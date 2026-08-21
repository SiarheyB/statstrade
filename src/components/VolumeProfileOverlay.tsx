/**
 * VolumeProfileOverlay — отрисовка профиля объёма ПОВЕРХ ценового графика
 * (стиль VPVR: горизонтальные столбики у правого края).
 *
 * Не React-компонент, а чистая функция для draw() на canvas — как
 * DivergenceOverlay. Один код на /dashboard/orderflow и /dashboard/forex.
 *
 * Отдельная панель профиля (components/VolumeProfile.tsx) никуда не девается:
 * там точные числа и подписи уровней. Наложение отвечает на другой вопрос —
 * где проходят объёмные уровни ОТНОСИТЕЛЬНО текущей цены и свечей, без
 * перевода взгляда на соседний график с собственной шкалой.
 */
import type { VolumeProfile } from "@/components/VolumeProfile";

// Полупрозрачные: профиль — фон для свечей, а не самостоятельная картинка.
const VA_FILL = "rgba(22,199,132,0.22)"; // внутри Value Area
const OUT_FILL = "rgba(120,132,156,0.16)"; // за пределами Value Area
const POC_FILL = "rgba(230,184,0,0.45)";
const POC_LINE = "rgba(230,184,0,0.75)";
const VA_LINE = "rgba(22,199,132,0.35)";
const LABEL = "rgba(230,234,242,0.75)";

/** Доля ширины графика под самый длинный столбик профиля. */
const DEFAULT_WIDTH_RATIO = 0.2;

export function drawVolumeProfileOverlay(
  ctx: CanvasRenderingContext2D,
  sy: (price: number) => number,
  plotX: number,
  plotW: number,
  plotH: number,
  vp: VolumeProfile | null,
  opts: { widthRatio?: number } = {},
): void {
  if (!vp || !vp.levels?.length) return;

  const maxBarW = plotW * (opts.widthRatio ?? DEFAULT_WIDTH_RATIO);
  const right = plotX + plotW;

  ctx.save();
  ctx.beginPath();
  ctx.rect(plotX, 0, plotW, plotH);
  ctx.clip();

  // Высота столбика = высота ценового бина на текущем масштабе. При сильном
  // отдалении бины схлопываются в суб-пиксель — тогда рисуем 1px, иначе
  // профиль исчезает вместо того, чтобы стать плотной полосой.
  const half = vp.binSize / 2;
  for (const lvl of vp.levels) {
    const yTop = sy(lvl.price + half);
    const yBot = sy(lvl.price - half);
    const h = Math.max(1, yBot - yTop);
    if (yBot < 0 || yTop > plotH) continue;
    const w = Math.max(1, (lvl.pct / 100) * maxBarW);
    ctx.fillStyle = lvl.isPoc ? POC_FILL : lvl.isVa ? VA_FILL : OUT_FILL;
    ctx.fillRect(right - w, yTop, w, h);
  }

  // Уровни POC/VAH/VAL тянем через весь график: их смысл в том, как к ним
  // подходит цена, а не в высоте столбика.
  const line = (price: number, color: string, dash: number[]) => {
    const y = sy(price);
    if (y < 0 || y > plotH) return;
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(plotX, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  line(vp.vah, VA_LINE, [2, 4]);
  line(vp.val, VA_LINE, [2, 4]);
  line(vp.poc, POC_LINE, [5, 4]);

  const pocY = sy(vp.poc);
  if (pocY >= 8 && pocY <= plotH) {
    ctx.fillStyle = LABEL;
    ctx.font = "10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.fillText("POC", plotX + 4, pocY - 3);
  }

  ctx.restore();
}
