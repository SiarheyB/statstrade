"use client";

// /admin/features валил в одну кучу три ОРДЕРФЛОУ-индикатора и четыре
// несвязанных фичи — разбито по вкладкам, тем же приёмом, что уже есть у
// /admin/game (AdminGameTabs.tsx) и /admin/collector (AdminCollectorTabs.tsx):
// кнопки в шапке переключают, что показано, а не «листай, пока не найдёшь».
//
// forex/game/tradeRecommendations/econcal/news/orderflow/liqmap сюда не
// попадают вовсе — у них СВОИ страницы в админке (см. AdminFeatures-подобные
// компоненты там же), а не вкладка здесь.
import { useState } from "react";
import { BarChart3, LineChart, NotebookPen } from "lucide-react";
import FeatureConfigGroup from "@/components/admin/FeatureConfigGroup";

const TABS = [
  {
    id: "indicators",
    label: "Индикаторы",
    Icon: BarChart3,
    keys: ["volumeProfile", "divergenceScanner", "imbalanceIndicator"],
  },
  {
    id: "analytics",
    label: "Аналитика",
    Icon: LineChart,
    keys: ["exitEfficiency", "monteCarlo"],
  },
  {
    id: "sections",
    label: "Разделы кабинета",
    Icon: NotebookPen,
    keys: ["playbooks", "mentorMode"],
  },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function AdminFeaturesTabs() {
  const [tab, setTab] = useState<Tab>("indicators");
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
