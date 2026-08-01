/**
 * AbsorptionOverlay — pure function для отрисовки маркеров absorption на canvas.
 * Не React-компонент, а функция, вызываемая внутри draw() в orderflow/page.tsx.
 *
 * Absorption: узкий диапазон + аномальный объём + дельта ~0.
 * Рисует горизонтальную зону на уровне цены паттерна (sig.price) — раньше
 * скобка рисовалась в фиксированной точке у самого низа графика вне
 * зависимости от цены, и на широком ценовом диапазоне превращалась в еле
 * заметную точку без подписи (лейбл рисовался, только если паттерн шире
 * своего текста, иначе пропускался целиком).
 */
import type { AbsorptionSignal } from "@/lib/orderflow";

// Цвет: фиолетовый/сиреневый — аккумуляция (не бычий/медвежий, а нейтральный).
const COLOR = "rgba(147, 112, 219, 0.9)"; // medium purple
const STRONG_COLOR = "rgba(196, 160, 255, 1)"; // яркий для strong
const MIN_MARKER_W = 14; // минимальная ширина зоны на экране (px) — иначе не видно совсем

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

    let x0 = sx(startT);
    let x1 = sx(endT);
    // Пропускаем, если весь паттерн за пределами экрана.
    if (x1 < plotX || x0 > plotX + plotW) continue;
    // Слишком узкий (короткий паттерн, сильный зум) — расширяем визуально,
    // иначе это одна нечитаемая точка. Реальные start/end не меняются, это
    // только отрисовка.
    if (x1 - x0 < MIN_MARKER_W) {
      const cx = (x0 + x1) / 2;
      x0 = cx - MIN_MARKER_W / 2;
      x1 = cx + MIN_MARKER_W / 2;
    }

    const isStrong = sig.strength >= 4;
    const color = isStrong ? STRONG_COLOR : COLOR;
    const y = sy(sig.price);

    // Горизонтальная зона на уровне цены паттерна — толще и ярче для strong.
    const bandH = isStrong ? 5 : 3;
    ctx.fillStyle = color;
    ctx.globalAlpha = isStrong ? 0.35 : 0.22;
    ctx.fillRect(x0, y - bandH / 2, x1 - x0, bandH);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = color;
    ctx.lineWidth = isStrong ? 2 : 1.5;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();

    // Подпись "Abs"/"S-Abs" на фоновой плашке для читаемости — всегда
    // рисуется (раньше пропускалась, если паттерн уже своего текста).
    // Якорим у правого края зоны и клэмпим, чтобы не улетала за canvas.
    const label = isStrong ? "S-Abs" : "Abs";
    ctx.font = "bold 10px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelW = ctx.measureText(label).width;
    const padX = 3;
    let labelX = x1 + 4;
    if (labelX + labelW + padX * 2 > plotX + plotW) labelX = x0 - labelW - padX * 2 - 4;
    labelX = Math.max(plotX, labelX);

    ctx.fillStyle = "rgba(10,11,16,0.85)";
    ctx.fillRect(labelX - padX, y - 8, labelW + padX * 2, 16);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(labelX - padX, y - 8, labelW + padX * 2, 16);
    ctx.fillStyle = color;
    ctx.fillText(label, labelX, y);
  }

  ctx.restore();
}
