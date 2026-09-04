// Локальное сохранение игры — раздел 12 спеки, через Dexie (IndexedDB).
// Один слот сохранения на браузер (Фаза 1 не предполагает несколько
// партий/профилей — при необходимости достаточно завести несколько строк
// по ключу вместо переделки схемы).
import Dexie, { type Table } from "dexie";
import type { SaveGame } from "@/engine/entities/types";

const CURRENT_SAVE_ID = "current";

interface SaveRow extends SaveGame {
  id: string;
}

class TradingGameDB extends Dexie {
  saves!: Table<SaveRow, string>;

  constructor() {
    super("TradingGameDB");
    this.version(1).stores({
      // Единственное индексируемое поле — первичный ключ; остального
      // Dexie не индексирует, храним как есть (структурированные клоны).
      saves: "id",
    });
  }
}

// Ленивая инициализация: Dexie трогает indexedDB при создании инстанса, а
// этот модуль может импортироваться в SSR-контексте (Next.js рендерит
// страницу и на сервере) — там indexedDB не существует.
let dbInstance: TradingGameDB | null = null;
function getDb(): TradingGameDB | null {
  if (typeof indexedDB === "undefined") return null;
  if (!dbInstance) dbInstance = new TradingGameDB();
  return dbInstance;
}

export async function loadGame(): Promise<SaveGame | null> {
  const db = getDb();
  if (!db) return null;
  const row = await db.saves.get(CURRENT_SAVE_ID);
  if (!row) return null;
  const { id: _id, ...save } = row;
  return save;
}

export async function saveGame(save: SaveGame): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.saves.put({ ...save, id: CURRENT_SAVE_ID });
}

export async function deleteSave(): Promise<void> {
  const db = getDb();
  if (!db) return;
  await db.saves.delete(CURRENT_SAVE_ID);
}
