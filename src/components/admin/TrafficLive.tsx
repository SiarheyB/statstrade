"use client";

import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Live = {
  visitors: number;
  views: number;
  pages: { path: string; visitors: number }[];
  lastHitAt: string | null;
};

const POLL_MS = 20_000;

// «Сейчас на сайте» — единственный блок раздела, которому нужен клиентский JS:
// остальной отчёт статичен на момент запроса, а этот обновляется сам.
export default function TrafficLive({ initial }: { initial: Live }) {
  const { t } = useI18n();
  const [live, setLive] = useState(initial);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/admin/traffic");
        if (res.ok && alive) setLive(await res.json());
      } catch {
        // сеть моргнула — покажем прошлые цифры
      }
    };
    const iv = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  return (
    <div className="mt-6 card p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Radio size={16} className={live.visitors > 0 ? "text-profit" : "text-faint"} />
          <span className="text-xs uppercase tracking-wide text-faint">{t("admin.traffic.live.title")}</span>
        </div>
        <div className="text-2xl font-semibold tabular-nums">{live.visitors}</div>
        <div className="text-xs text-muted">{t("admin.traffic.live.views", { n: live.views })}</div>
        <div className="flex-1 min-w-0 flex flex-wrap gap-2 justify-end">
          {live.pages.slice(0, 5).map((p) => (
            <span key={p.path} className="text-xs px-2 py-1 rounded-md bg-surface-2 text-muted truncate max-w-[16rem]">
              {p.path} · {p.visitors}
            </span>
          ))}
          {live.pages.length === 0 && <span className="text-xs text-muted">{t("admin.traffic.live.nobody")}</span>}
        </div>
      </div>
    </div>
  );
}
