// Настройки терминала, которые переживают уход со вкладки и перезагрузку.
//
// Переключение на «Портфель» и обратно размонтирует график, и всё, что игрок
// настроил, пропадало: выбранный таймфрейм сбрасывался на дефолт стиля,
// растянутый масштаб — на автоматический. Это выбор рабочего места, а не
// разовое действие: вернувшись, человек ждёт ровно тот экран, который
// оставил.
//
// Лежат в localStorage рядом с языком и таймзоной — тем же способом, что
// настройки графиков форекса и карты ордеров (см. lib/chartPrefs.ts). В базе
// их нет намеренно.
//
// ВАЖНО: читать только в эффекте. Страница рендерится и на сервере, где
// localStorage нет.
import { readChartPrefs, writeChartPrefs } from "@/lib/chartPrefs";

const KEY = "game.terminal.settings";

export interface StoredView {
  i0: number;
  i1: number;
  y0: number;
  y1: number;
}

export interface TerminalPrefs {
  /** Выбранный инструмент. */
  assetId?: string;
  /** Таймфрейм — СВОЙ для каждого стиля: у скальпинга и инвестиций наборы не пересекаются. */
  tf?: Record<string, string>;
  showMa?: boolean;
  showVolume?: boolean;
  showRsi?: boolean;
  /** Масштаб и положение окна — по ключу «инструмент|таймфрейм». */
  views?: Record<string, StoredView>;
}

// Сколько окон помним. Больше трёх десятков — это уже не «вернуться туда,
// где был», а бесконечно растущая запись в хранилище.
const MAX_VIEWS = 30;

export function readTerminalPrefs(): TerminalPrefs {
  return readChartPrefs(KEY) as TerminalPrefs;
}

export function writeTerminalPrefs(patch: TerminalPrefs): void {
  const current = readTerminalPrefs();
  writeChartPrefs(KEY, { ...current, ...patch });
}

export function viewKey(assetId: string, tf: string): string {
  return `${assetId}|${tf}`;
}

/** Запомнить окно просмотра. `null` — игрок вернулся к автоматическому масштабу. */
export function saveView(assetId: string, tf: string, view: StoredView | null): void {
  const current = readTerminalPrefs();
  const views = { ...(current.views ?? {}) };
  const key = viewKey(assetId, tf);
  if (view == null) delete views[key];
  else views[key] = view;

  // Старые записи вытесняем по порядку вставки: у объекта он сохраняется,
  // и этого достаточно — точность вытеснения здесь никого не волнует.
  const keys = Object.keys(views);
  if (keys.length > MAX_VIEWS) {
    for (const stale of keys.slice(0, keys.length - MAX_VIEWS)) delete views[stale];
  }
  writeChartPrefs(KEY, { ...current, views });
}
