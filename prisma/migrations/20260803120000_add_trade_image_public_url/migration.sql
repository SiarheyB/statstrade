-- Публичная ссылка на скриншот сделки (страница просмотра, работает без входа
-- в приложение) — отдельно от imageUrl, который для yandex_disk указывает на
-- наш защищённый сессией прокси /api/trade-images/view (нужен для <img src>
-- внутри UI). Для google_drive imageUrl уже публичный, туда дублируется то же
-- значение. Используется в CSV-экспорте сделок.
ALTER TABLE "TradeAnnotation" ADD COLUMN "imagePublicUrl" TEXT;
