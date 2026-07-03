-- После пересоздания Ob*-таблиц партиционированными (partition_ob_tables) у
-- новых партиций нет статистики планировщика, пока autovacuum до них не дойдёт —
-- планы запросов деградируют. Собираем статистику явно.
ANALYZE "ObSnapshot";
ANALYZE "ObTrade";
ANALYZE "ObFootprint";
ANALYZE "ObBigTrade";
