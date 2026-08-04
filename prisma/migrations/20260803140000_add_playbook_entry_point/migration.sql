-- Playbook: add optional entryPoint (ТВХ) scoping within a pattern.
-- "" (default) = playbook applies to the whole pattern regardless of entry
-- point; a non-empty value narrows it to one specific ТВХ within that
-- pattern. Uniqueness moves from (userId, name) to (userId, name, entryPoint)
-- so a user can have both a pattern-wide playbook and per-entry-point ones.

ALTER TABLE "Playbook" ADD COLUMN "entryPoint" TEXT NOT NULL DEFAULT '';

DROP INDEX "Playbook_userId_name_key";

CREATE UNIQUE INDEX "Playbook_userId_name_entryPoint_key" ON "Playbook"("userId", "name", "entryPoint");
