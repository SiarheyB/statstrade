"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Newspaper, RefreshCw, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { Pagination } from "@/components/Pagination";
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
type Source = { id: string; name: string };

const PAGE_SIZE = 12;
const PILL_STYLES = ["bg-warn/15 text-warn", "bg-accent/15 text-accent", "bg-profit/15 text-profit"];

export default function NewsPage() {
  const { t, locale } = useI18n();
  const [items, setItems] = useState<Item[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const res = await fetch(`/api/news?lang=${locale}${force ? "&refresh=1" : ""}`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.items ?? []);
          setSources(data.sources ?? []);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [locale],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reset filter + page when the language changes; reset page when filtering.
  useEffect(() => {
    setActive("all");
  }, [locale]);
  useEffect(() => {
    setPage(1);
  }, [active, locale]);

  const nameFor = (id: string) => sources.find((s) => s.id === id)?.name ?? id;
  const styleFor = (id: string) => {
    const idx = sources.findIndex((s) => s.id === id);
    return idx >= 0 ? PILL_STYLES[idx % PILL_STYLES.length] : "bg-surface-2 text-muted";
  };

  const filtered = active === "all" ? items : items.filter((i) => i.source === active);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const tabs = ["all", ...sources.map((s) => s.id)];

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
            {s === "all" ? t("news.all") : nameFor(s)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : shown.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("news.empty")}</div>
      ) : (
        <>
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
                      className={clsx("px-2 py-0.5 rounded-full font-medium", styleFor(n.source))}
                    >
                      {nameFor(n.source)}
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
                  {n.summary && <p className="mt-1 text-sm text-muted line-clamp-2">{n.summary}</p>}
                </div>
              </a>
            ))}
          </div>

          <div className="flex items-center justify-center mt-6 text-sm">
            <Pagination
              page={safePage}
              totalPages={pageCount}
              onChange={setPage}
              prevLabel={<><ChevronLeft size={15} />{t("news.prev")}</>}
              nextLabel={<>{t("news.next")}<ChevronRight size={15} /></>}
              pageAriaLabel={t("news.page", { p: safePage, total: pageCount })}
            />
          </div>
        </>
      )}
    </div>
  );
}
