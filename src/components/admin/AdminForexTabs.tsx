"use client";

// /admin/forex был одной длинной страницей: статус трёх источников
// (Finnhub WS, Twelve Data, Dukascopy) и настройки (доступ, список пар,
// очистка истории) шли подряд. Разделены по вкладкам, как /admin/game
// (AdminGameTabs.tsx).
import { useState } from "react";
import { Activity, SlidersHorizontal } from "lucide-react";
import AdminForex from "@/components/AdminForex";
import AdminForexConfig from "@/components/AdminForexConfig";

const TABS = [
  { id: "overview", label: "Обзор", Icon: Activity },
  { id: "settings", label: "Настройки", Icon: SlidersHorizontal },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function AdminForexTabs() {
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

      {tab === "overview" && <AdminForex />}
      {tab === "settings" && <AdminForexConfig />}
    </div>
  );
}
