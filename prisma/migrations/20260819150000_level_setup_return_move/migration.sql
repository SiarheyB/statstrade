-- ЛП2Б: сколько завтрашнему бару пройти, чтобы вернуть цену за уровень (в ATR).
-- Nullable — у пробоя и обычного ЛП величины нет: цена ещё не за уровнем.
ALTER TABLE "LevelSetup" ADD COLUMN "returnMoveAtr" DOUBLE PRECISION;
