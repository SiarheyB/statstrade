"use client";

// Дисклеймер при первом запуске — раздел 14 спеки: обязательный экран перед
// любой игрой, кнопка "Понятно, начать". Не показывается повторно (флаг
// disclaimerSeen персистится в SaveGame).
import { useI18n } from "@/lib/i18n/provider";
import { useGameStore } from "@/store/gameStore";
import { AlertTriangle } from "lucide-react";

export default function GameDisclaimer() {
  const { t } = useI18n();
  const acceptDisclaimer = useGameStore((s) => s.acceptDisclaimer);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
      <div className="card w-full max-w-md p-5 space-y-3">
        <div className="flex items-center gap-2 text-loss">
          <AlertTriangle size={20} />
          <h2 className="text-lg font-semibold text-fg">{t("game.disclaimer.title")}</h2>
        </div>
        <p className="text-sm text-muted leading-relaxed">{t("game.disclaimer.body")}</p>
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={acceptDisclaimer}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition"
          >
            {t("game.disclaimer.accept")}
          </button>
        </div>
      </div>
    </div>
  );
}
