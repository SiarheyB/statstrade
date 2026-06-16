"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Newspaper, RefreshCw, ExternalLink } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

type Item = {
  id: string;
  source: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string;
};

const SOURCE_NAME: Record<string, string> = {
  coindesk: "CoinDesk",
  cointelegraph: "Cointelegraph",
  decrypt: "Decrypt",
};
const SOURCE_STYLE: Record<string, string> = {
  coindesk: "bg-warn/15 text-warn",
  cointelegraph: "bg-accent/15 text-accent",
  decrypt: "bg-profit/15 text-profit",
};

export default function NewsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState("all");

  const load = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetch(`/api/news${force ? "?refresh=1" : ""}`);
      if (res.ok) {
        const data = await res.json();
        setItems(data.items ?? []);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const tabs = ["all", "coindesk", "cointelegraph", "decrypt"];
  const shown = active === "all" ? items : items.filter((i) => i.source === active);

  return (
    <div className="px-6 py-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Newspaper size={20} className="text-accent" />
          {t("news.title")}
        </h1>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {t("news.refresh")}
        </button>
      </div>
      <p className="text-sm text-muted mt-1 mb-4">{t("news.subtitle")}</p>

      <div className="flex flex-wrap gap-2 mb-5">
        {tabs.map((s) => (
          <button
            key={s}
            onClick={() => setActive(s)}
            className={clsx(
              "px-3 py-1.5 rounded-full text-sm transition border",
              active === s
                ? "bg-accent/15 text-accent border-accent/30"
                : "text-muted border-border hover:text-fg hover:border-border-strong",
            )}
          >
            {s === "all" ? t("news.all") : SOURCE_NAME[s]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("news.empty")}</div>
      ) : (
        <div className="space-y-3">
          {shown.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card p-4 flex gap-4 hover:border-border-strong transition group"
            >
              {n.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={n.imageUrl}
                  alt=""
                  loading="lazy"
                  className="hidden sm:block w-28 h-20 rounded-lg object-cover shrink-0 bg-surface-2"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1.5 text-xs">
                  <span
                    className={clsx(
                      "px-2 py-0.5 rounded-full font-medium",
                      SOURCE_STYLE[n.source] ?? "bg-surface-2 text-muted",
                    )}
                  >
                    {SOURCE_NAME[n.source] ?? n.source}
                  </span>
                  <span className="text-faint">{fmtDate(n.publishedAt)}</span>
                </div>
                <h3 className="font-medium leading-snug flex items-start gap-1 group-hover:text-accent transition">
                  <span className="line-clamp-2">{n.title}</span>
                  <ExternalLink
                    size={13}
                    className="mt-1 shrink-0 text-faint opacity-0 group-hover:opacity-100 transition"
                  />
                </h3>
                {n.summary && (
                  <p className="mt-1 text-sm text-muted line-clamp-2">{n.summary}</p>
                )}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
