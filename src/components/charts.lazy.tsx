"use client";

// Ленивые версии тяжёлых графиков: recharts (~сотни КБ) уходит из начального
// чанка страниц дашборда в отдельный, который грузится после первого рендера.
// Пока чанк едет — скелетон вместо пустого места. ssr: false — графики всё
// равно рисуются только на клиенте (ResponsiveContainer меряет DOM).

import dynamic from "next/dynamic";

function ChartSkeleton() {
  return (
    <div className="h-full min-h-[200px] w-full animate-pulse rounded-xl bg-surface-2/50" />
  );
}
const loading = () => <ChartSkeleton />;

export const EquityChart = dynamic(
  () => import("./charts").then((m) => m.EquityChart),
  { ssr: false, loading },
);
export const DailyPnlChart = dynamic(
  () => import("./charts").then((m) => m.DailyPnlChart),
  { ssr: false, loading },
);
export const BreakdownChart = dynamic(
  () => import("./charts").then((m) => m.BreakdownChart),
  { ssr: false, loading },
);
export const DrawdownChart = dynamic(
  () => import("./charts").then((m) => m.DrawdownChart),
  { ssr: false, loading },
);
export const Histogram = dynamic(
  () => import("./charts").then((m) => m.Histogram),
  { ssr: false, loading },
);
export const PnlHeatmap = dynamic(() => import("./PnlHeatmap"), {
  ssr: false,
  loading,
});
export const RHeatmap = dynamic(() => import("./RHeatmap"), {
  ssr: false,
  loading,
});
// График сделки (свечи) рендерится только в развёрнутой строке таблицы —
// его код подгружается по требованию.
export const TradeChart = dynamic(
  () => import("./TradeChart").then((m) => m.TradeChart),
  { ssr: false, loading },
);
