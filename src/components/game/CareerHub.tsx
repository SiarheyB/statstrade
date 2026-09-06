"use client";

// Раздел «Карьера» — восемь разных карточек (офис, испытания, рынки,
// прокачка, алго-боты, статус, достижения, работа) раньше стояли одна под
// другой на одной странице: чтобы найти алго-ботов, нужно было промотать
// мимо пяти экранов. Здесь та же информация, но разложена по вкладкам —
// тем же приёмом, что категории в магазине (Shop.tsx): открыл раздел,
// увидел разделы, а не бесконечный список.
import { useState } from "react";
import { Bot, Briefcase, Building2, Layers, Target, Trophy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import TraderOffice from "./TraderOffice";
import ContractsPanel from "./ContractsPanel";
import MarketsPanel from "./MarketsPanel";
import PerkTree from "./PerkTree";
import BotsPanel from "./BotsPanel";
import CareerPanel from "./CareerPanel";
import Achievements from "./Achievements";
import WorkPanel from "./WorkPanel";
import type { PerkEffects } from "@/engine/player/perks";
import type { GameState } from "@/engine/gameLoop";

const SECTIONS = ["office", "contracts", "skills", "bots", "achievements", "job"] as const;
type CareerSection = (typeof SECTIONS)[number];

const SECTION_ICON: Record<CareerSection, typeof Bot> = {
  office: Building2,
  contracts: Target,
  skills: Layers,
  bots: Bot,
  achievements: Trophy,
  job: Briefcase,
};

export default function CareerHub({
  game,
  tools,
  allMarketCounts,
  startingBalance,
}: {
  game: GameState;
  /** Инструменты, разблокированные перками — то, что раньше звалось perkEffects(game.perks).tools. */
  tools: PerkEffects["tools"];
  allMarketCounts: Record<string, number>;
  startingBalance: number;
}) {
  const { t } = useI18n();
  const [section, setSection] = useState<CareerSection>("office");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 w-fit rounded-lg bg-surface-2 p-1">
        {SECTIONS.map((name) => {
          const Icon = SECTION_ICON[name];
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSection(name)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition ${
                section === name ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              <Icon size={14} />
              {t(`game.career.section.${name}`)}
            </button>
          );
        })}
      </div>

      {section === "office" && (
        <div className="space-y-4">
          <TraderOffice lifestyle={game.lifestyle} tools={tools} />
          <CareerPanel
            account={game.account}
            lifestyle={game.lifestyle}
            startingBalance={startingBalance}
            tax={game.tax}
            tools={tools}
          />
        </div>
      )}

      {section === "contracts" && (
        <div className="space-y-4">
          <ContractsPanel
            contracts={game.contracts}
            equity={game.account.equity}
            balance={game.account.balance}
            currentDay={game.gameCalendarDay}
          />
          <MarketsPanel unlocked={game.unlockedMarkets} assetCounts={allMarketCounts} />
        </div>
      )}

      {section === "skills" && (
        <PerkTree perks={game.perks} skills={game.account.skills} contractPoints={game.contractPoints} />
      )}

      {section === "bots" && <BotsPanel bots={game.bots} perks={game.perks} assets={game.activeAssets} />}

      {section === "achievements" && <Achievements unlocked={game.achievements} streak={game.streak} />}

      {/* Работа и банкротство — про путь игрока, а не про рынок. */}
      {section === "job" && <WorkPanel />}
    </div>
  );
}
