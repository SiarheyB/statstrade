"use client";

// Онбординг — раздел 22 спеки, 8 экранов (без экрана дисклеймера — тот
// отдельный компонент GameDisclaimer, свой независимый флаг). Не более
// одного обязательного действия за шаг (правило раздела 22): шаги
// "действие" не показывают кнопку "Далее" — блокируются, пока состояние
// стора не подтвердит, что действие выполнено.
//
// ADJUSTED FROM SPEC: последний шаг ("запиши вывод в дневник") в оригинале
// открывает Journal — этого модуля нет в объёме Фазы 1 (раздел 15 не
// включает Journal в MVP-терминал), поэтому шаг адаптирован — указывает на
// вкладку "История" в PositionsPanel, где закрытая сделка уже видна.
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { useGameStore } from "@/store/gameStore";

type StepKind = "info" | "wait-open" | "wait-stop" | "wait-close" | "final";

const STEPS: { kind: StepKind; titleKey: string; bodyKey: string }[] = [
  { kind: "info", titleKey: "game.onboarding.step1.title", bodyKey: "game.onboarding.step1.body" },
  { kind: "info", titleKey: "game.onboarding.step2.title", bodyKey: "game.onboarding.step2.body" },
  { kind: "wait-open", titleKey: "game.onboarding.step3.title", bodyKey: "game.onboarding.step3.body" },
  { kind: "info", titleKey: "game.onboarding.step4.title", bodyKey: "game.onboarding.step4.body" },
  { kind: "wait-stop", titleKey: "game.onboarding.step5.title", bodyKey: "game.onboarding.step5.body" },
  { kind: "wait-close", titleKey: "game.onboarding.step6.title", bodyKey: "game.onboarding.step6.body" },
  { kind: "info", titleKey: "game.onboarding.step7.title", bodyKey: "game.onboarding.step7.body" },
  { kind: "final", titleKey: "game.onboarding.final.title", bodyKey: "game.onboarding.final.body" },
];

/**
 * Текущий шаг — чистая функция от (сколько раз игрок нажал "Далее" на
 * info-шагах) и (какие блокирующие условия уже выполнены), а не отдельный
 * useState, который двигал бы effect: setState внутри эффекта означает
 * лишний повторный рендер на каждое внешнее изменение стора (see
 * react-hooks/set-state-in-effect) — здесь дешевле пересчитать индекс на
 * каждый рендер, чем гонять его через эффект.
 */
function resolveStepIndex(
  manualNext: number,
  conditions: { hasOpenPosition: boolean; openHasStop: boolean; hasClosedPosition: boolean },
): number {
  let i = 0;
  let manualBudget = manualNext;
  while (i < STEPS.length - 1) {
    const kind = STEPS[i].kind;
    if (kind === "info") {
      if (manualBudget <= 0) break;
      manualBudget--;
    } else if (kind === "wait-open" && !conditions.hasOpenPosition) break;
    else if (kind === "wait-stop" && !conditions.openHasStop) break;
    else if (kind === "wait-close" && !conditions.hasClosedPosition) break;
    i++;
  }
  return i;
}

export default function GameOnboarding() {
  const { t } = useI18n();
  const positions = useGameStore((s) => s.game.account.positions);
  const completeOnboarding = useGameStore((s) => s.completeOnboarding);
  const [manualNext, setManualNext] = useState(0);

  // Условия должны быть МОНОТОННЫМИ ("хоть раз случилось"), а не "истинно
  // прямо сейчас": шаг 6 закрывает позицию, после чего hasOpenPosition (по
  // !p.closedAt) снова становится false — resolveStepIndex откатывал бы
  // прогресс назад к "открой позицию", хотя игрок уже там был. positions
  // хранит закрытые сделки в том же массиве (closedAt не снимается), так
  // что "actual ever happened" безопасно читать без фильтра по !closedAt.
  const hasOpenPosition = useMemo(() => positions.length > 0, [positions]);
  const openHasStop = useMemo(() => positions.some((p) => p.stopLoss != null), [positions]);
  const hasClosedPosition = useMemo(() => positions.some((p) => p.closedAt), [positions]);

  const stepIndex = resolveStepIndex(manualNext, { hasOpenPosition, openHasStop, hasClosedPosition });
  const step = STEPS[stepIndex];
  const canGoNext = step.kind === "info";
  const isFinal = step.kind === "final";

  return (
    // Не блокирующий оверлей: раздела 22 требует, чтобы игрок физически
    // выполнил действие (открыл позицию, поставил стоп) В ТЕРМИНАЛЕ ПОД
    // карточкой — полноэкранный fixed inset-0 с фоном перехватывал бы клики
    // по всей странице и делал это невозможным. pointer-events-none на
    // обёртке + pointer-events-auto на самой карточке пропускают клики
    // сквозь пустое пространство, но не сквозь карточку. По центру снизу
    // (не справа) — EconCalAlerts (напоминания о новостях) уже занимает
    // правый нижний угол на любой странице кабинета.
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 pointer-events-none">
      <div className="card w-full max-w-md p-5 space-y-3 pointer-events-auto shadow-2xl">
        <div className="text-[11px] uppercase tracking-wide text-faint">
          {t("game.onboarding.progress", { current: stepIndex + 1, total: STEPS.length })}
        </div>
        <h2 className="text-lg font-semibold">{t(step.titleKey)}</h2>
        <p className="text-sm text-muted leading-relaxed">{t(step.bodyKey)}</p>

        {!canGoNext && !isFinal && (
          <div className="flex items-center gap-2 text-xs text-faint pt-1">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
            {t("game.onboarding.waiting")}
          </div>
        )}

        <div className="flex justify-end pt-2">
          {isFinal ? (
            <button
              type="button"
              onClick={completeOnboarding}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition"
            >
              {t("game.onboarding.finish")}
            </button>
          ) : canGoNext ? (
            <button
              type="button"
              onClick={() => setManualNext((n) => n + 1)}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white hover:opacity-90 transition"
            >
              {t("game.onboarding.next")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
