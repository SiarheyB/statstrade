-- Боты-участники мира.
--
-- Пустой мир не оживает сам: рейтинг из одного человека, чат, где не с кем
-- говорить, фонды, в которые некому вступать. Боты дают миру население с
-- первого дня — они торгуют, попадают в рейтинг и разговаривают.
--
-- У бота нет пользователя: userId становится необязательным. Заводить ботам
-- фиктивные учётные записи было бы хуже — они попали бы в списки
-- пользователей, в аналитику и в рассылки, а это уже вранье не игроку, а
-- самому себе.
ALTER TABLE "GamePlayer" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "GamePlayer" ADD COLUMN "isBot" BOOLEAN NOT NULL DEFAULT false;
-- Характер бота: от него зависит и стиль торговли, и манера речи.
ALTER TABLE "GamePlayer" ADD COLUMN "persona" TEXT;
-- Когда бот в последний раз что-то делал: по этой отметке идёт ленивый такт.
ALTER TABLE "GamePlayer" ADD COLUMN "lastBotActAt" TIMESTAMP(3);
CREATE INDEX "GamePlayer_isBot_idx" ON "GamePlayer"("isBot");
