-- "Mentor Mode": read-only публичная capability-ссылка на агрегированную
-- статистику пользователя (без логина), для шаринга с ментором/партнёром.

CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");
CREATE INDEX "ShareLink_userId_idx" ON "ShareLink"("userId");

ALTER TABLE "ShareLink" ADD CONSTRAINT "ShareLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
