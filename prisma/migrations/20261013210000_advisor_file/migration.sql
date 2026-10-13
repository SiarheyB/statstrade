-- Загруженная через админку сборка советника MT5 (одна строка "current").
CREATE TABLE "AdvisorFile" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT NOT NULL,

    CONSTRAINT "AdvisorFile_pkey" PRIMARY KEY ("id")
);
