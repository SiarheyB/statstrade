-- «Новых посетителей» считаем через NOT EXISTS: был ли у этого visitorId хоть
-- один просмотр до начала периода. Без индекса по (visitorId, ts) это
-- превращается в полный проход самой большой таблицы аналитики.
CREATE INDEX "PageView_visitorId_ts_idx" ON "PageView"("visitorId", "ts");
