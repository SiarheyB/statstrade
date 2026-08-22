-- Два запроса ходили полным проходом по самым большим таблицам котировок.
--
-- 1) Коллектор форекса проверяет глубину истории таймфрейма:
--    SELECT MIN(t) FROM "FxCandle" WHERE exchange=? AND interval=?
--    Существующий индекс начинается с symbol, поэтому без него — Seq Scan
--    (75 мс на каждый вызов; по статистике БД это дало 81 млн прочитанных
--    строк). С индексом MIN берётся из первой записи.
CREATE INDEX "FxCandle_exchange_interval_t_idx" ON "FxCandle"("exchange", "interval", "t");

-- 2) Коллектор стакана при старте ищет самую старую свечу:
--    SELECT MIN(t) FROM "ObCandle"
--    Индекса по одному t не было, поэтому читалась вся таблица (257 МБ).
CREATE INDEX "ObCandle_t_idx" ON "ObCandle"("t");
