import { BarChart3 } from "lucide-react";
import { prisma } from "@/lib/db";
import { getFeatureConfig } from "@/lib/featureConfig";
import { computePublicSummary } from "@/lib/mentorShare";
import { EquityChart } from "@/components/charts.lazy";
import { fmtUsd, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

// PUBLIC, unauthenticated page (outside /dashboard — not covered by the auth
// middleware). "Mentor Mode": a read-only performance snapshot shared via a
// high-entropy token, so a trader can show a coach/mentor how they're doing
// without handing out a login.
export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const feature = await getFeatureConfig("mentorMode");
  if (!feature.enabled) return <Unavailable />;

  const link = await prisma.shareLink.findUnique({ where: { token } });
  if (!link || link.revokedAt) return <Unavailable />;

  prisma.shareLink.update({ where: { id: link.id }, data: { lastViewedAt: new Date() } }).catch(() => {});

  const s = await computePublicSummary(link.userId);

  return (
    <div className="min-h-screen bg-bg px-4 py-10 md:py-16">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-2 mb-1 text-muted">
          <BarChart3 size={18} className="text-accent" />
          <span className="text-sm">TradeStats</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{link.label || "Trading performance"}</h1>
        <p className="mt-1 text-sm text-faint">
          Read-only shared summary · {s.totalTrades} trades
          {s.firstTradeAt && s.lastTradeAt
            ? ` · ${new Date(s.firstTradeAt).toLocaleDateString()} – ${new Date(s.lastTradeAt).toLocaleDateString()}`
            : ""}
        </p>

        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Net P&L" value={fmtUsd(s.netPnl, { sign: true })} tone={s.netPnl >= 0 ? "profit" : "loss"} />
          <Stat label="Win rate" value={fmtPct(s.winRate, 0)} />
          <Stat label="Profit factor" value={s.profitFactor.toFixed(2)} />
          <Stat label="Max drawdown" value={fmtPct(s.maxDrawdownPct, 1)} tone="loss" />
        </div>

        {s.equityCurve.length > 1 && (
          <div className="card p-5 mt-5">
            <h3 className="font-medium text-sm mb-3">Equity curve</h3>
            <EquityChart data={s.equityCurve} />
          </div>
        )}

        <p className="mt-8 text-xs text-faint text-center">
          Shared read-only via TradeStats Mentor Mode — no login, no access to the account.
        </p>
      </div>
    </div>
  );
}

function Unavailable() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center px-4">
      <div className="text-center text-muted">
        <p className="text-lg font-medium">This link isn&apos;t available.</p>
        <p className="text-sm mt-1 text-faint">It may have been revoked, or sharing is currently disabled.</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-faint">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""}`}>
        {value}
      </div>
    </div>
  );
}
