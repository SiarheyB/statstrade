import Link from "next/link";
import Image from "next/image";
import type { LandingNewsItem } from "@/lib/landing";
import type { Locale } from "@/lib/i18n/core";
import type { TimezoneId } from "@/lib/timezone";
import { ianaFor } from "@/lib/timezone";

/**
 * Три свежие новости карточками. Заголовки ведут на первоисточник (rel=noopener
 * — внешние ссылки), кнопка «все новости» — на публичную страницу /news.
 */
export default function LandingNews({
  items,
  locale,
  timezone,
  t,
}: {
  items: LandingNewsItem[];
  locale: Locale;
  timezone: TimezoneId;
  t: (key: string) => string;
}) {
  const timeZone = ianaFor(timezone);
  const time = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });

  return (
    <section className="mt-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-sm font-medium">{t("landing.news.title")}</h2>
        <Link href="/news" className="text-xs text-accent hover:underline">
          {t("landing.news.more")} →
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="card p-5 text-sm text-muted">{t("landing.news.empty")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="card p-0 overflow-hidden transition hover:border-border-strong"
            >
              <div className="relative h-20 bg-surface-2 border-b border-border">
                {n.imageUrl && (
                  <Image
                    src={n.imageUrl}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 100vw, 33vw"
                    className="object-cover"
                    unoptimized
                  />
                )}
              </div>
              <div className="p-3">
                <p className="text-[13px] leading-snug line-clamp-3">{n.title}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-faint">
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">{n.source}</span>
                  <span className="tabular-nums">{time.format(new Date(n.publishedAt))}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
