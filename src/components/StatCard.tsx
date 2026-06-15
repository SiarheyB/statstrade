import clsx from "clsx";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  change,
  changeUnit = "%",
  changeHint,
}: {
  label: React.ReactNode;
  value: string;
  hint?: React.ReactNode;
  tone?: "default" | "profit" | "loss" | "accent";
  change?: number | null; // trend vs previous period; +green / −red
  changeUnit?: string; // "%" (relative) or " pp" (percentage points)
  changeHint?: string; // small caption next to the badge, e.g. "30d"
}) {
  const up = (change ?? 0) >= 0;
  return (
    <div className="card p-4 sm:p-[18px]">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div
        className={clsx(
          "text-2xl font-semibold tracking-tight tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
          tone === "accent" && "text-accent",
        )}
      >
        {value}
      </div>
      {(hint || change != null) && (
        <div className="mt-1.5 flex items-center gap-2 text-xs">
          {change != null && (
            <span
              title={changeHint}
              className={clsx(
                "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums",
                up ? "bg-profit/12 text-profit" : "bg-loss/12 text-loss",
              )}
            >
              {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
              {up ? "+" : ""}
              {change.toFixed(1)}
              {changeUnit}
            </span>
          )}
          {hint && <span className="text-faint">{hint}</span>}
        </div>
      )}
    </div>
  );
}

// Small label/value row used in compact stat panels.
export function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted">{label}</span>
      <span
        className={clsx(
          "font-medium tabular-nums",
          tone === "profit" && "text-profit",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </span>
    </div>
  );
}
