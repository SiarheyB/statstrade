-- Облачная копия локального сохранения игры: баланс, позиции, история
-- сделок и т.п. Раньше это жило только в IndexedDB браузера, и вход под тем
-- же аккаунтом с другого устройства показывал стартовое состояние.
CREATE TABLE "GameCloudSave" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameElapsedMs" DOUBLE PRECISION NOT NULL,
    "payload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameCloudSave_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GameCloudSave_userId_key" ON "GameCloudSave"("userId");

ALTER TABLE "GameCloudSave" ADD CONSTRAINT "GameCloudSave_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
