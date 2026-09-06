"use client";

// Дерево перков — то, во что превращается опыт. Ветки соответствуют тому,
// как игрок хочет расти: инструменты (что вижу), условия (как торгую),
// развитие (как быстро расту), связи (что могу с другими игроками).
import { Check, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { availablePoints, PERKS, getPerk } from "@/engine/player/perks";
import { useGameStore } from "@/store/gameStore";
import type { PerkBranch, PerkState, SkillTree } from "@/engine/entities/types";

const BRANCHES: PerkBranch[] = ["tools", "terms", "growth", "social"];

export default function PerkTree({
  perks,
  skills,
  contractPoints,
}: {
  perks: PerkState;
  skills: SkillTree;
  contractPoints: number;
}) {
  const { t } = useI18n();
  const unlock = useGameStore((s) => s.unlockPerk);
  const points = availablePoints(skills, contractPoints, perks);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("game.perks.title")}</div>
          <div className="text-xs text-faint">{t("game.perks.hint")}</div>
        </div>
        <div className="text-sm">
          <span className="text-muted">{t("game.perks.points")}: </span>
          <span className="font-semibold text-accent tabular-nums">{points}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {BRANCHES.map((branch) => (
          <div key={branch} className="space-y-2">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t(`game.perks.branch.${branch}`)}</div>
            {PERKS.filter((p) => p.branch === branch).map((perk) => {
              const owned = perks.unlocked.includes(perk.id);
              const missingReq = perk.requires.filter((r) => !perks.unlocked.includes(r));
              const affordable = points >= perk.cost;
              const locked = missingReq.length > 0;
              return (
                <button
                  key={perk.id}
                  type="button"
                  disabled={owned || locked || !affordable}
                  onClick={() => unlock(perk.id)}
                  title={
                    locked
                      ? t("game.perks.requires", {
                          perk: missingReq.map((r) => t(`game.perk.${getPerk(r)?.id}.name`)).join(", "),
                        })
                      : undefined
                  }
                  className={`w-full text-left rounded-lg border p-3 transition ${
                    owned
                      ? "border-accent/40 bg-accent/5"
                      : locked || !affordable
                        ? "border-border opacity-50 cursor-not-allowed"
                        : "border-border hover:border-accent/60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium">{t(`game.perk.${perk.id}.name`)}</span>
                    {owned ? (
                      <Check size={14} className="text-accent shrink-0 mt-0.5" />
                    ) : locked ? (
                      <Lock size={13} className="text-faint shrink-0 mt-0.5" />
                    ) : (
                      <span className="text-xs tabular-nums text-accent shrink-0">{perk.cost}</span>
                    )}
                  </div>
                  <div className="mt-1 text-[11px] text-faint">{t(`game.perk.${perk.id}.desc`)}</div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
