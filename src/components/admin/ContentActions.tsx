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
        const added = (json.results ?? []).reduce(
          (s: number, r: { added?: number; upserted?: number }) => s + (r.added ?? r.upserted ?? 0),
          0,
        );
        setMsg(`+${added}`);
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
      {msg && <span className="text-xs text-faint">{msg}</span>}
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
