// Human-readable summary of which accounts/exchanges a set of trades belongs
// to — shown next to Exit efficiency / Monte Carlo so it's clear what's being
// analyzed when the Analytics page's account filter is "All accounts" (which
// can silently mix several exchanges together otherwise).

import type { SerializedTrade, AccountSummary } from "@/lib/types";

export function scopeLabel(
  trades: Pick<SerializedTrade, "accountId" | "exchange">[],
  accounts: AccountSummary[],
): string {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const t of trades) {
    const acc = byId.get(t.accountId);
    const label = acc ? `${acc.label} (${acc.exchange})` : t.exchange;
    if (!seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels.join(", ");
}
