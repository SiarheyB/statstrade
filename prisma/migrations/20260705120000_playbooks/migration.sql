-- Именованные стратегии/сетапы ("плейбуки") с текстом правил — расширяют
-- существующий тег pattern документацией и (считается на лету, не хранится)
-- статистикой по сделкам с этим паттерном.

CREATE TABLE "Playbook" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playbook_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Playbook_userId_idx" ON "Playbook"("userId");
CREATE UNIQUE INDEX "Playbook_userId_name_key" ON "Playbook"("userId", "name");

ALTER TABLE "Playbook" ADD CONSTRAINT "Playbook_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
