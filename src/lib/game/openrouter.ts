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

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Модель по умолчанию: дешёвая и быстрая, для коротких реплик в чате. */
export const DEFAULT_MODEL = "openai/gpt-4o-mini";

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export function openRouterConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

/**
 * Один запрос к модели. Возвращает текст или null, если не сложилось.
 *
 * Никогда не бросает: реплика бота — не то, ради чего стоит ронять запрос
 * игрока. Не ответила модель — бот промолчал, и это выглядит естественнее
 * любой ошибки.
 */
export async function askModel(
  messages: ChatTurn[],
  options: { model?: string; maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;

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
        model: options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
        messages,
        max_tokens: options.maxTokens ?? 120,
        temperature: options.temperature ?? 0.9,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
