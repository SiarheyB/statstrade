import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { getSession } from "@/lib/auth";
import { isAdminSession } from "@/lib/admin";
import { getFeatureConfig } from "@/lib/featureConfig";
import GameTerminal from "@/components/game/GameTerminal";
import { tuningFromConfig } from "@/engine/entities/tuning";

export const dynamic = "force-dynamic";

// Серверная проверка доступа к разделу «Игра» — защищает не только пункт
// меню (см. DashboardNav), но и прямой заход по URL. Два независимых
// переключателя из /admin/features (тот же приём, что у форекса — см.
// src/app/dashboard/forex/page.tsx):
//   game             — общий выключатель, скрыт даже для админа.
//   gamePublicAccess — доступ для обычных пользователей; админ видит раздел
//                       в любом случае.
function AccessDenied({ text }: { text: string }) {
  return (
    <div className="p-6 md:p-8 max-w-2xl">
      <div className="card p-6 flex items-start gap-3 border-loss/30">
        <ShieldAlert size={24} className="text-loss shrink-0 mt-0.5" />
        <div>
          <div className="font-medium text-fg">Доступ запрещён</div>
          <p className="mt-1 text-sm text-muted">{text}</p>
        </div>
      </div>
    </div>
  );
}

export default async function GamePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const admin = isAdminSession(session);

  const [game, gamePublicAccess] = await Promise.all([
    getFeatureConfig("game"),
    getFeatureConfig("gamePublicAccess"),
  ]);

  if (!game.enabled) {
    return <AccessDenied text="Раздел «Игра» временно отключён администратором." />;
  }
  if (!admin && !gamePublicAccess.enabled) {
    return <AccessDenied text="Раздел «Игра» пока недоступен для обычных пользователей." />;
  }

  // Настройки баланса читаются на сервере и уезжают в клиентский движок
  // пропсом: игра целиком клиентская, но её баланс должен подчиняться
  // админке (/admin/game) без передеплоя и без правок в чужих сохранениях.
  const { enabled: _enabled, ...raw } = game;
  return <GameTerminal tuning={tuningFromConfig(raw as Record<string, number>)} />;
}
