-- Отзыв сессий: версия токена в JWT сверяется с этой колонкой (кэш ~60с в
-- приложении). Инкремент при смене пароля инвалидирует все старые cookie.
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
