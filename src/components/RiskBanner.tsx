"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX, X } from "lucide-react";
import { fmtUsd } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { AccountRisk, LimitStatus } from "@/lib/risk";

type RiskResp = AccountRisk & { label: string; exchange: string };

const STYLES = {
  breached: { box: "border-loss/40 bg-loss/5", text: "text-loss", Icon: ShieldX },
  warning: { box: "border-warn/40 bg-warn/5", text: "text-warn", Icon: ShieldAlert },
  ok: { box: "border-profit/40 bg-profit/5", text: "text-profit", Icon: ShieldCheck },
} as const;

const RANK = { off: 0, ok: 1, warning: 2, breached: 3 } as const;

export default function RiskBanner({ accountId }: { accountId: string }) {
  const { t } = useI18n();
  const [risks, setRisks] = useState<RiskResp[]>([]);
  // Ephemeral dismiss: closes for now, reappears on a page refresh / remount.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/risk");
      if (res.ok && alive) {
        const d = await res.json();
        setRisks(d.accounts ?? []);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (dismissed) return null;

  const relevant = (accountId === "all" ? risks : risks.filter((r) => r.accountId === accountId))
    .filter((r) => r.enabled && r.limits.length > 0);
  if (relevant.length === 0) return null;

  const overall = relevant.reduce<"off" | "ok" | "warning" | "breached">(
    (acc, r) => (RANK[r.state] > RANK[acc] ? r.state : acc),
    "ok",
  );
  if (overall === "off") return null;

  const s = STYLES[overall];
  const title =
    overall === "breached"
      ? t("risk.banner.breached")
      : overall === "warning"
        ? t("risk.banner.warning")
        : t("risk.banner.ok");

  const limitText = (l: LimitStatus) =>
    l.key === "stops"
      ? `${t("risk.stopsShort")} ${l.used}/${l.limit}`
      : `${t(`risk.period.${l.key}`)} ${fmtUsd(l.used)} / ${fmtUsd(l.limit)}`;

  const limitColor = (l: LimitStatus) =>
    l.state === "breached" ? "text-loss" : l.state === "warning" ? "text-warn" : "text-muted";

  return (
    <div className={`rounded-xl border p-3 mb-4 flex items-start gap-3 ${s.box}`}>
      <s.Icon size={20} className={`${s.text} shrink-0 mt-0.5`} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold ${s.text}`}>{title}</span>
          <button
            onClick={() => setDismissed(true)}
            className="text-faint hover:text-fg transition shrink-0"
            aria-label="close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="mt-2 space-y-1.5">
          {relevant.map((r) => (
            <div
              key={r.accountId}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
            >
              <span className="font-medium text-fg shrink-0 min-w-[7rem]">{r.label}</span>
              {r.limits.map((l, i) => (
                <span key={l.key} className={`tabular-nums ${limitColor(l)}`}>
                  {i > 0 && <span className="text-faint mr-2">·</span>}
                  {limitText(l)}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
