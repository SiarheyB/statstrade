"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";

export default function ContentActions({ feed }: { feed: "news" | "econcal" }) {
  const router = useRouter();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ feed }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error ?? t("admin.content.error"));
      } else {
        type FeedResult = { added?: number; upserted?: number; error?: string };
        const results: FeedResult[] = json.results ?? [];
        const added = results.reduce((s, r) => s + (r.added ?? r.upserted ?? 0), 0);
        // Сам запрос успешен (200), но КАЖДЫЙ фид отвечает за себя, и его
        // ошибка лежит внутри results. Раньше она терялась: при недоступном
        // источнике кнопка показывала бодрое «+0», и почему счётчик не растёт,
        // было решительно непонятно. Теперь причина видна сразу — именно за
        // ней сюда и приходят.
        const failed = results.filter((r) => r.error);
        setMsg(
          failed.length && added === 0
            ? failed[0].error!.slice(0, 120)
            : failed.length
              ? `+${added}, ошибок: ${failed.length}`
              : `+${added}`,
        );
        router.refresh();
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      {/* Ошибку показываем тревожным цветом и не режем в одну строку: длинный
          текст причины должен читаться целиком, иначе он бесполезен. */}
      {msg && (
        <span
          className={clsx("text-xs max-w-xs text-right", msg.startsWith("+") ? "text-faint" : "text-loss")}
          title={msg}
        >
          {msg}
        </span>
      )}
      <button
        onClick={refresh}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted hover:text-accent hover:bg-surface-2 transition disabled:opacity-50"
      >
        <RefreshCw size={13} className={clsx(busy && "animate-spin")} /> {t("admin.content.refresh")}
      </button>
    </span>
  );
}
