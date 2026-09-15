import type { MajorCoin } from "@/lib/landingMajors";

/**
 * «Старшие монеты» — первое, что видит гость: живая цена и суточный график
 * шести крупных монет, а для BTC/ETH (единственных, по которым коллектор
 * пишет стакан — см. landingMajors.ts) ещё и ближайшая крупная заявка.
 *
 * Стену рисуем засветкой ПРЯМО на графике, а не отдельной линией-уровнем —
 * тот же приём, что у карты ордеров (см. buildOffscreen в
 * dashboard/orderflow/page.tsx: чем крупнее объём, тем ярче/шире пятно), а не
 * самостоятельный технический индикатор, который легко принять за что-то
 * другое.
 */
export default function LandingMajors({
  coins,
  t,
}: {
  coins: MajorCoin[];
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  if (coins.length === 0) return null;

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6">
      <div className="mb-1.5 text-right text-[11px] text-faint">{t("landing.majors.timeframe")}</div>
      {/* Один ряд, а не адаптивная сетка с переносом: на узких экранах лента
          едет вбок (как тикер ForexFactory на телефоне) вместо того, чтобы
          сжимать колонки до нечитаемого текста. */}
      <div className="card grid grid-flow-col auto-cols-[minmax(150px,1fr)] overflow-x-auto">
        {coins.map((coin) => (
          <MajorColumn key={coin.symbol} coin={coin} t={t} />
        ))}
      </div>
    </div>
  );
}

function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString("ru-RU", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(3);
}

function fmtUsdShort(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}М`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}К`;
  return String(Math.round(v));
}

/** Символ без хвоста USDT — BTC/USDT читается быстрее, чем BTCUSDT. */
function pairLabel(symbol: string): string {
  const base = symbol.replace(/USDT$/, "");
  return `${base}/USDT`;
}

function MajorColumn({
  coin,
  t,
}: {
  coin: MajorCoin;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const up = coin.changePct >= 0;
  return (
    <div className="flex flex-col gap-2 border-l border-border p-3 first:border-l-0">
      <span className="text-[13px] font-semibold">{pairLabel(coin.symbol)}</span>
      <span className="text-[15px] font-bold tabular-nums tracking-tight">${fmtPrice(coin.price)}</span>
      <Sparkline candles={coin.candles} wall={coin.wall} />
      <span className={`text-[11.5px] font-semibold tabular-nums ${up ? "text-profit" : "text-loss"}`}>
        {up ? "+" : ""}
        {coin.changePct.toFixed(1)}%
      </span>
      {coin.wall && (
        <span
          className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold tabular-nums ${
            coin.wall.side === "sell" ? "bg-loss/15 text-loss" : "bg-profit/15 text-profit"
          }`}
        >
          <span className="text-xs leading-none" aria-hidden>
            {coin.wall.side === "sell" ? "▲" : "▼"}
          </span>
          <span>
            {t(coin.wall.side === "sell" ? "landing.majors.sell" : "landing.majors.buy")} ${fmtUsdShort(coin.wall.volUsd)}
          </span>
          <span className="ml-auto pl-1.5 text-faint">{coin.wall.distPct.toFixed(1)}%</span>
        </span>
      )}
    </div>
  );
}

/**
 * Суточные свечи + (если есть) засветка стены — тот же серверный SVG без
 * единого килобайта JS, что и у SignalSparkline (карточка сигнала дня).
 */
function Sparkline({
  candles,
  wall,
}: {
  candles: MajorCoin["candles"];
  wall: MajorCoin["wall"];
}) {
  if (candles.length < 2) {
    return <div className="h-9 w-full" aria-hidden />;
  }

  const W = 120;
  const H = 36;
  const lastClose = candles[candles.length - 1].c;
  // Уровень стены переводим в те же единицы, что и цена свечей: dist% и
  // сторона уже посчитаны в landingMajors.ts из реального стакана.
  const wallPrice = wall ? lastClose * (1 + (wall.side === "sell" ? 1 : -1) * (wall.distPct / 100)) : null;

  const lo = Math.min(...candles.map((c) => c.l), ...(wallPrice != null ? [wallPrice] : []));
  const hi = Math.max(...candles.map((c) => c.h), ...(wallPrice != null ? [wallPrice] : []));
  const span = Math.max(1e-9, hi - lo);
  const pad = span * 0.1;
  const y = (v: number) => H - ((v - (lo - pad)) / (span + pad * 2)) * H;

  const step = W / candles.length;
  const bodyW = Math.max(1.2, step * 0.6);
  const gid = `wall-${wall ? wall.side : "none"}-${Math.round(lastClose * 100)}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-9 w-full" aria-hidden="true">
      {wall && wallPrice != null && (
        <>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={`var(--color-${wall.side === "sell" ? "loss" : "profit"})`} stopOpacity="0" />
              <stop offset="50%" stopColor={`var(--color-${wall.side === "sell" ? "loss" : "profit"})`} stopOpacity="0.5" />
              <stop offset="100%" stopColor={`var(--color-${wall.side === "sell" ? "loss" : "profit"})`} stopOpacity="0" />
            </linearGradient>
          </defs>
          <rect
            x={0}
            y={y(wallPrice) - Math.max(4, Math.min(9, (wall.volUsd / 1_000_000) * 2 + 3)) / 2}
            width={W}
            height={Math.max(4, Math.min(9, (wall.volUsd / 1_000_000) * 2 + 3))}
            fill={`url(#${gid})`}
          />
          <line
            x1={0}
            y1={y(wallPrice)}
            x2={W}
            y2={y(wallPrice)}
            stroke={`var(--color-${wall.side === "sell" ? "loss" : "profit"})`}
            strokeWidth={1}
            strokeOpacity={0.9}
          />
        </>
      )}
      {candles.map((c, i) => {
        const x = step * i + step * 0.2;
        const up = c.c >= c.o;
        const color = `var(--color-${up ? "profit" : "loss"})`;
        const top = y(Math.max(c.o, c.c));
        const height = Math.max(1.2, Math.abs(y(c.o) - y(c.c)));
        return (
          <g key={i} fill={color} stroke={color}>
            <line x1={x + bodyW / 2} y1={y(c.h)} x2={x + bodyW / 2} y2={y(c.l)} strokeWidth={1} />
            <rect x={x} y={top} width={bodyW} height={height} stroke="none" />
          </g>
        );
      })}
    </svg>
  );
}
