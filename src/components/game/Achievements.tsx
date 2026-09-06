"use client";

// Коллекция достижений и серия заходов.
//
// Между контрактами проходят дни, и в эти дни прогресс не виден вообще —
// достижения называют вслух то, что игрок уже делает, и отмечают моменты,
// случившиеся впервые.
//
// Скрытые до получения показываются заглушкой: назвать их заранее — значит
// превратить редкий момент («вернулся с нуля», «просидел в позиции неделю»)
// в задание, которое выполняют нарочно.
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { ACHIEVEMENTS, streakReward, STREAK_MAX_MULTIPLIER } from "@/engine/player/achievements";
import type { StreakState } from "@/engine/entities/types";
import { Lock, Trophy } from "lucide-react";

export default function Achievements({ unlocked, streak }: { unlocked: string[]; streak: StreakState }) {
  const { t } = useI18n();
  const have = new Set(unlocked);
  const capped = streak.days >= STREAK_MAX_MULTIPLIER;

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("game.achievement.title")}</div>
          <div className="text-xs text-faint mt-0.5">
            {t("game.achievement.progress", { have: have.size, total: ACHIEVEMENTS.length })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">{t("game.streak.days", { days: streak.days })}</div>
          <div className="text-xs text-faint">
            {capped
              ? t("game.streak.capped", { amount: fmtUsd(streakReward(streak.days)) })
              : t("game.streak.next", { amount: fmtUsd(streakReward(streak.days + 1)) })}
            {streak.best > streak.days && ` · ${t("game.streak.best", { days: streak.best })}`}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ACHIEVEMENTS.map((achievement) => {
          const earned = have.has(achievement.id);
          const secret = achievement.hidden && !earned;
          return (
            <div
              key={achievement.id}
              className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ${
                earned ? "bg-accent/10" : "bg-surface-2"
              }`}
            >
              {secret ? (
                <Lock size={14} className="mt-0.5 shrink-0 text-faint" />
              ) : (
                <Trophy size={14} className={`mt-0.5 shrink-0 ${earned ? "text-accent" : "text-faint"}`} />
              )}
              <div className="min-w-0">
                <div className={`text-sm ${earned ? "font-medium" : "text-muted"}`}>
                  {secret ? t("game.achievement.secret") : t(`game.achievement.${achievement.id}`)}
                </div>
                {!secret && (
                  <div className="text-[11px] text-faint leading-snug">
                    {t(`game.achievement.${achievement.id}.desc`)}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
