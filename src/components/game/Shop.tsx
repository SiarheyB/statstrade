"use client";

// Магазин и образ жизни трейдера — раздел 13 спеки. Отвечает на «а зачем
// вообще зарабатывать»: заработанное можно потратить на терминал, рабочее
// место, жильё и статус. Ни один предмет не влияет на торговлю (проверка
// этого правила — тестом в engine/economy/__tests__/shop.test.ts), поэтому
// магазин безопасно показывать даже игроку, который зашёл сюда первым делом.
//
// Вся арифметика — в движке (engine/economy/shop.ts): компонент только
// показывает и вызывает действия стора (раздел 17).
import { useState } from "react";
import { Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import {
  canPurchase,
  FUND_LICENSE_ITEM_ID,
  monthlyUpkeep,
  nextRank,
  SHOP_CATEGORIES,
  SHOP_ITEMS,
  traderRankKey,
} from "@/engine/economy/shop";
import type { ShopCategory, ShopItem } from "@/engine/entities/types";

function ItemCard({ item, owned }: { item: ShopItem; owned: boolean }) {
  const { t } = useI18n();
  const balance = useGameStore((s) => s.game.account.balance);
  const prestige = useGameStore((s) => s.game.account.reputation);
  const lifestyle = useGameStore((s) => s.game.lifestyle);
  const purchase = useGameStore((s) => s.purchaseShopItem);
  const equipTheme = useGameStore((s) => s.equipShopTheme);

  const check = canPurchase(item, balance, lifestyle, prestige);
  const locked = !check.ok && check.error === "locked";
  const equipped = lifestyle.equippedThemeId === item.id;

  return (
    <div className={`card p-3 flex flex-col gap-2 ${owned ? "border-accent/40" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="text-xl leading-none">{item.icon}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{t(`game.shop.item.${item.id}.name`)}</div>
          <div className="text-[11px] text-faint">{t(`game.shop.item.${item.id}.desc`)}</div>
        </div>
      </div>

      <div className="text-xs text-faint space-y-0.5">
        <div className="flex justify-between">
          <span>{t("game.shop.price")}</span>
          <span className="text-fg tabular-nums">{item.price === 0 ? t("game.shop.free") : fmtUsd(item.price)}</span>
        </div>
        {item.upkeepPerMonth > 0 && (
          <div className="flex justify-between">
            <span>{t("game.shop.upkeep")}</span>
            <span className="text-loss tabular-nums">−{fmtUsd(item.upkeepPerMonth)}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>{t("game.shop.prestige")}</span>
          <span className="text-accent tabular-nums">+{item.prestige}</span>
        </div>
      </div>

      {owned ? (
        item.category === "theme" ? (
          <button
            type="button"
            disabled={equipped}
            onClick={() => equipTheme(item.id)}
            className={`w-full px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              equipped ? "bg-accent/10 text-accent cursor-default" : "bg-accent/15 text-accent hover:bg-accent/25"
            }`}
          >
            {equipped ? t("game.shop.equipped") : t("game.shop.equip")}
          </button>
        ) : (
          <div className="text-xs text-accent text-center py-1.5">{t("game.shop.owned")}</div>
        )
      ) : (
        <button
          type="button"
          disabled={!check.ok}
          onClick={() => purchase(item.id)}
          title={locked ? t("game.shop.lockedHint", { prestige: item.requiresPrestige }) : undefined}
          className="w-full px-3 py-1.5 rounded-lg text-xs font-medium transition bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1"
        >
          {locked && <Lock size={12} />}
          {locked ? t("game.shop.locked", { prestige: item.requiresPrestige }) : t("game.shop.buy")}
        </button>
      )}
    </div>
  );
}

// Имя фонда — единственная «косметика», которую игрок пишет сам. Открывается
// покупкой лицензии (FUND_LICENSE_ITEM_ID): до неё поле не показываем вовсе,
// иначе непонятно, зачем нужен предмет за 5 000.
function FundNameField() {
  const { t } = useI18n();
  const fundName = useGameStore((s) => s.game.lifestyle.fundName);
  const setFundName = useGameStore((s) => s.setFundName);
  const [draft, setDraft] = useState(fundName);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-faint">{t("game.shop.fundName")}</label>
      <input
        value={draft}
        maxLength={40}
        placeholder={t("game.shop.fundNamePlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setFundName(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="input-base px-2 py-1 text-sm w-56"
      />
    </div>
  );
}

export default function Shop() {
  const { t } = useI18n();
  const balance = useGameStore((s) => s.game.account.balance);
  const prestige = useGameStore((s) => s.game.account.reputation);
  const lifestyle = useGameStore((s) => s.game.lifestyle);
  const [category, setCategory] = useState<ShopCategory>("theme");

  const upkeep = monthlyUpkeep(lifestyle);
  const rank = traderRankKey(prestige);
  const next = nextRank(prestige);
  const items = SHOP_ITEMS.filter((i) => i.category === category);
  const ownsFundLicense = lifestyle.ownedItemIds.includes(FUND_LICENSE_ITEM_ID);

  return (
    <div className="card p-4 space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{t("game.shop.title")}</div>
        <div className="text-xs text-faint">{t("game.shop.subtitle")}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{t("game.shop.rank")}</div>
          <div className="font-medium text-accent">{t(`game.shop.rank.${rank}`)}</div>
          <div className="text-[11px] text-faint">
            {next ? t("game.shop.rankNext", { rank: t(`game.shop.rank.${next.key}`), prestige: next.remaining }) : t("game.shop.rankMax")}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{t("game.shop.prestige")}</div>
          <div className="font-medium tabular-nums">{prestige}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{t("game.shop.upkeepTotal")}</div>
          <div className={`font-medium tabular-nums ${upkeep > 0 ? "text-loss" : ""}`}>
            {upkeep > 0 ? `−${fmtUsd(upkeep)}` : fmtUsd(0)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted">{t("game.shop.spent")}</div>
          <div className="font-medium tabular-nums">{fmtUsd(lifestyle.totalSpent + lifestyle.totalUpkeepPaid)}</div>
        </div>
      </div>

      {/* Предупреждение, а не блокировка: игрок вправе жить не по средствам,
          но узнать об этом он должен из интерфейса, а не по пропавшим
          деньгам (баланс при этом в минус не уходит — см. chargeUpkeep). */}
      {lifestyle.unpaidUpkeep > 0 && (
        <div className="text-xs text-loss">{t("game.shop.unpaidWarning", { amount: fmtUsd(lifestyle.unpaidUpkeep) })}</div>
      )}
      {upkeep > 0 && upkeep > balance && lifestyle.unpaidUpkeep === 0 && (
        <div className="text-xs text-loss">{t("game.shop.upkeepRisk")}</div>
      )}

      {ownsFundLicense && <FundNameField />}

      <div className="flex items-center gap-1 w-fit rounded-lg bg-surface-2 p-1">
        {SHOP_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              category === c ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            {t(`game.shop.category.${c}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} owned={lifestyle.ownedItemIds.includes(item.id)} />
        ))}
      </div>
    </div>
  );
}
