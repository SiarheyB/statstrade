-- «Отбирать всё»: флаг записи всех уровней стакана без порога (на символ+рынок).
ALTER TABLE "CollectorConfig" ADD COLUMN "collectAll" BOOLEAN NOT NULL DEFAULT false;
