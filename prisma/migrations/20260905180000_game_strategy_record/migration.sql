-- Трек-рекорд стратегии на игровом рынке.
--
-- До этого стратегия продавалась «котом в мешке»: покупатель видел настройки
-- и цену, но не результат. Теперь автор вместе с синхронизацией мира
-- присылает итоги СВОЕГО бота по этой стратегии — сделки, долю прибыльных и
-- средний результат, — и они показываются в карточке.
--
-- Числа необязательные: пока бот не наторговал, у стратегии нет истории, и
-- это честнее нуля, который читался бы как «стратегия убыточна».
ALTER TABLE "GameStrategy" ADD COLUMN "trades" INTEGER;
ALTER TABLE "GameStrategy" ADD COLUMN "winRate" DOUBLE PRECISION;
ALTER TABLE "GameStrategy" ADD COLUMN "avgPnl" DOUBLE PRECISION;
ALTER TABLE "GameStrategy" ADD COLUMN "reportedAt" TIMESTAMP(3);

-- Стратегия помнит, из какого бота её опубликовали: по этому id автор
-- присылает обновления результата, не подбирая стратегию по настройкам.
ALTER TABLE "GameStrategy" ADD COLUMN "botId" TEXT;
