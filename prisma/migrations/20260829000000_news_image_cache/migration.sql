-- Обложки новостей, сохранённые у нас.
--
-- Источники отдают картинки в исходном размере (до полутора мегабайт на
-- карточку высотой 80 px) и с чужого CDN — одна такая обложка грузилась
-- 16 секунд. Здесь лежит ужатый webp, который отдаётся со своего сервера.
--
-- ON DELETE CASCADE: обложка живёт ровно столько же, сколько новость. Ретеншн
-- удаляет строки NewsItem — картинки уходят вместе с ними, без отдельной
-- уборки.
CREATE TABLE "NewsImage" (
    "newsId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL DEFAULT 'image/webp',
    "width" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsImage_pkey" PRIMARY KEY ("newsId")
);

ALTER TABLE "NewsImage" ADD CONSTRAINT "NewsImage_newsId_fkey"
    FOREIGN KEY ("newsId") REFERENCES "NewsItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
