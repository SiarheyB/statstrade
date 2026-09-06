"use client";

// Предложение спонсора после разорения.
//
// Это самый важный экран в игре, и он обязан выглядеть не как проигрыш, а
// как развилка. Проигрыш уже случился — окно про то, что делать дальше:
// взять чужие деньги и несколько недель работать не только на себя, или
// остаться при своих и выбираться самому.
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { sponsorOffer, WIPEOUT_PRESTIGE_PENALTY } from "@/engine/player/bailout";
import { useGameStore } from "@/store/gameStore";

export default function SponsorModal() {
  const { t } = useI18n();
  const wipedOut = useGameStore((s) => s.game.wipedOut);
  const startingBalance = useGameStore((s) => s.game.tuning.startingBalance);
  const equity = useGameStore((s) => s.game.account.equity);
  const accept = useGameStore((s) => s.acceptSponsor);
  const decline = useGameStore((s) => s.declineSponsor);

  if (!wipedOut) return null;
  const deal = sponsorOffer(startingBalance);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="card w-full max-w-md p-6 space-y-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.12em] text-loss">{t("game.sponsor.eyebrow")}</div>
          <h2 className="mt-1 text-xl font-semibold">{t("game.sponsor.title")}</h2>
          <p className="mt-2 text-sm text-muted leading-relaxed">
            {t("game.sponsor.lead", { equity: fmtUsd(equity) })}
          </p>
        </div>

        <div className="rounded-lg bg-surface-2 p-3 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{t("game.sponsor.stake")}</span>
            <span className="tabular-nums font-medium text-profit">{fmtUsd(deal.stake)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{t("game.sponsor.share")}</span>
            <span className="tabular-nums font-medium">{deal.sharePct}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{t("game.sponsor.owed")}</span>
            <span className="tabular-nums font-medium">{fmtUsd(deal.owed)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted">{t("game.sponsor.prestige")}</span>
            <span className="tabular-nums font-medium text-loss">−{WIPEOUT_PRESTIGE_PENALTY}</span>
          </div>
        </div>

        <p className="text-xs text-faint leading-relaxed">{t("game.sponsor.fineprint")}</p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={decline}
            className="input-base px-3 py-2 text-sm hover:border-border-strong"
          >
            {t("game.sponsor.decline")}
          </button>
          <button
            type="button"
            onClick={accept}
            className="px-3 py-2 rounded-lg text-sm font-medium bg-accent text-white"
          >
            {t("game.sponsor.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
