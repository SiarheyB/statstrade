"use client";

// /admin/features валил в одну кучу шесть разных индикаторов/фич — разбито
// по вкладкам, тем же приёмом, что уже есть у /admin/game (AdminGameTabs.tsx)
// и /admin/collector (AdminCollectorTabs.tsx): кнопки в шапке переключают,
// что показано, а не «листай, пока не найдёшь».
//
// Каждый индикатор — своя кнопка, а не одна общая «Индикаторы» на все
// сразу: иначе внутри неё снова была бы та же куча, от которой уходили.
// Playbooks и Mentor Mode — не индикаторы, а целые разделы кабинета
// (страница «Playbooks», ссылки на статистику) — общая кнопка для них
// уместна, у обоих просто «включено/выключено» и один-два параметра.
//
// forex/game/tradeRecommendations/econcal/news/orderflow/liqmap сюда не
// попадают вовсе — у них СВОИ страницы в админке, а не вкладка здесь.
import { useState } from "react";
import { BarChart3, Waves, Gauge, LineChart, Dices, NotebookPen } from "lucide-react";
import FeatureConfigGroup from "@/components/admin/FeatureConfigGroup";

const TABS = [
  { id: "volumeProfile", label: "Volume Profile", Icon: BarChart3, keys: ["volumeProfile"] },
  { id: "divergenceScanner", label: "Divergence Scanner", Icon: Waves, keys: ["divergenceScanner"] },
  { id: "imbalanceIndicator", label: "Bid/Ask Imbalance", Icon: Gauge, keys: ["imbalanceIndicator"] },
  { id: "exitEfficiency", label: "Exit Efficiency", Icon: LineChart, keys: ["exitEfficiency"] },
  { id: "monteCarlo", label: "Monte Carlo", Icon: Dices, keys: ["monteCarlo"] },
  { id: "sections", label: "Разделы кабинета", Icon: NotebookPen, keys: ["playbooks", "mentorMode"] },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function AdminFeaturesTabs() {
  const [tab, setTab] = useState<Tab>("volumeProfile");
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-1 card p-1 w-fit">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === id ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <FeatureConfigGroup keys={[...active.keys]} />
    </div>
  );
}
