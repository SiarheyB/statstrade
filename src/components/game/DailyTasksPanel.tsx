"use client";

// Задания дня — «что делать прямо сейчас». Три штуки, обновляются со сменой
// игрового дня, награда падает автоматически: лишний клик «забрать» ничего
// не добавляет, а раздражает.
import { CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { taskProgress, tasksForDay, type DailyContext } from "@/engine/player/dailyTasks";
import type { DailyState } from "@/engine/player/dailyTasks";

export default function DailyTasksPanel({ daily, ctx }: { daily: DailyState; ctx: DailyContext }) {
  const { t } = useI18n();
  const tasks = tasksForDay(ctx.day);

  return (
    <div className="card p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium">{t("game.daily.title")}</div>
        <div className="text-[11px] text-faint">{t("game.daily.day", { day: ctx.day + 1 })}</div>
      </div>
      <div className="mt-2 space-y-2">
        {tasks.map((task) => {
          const done = daily.day === ctx.day && daily.completedIds.includes(task.id);
          const progress = Math.min(task.target, taskProgress(task, ctx));
          const pct = (progress / task.target) * 100;
          return (
            <div key={task.id}>
              <div className="flex items-center gap-2 text-xs">
                {done ? (
                  <CheckCircle2 size={13} className="text-profit shrink-0" />
                ) : (
                  <span className="w-[13px] shrink-0" />
                )}
                <span className={done ? "text-faint line-through" : ""}>
                  {t(`game.daily.task.${task.kind}`, { target: task.target })}
                </span>
                <span className="ml-auto text-faint tabular-nums">
                  {progress}/{task.target}
                </span>
                <span className="text-accent tabular-nums w-14 text-right">{fmtUsd(task.rewardCash)}</span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-surface-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${done ? "bg-profit" : "bg-accent"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
