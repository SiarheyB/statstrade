// Обращение к языковой модели через OpenRouter.
//
// Зачем через него: OpenRouter — единая точка к десяткам моделей с одним
// ключом и одним форматом запроса (совместимым с OpenAI Chat Completions),
// поэтому модель можно поменять строкой в настройках, не трогая код.
//
// Ключ живёт ТОЛЬКО на сервере: любой вызов отсюда идёт из маршрутов и
// фоновых тактов, в браузер он не попадает никогда.
//
// Без ключа модуль просто ничего не делает и говорит об этом честно —
// подставлять заранее заготовленные фразы нельзя: набор из двадцати реплик
// выдаёт бота с третьего сообщения вернее, чем молчание.

import { takeAiCall } from "@/lib/game/aiBudget";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

/** Модель по умолчанию: дешёвая и быстрая, для коротких реплик в чате. */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

/**
 * Ключевое слово в OPENROUTER_MODEL: вместо одной модели или явного списка
 * подставляется весь пул БЕСПЛАТНЫХ моделей OpenRouter — их у провайдера
 * десятки, и вручную перечислять их строкой не нужно.
 */
const FREE_KEYWORD = "free";

/**
 * Запасные модели: если основная перегружена или недоступна у провайдера
 * (у OpenRouter это обычное дело — конкретная модель у конкретного апстрима
 * может лежать, пока остальные работают), бот не должен просто замолчать.
 * Список того же семейства «дёшево и быстро», чтобы не взвинтить счёт при
 * переключении. Используется, когда список бесплатных моделей недоступен и
 * ничего конкретного не задано в окружении.
 */
export const FALLBACK_MODELS = ["openai/gpt-4o-mini", "anthropic/claude-3-5-haiku", "google/gemini-2.0-flash-001"];

/**
 * На случай, если сам список моделей OpenRouter (`/models`) недоступен —
 * не роняем режим "free" вовсе, а перебираем известные на момент написания
 * бесплатные модели. Список освежается живым запросом при первой же
 * возможности (см. `freeModelsCache`), это только аварийный резерв.
 */
const KNOWN_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "deepseek/deepseek-chat:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-7b-instruct:free",
];

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export function openRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

interface FreeModelsCache {
  ids: string[];
  fetchedAt: number;
}

let freeModelsCache: FreeModelsCache | null = null;
// Раз в 30 минут: список у провайдера почти не меняется в течение дня, а
// перечитывать его на КАЖДЫЙ такт бота — это лишний запрос ради того, что
// вряд ли изменилось за последние 15 секунд.
const FREE_MODELS_TTL_MS = 30 * 60 * 1000;

/** Живой список бесплатных моделей OpenRouter, с кэшем и аварийным резервом. */
async function fetchFreeModels(): Promise<string[]> {
  if (freeModelsCache && Date.now() - freeModelsCache.fetchedAt < FREE_MODELS_TTL_MS) {
    return freeModelsCache.ids;
  }
  try {
    const res = await fetch(MODELS_ENDPOINT, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { data?: { id: string; pricing?: { prompt?: string } }[] };
    // Модель бесплатна, если у неё нулевая цена ЛИБО суффикс ":free" в id —
    // OpenRouter использует оба признака в разных семействах моделей.
    const ids = (data.data ?? [])
      .filter((m) => m.id.endsWith(":free") || m.pricing?.prompt === "0")
      .map((m) => m.id);
    if (ids.length > 0) {
      freeModelsCache = { ids, fetchedAt: Date.now() };
      return ids;
    }
  } catch {
    // Провайдер недоступен или ответил не тем, что ожидали — ниже подставим
    // аварийный список, не роняя реплику бота из-за этого одного запроса.
  }
  return freeModelsCache?.ids ?? KNOWN_FREE_MODELS;
}

/**
 * Модели, которые нужно перебрать по порядку: сперва явно переданная в
 * options, затем то, что настроено в OPENROUTER_MODEL (список через запятую,
 * либо ключевое слово "free" — тогда сюда подставляется весь пул бесплатных
 * моделей), и в конце — FALLBACK_MODELS. Так у любого запроса всегда есть
 * куда переключиться, даже если основная модель занята у апстрима.
 */
async function modelChain(preferred?: string): Promise<string[]> {
  const fromEnv = (process.env.OPENROUTER_MODEL ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);

  const expanded: string[] = [];
  for (const entry of fromEnv) {
    if (entry.toLowerCase() === FREE_KEYWORD) {
      expanded.push(...(await fetchFreeModels()));
    } else {
      expanded.push(entry);
    }
  }

  const ordered = [preferred, ...expanded, ...FALLBACK_MODELS].filter((m): m is string => !!m);
  return Array.from(new Set(ordered));
}

/**
 * Один запрос к модели, с переключением на запасную при отказе. Возвращает
 * текст или null, если не сложилось ни с одной.
 *
 * Никогда не бросает: реплика бота — не то, ради чего стоит ронять запрос
 * игрока. Не ответила ни одна модель — бот промолчал, и это выглядит
 * естественнее любой ошибки.
 */
export async function askModel(
  messages: ChatTurn[],
  options: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  // Предохранитель по расходу. Один общий счётчик на все обращения: и такт
  // ботов, и ответы на вопросы идут через эту функцию, а платит за них всех
  // один счёт. Считаем ПОПЫТКУ бота получить ответ, а не запрос к
  // конкретному апстриму — иначе перебор запасных моделей тратил бы бюджет
  // в несколько раз быстрее одной и той же реплики.
  if (!takeAiCall()) return null;

  for (const model of await modelChain(options.model)) {
    const result = await requestOnce(model, messages, options, key);
    if (result.text !== null) return result.text;
    // Ключ не принят вообще — переключение модели это не починит, все
    // остальные попытки закончатся тем же отказом.
    if (result.fatal) return null;
  }
  return null;
}

async function requestOnce(
  model: string,
  messages: ChatTurn[],
  options: { maxTokens?: number; temperature?: number; timeoutMs?: number },
  key: string,
): Promise<{ text: string | null; fatal: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // OpenRouter просит их для статистики и лимитов; не обязательны, но
        // без них запросы идут «анонимно» и лимиты жёстче.
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://tradestats.local",
        "X-Title": "TradeStats Game",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens ?? 120,
        temperature: options.temperature ?? 0.9,
      }),
    });
    if (!res.ok) {
      // 401/403 — ключ не принят вообще, и это не чинится сменой модели.
      // Всё остальное (404 — этой модели нет у апстрима, 429 — занята,
      // 5xx — авария у провайдера) — сигнал перейти к следующей в цепочке.
      return { text: null, fatal: res.status === 401 || res.status === 403 };
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return { text: text && text.length > 0 ? text : null, fatal: false };
  } catch {
    return { text: null, fatal: false };
  } finally {
    clearTimeout(timer);
  }
}
