"use client";

// /admin/collector был одной длинной страницей: статус коллектора (свежесть
// фидов, скорость наполнения, live-превью стакана) и настройки (пороги
// «только крупные лимитки», ручная очистка) шли подряд — чтобы попасть в
// настройки, приходилось прокручивать статус целиком. Разделены по вкладкам,
// как /admin/game (AdminGameTabs.tsx).
import { useState } from "react";
import { Activity, SlidersHorizontal, ShieldCheck } from "lucide-react";
import AdminCollector from "@/components/AdminCollector";
import AdminCollectorConfig from "@/components/AdminCollectorConfig";
import FeatureAccessToggle from "@/components/admin/FeatureAccessToggle";

const TABS = [
  { id: "overview", label: "Обзор", Icon: Activity },
  { id: "settings", label: "Настройки", Icon: SlidersHorizontal },
  { id: "access", label: "Доступ", Icon: ShieldCheck },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function AdminCollectorTabs() {
  const [tab, setTab] = useState<Tab>("overview");

  return (
    <div className="space-y-6">
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

      {tab === "overview" && <AdminCollector />}
      {tab === "settings" && <AdminCollectorConfig />}
      {tab === "access" && <FeatureAccessToggle featureKey="orderflow" />}
    </div>
  );
}
