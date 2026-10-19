// Скрининг секретов перед записью в логи.
//
// Зачем: `ImportLog.details` — свободная JSON-колонка, а `ErrorLog.message` —
// текст пойманного исключения. Достаточно один раз залогировать объект
// аккаунта целиком или пробросить ошибку ccxt (она охотно печатает URL
// запроса с подписью и ключом в query), чтобы ключ биржи лёг в базу
// открытым текстом и показался в админке. Логи админка показывает, а
// шифрования у этих колонок нет — в отличие от самих ключей
// (lib/crypto.ts).
//
// Поэтому чистим ЦЕНТРАЛЬНО, в точке записи (lib/log.service.ts и
// lib/errorLog.ts), а не в вызовах: вызовов десятки, и помнить про скрининг
// в каждом новом — заведомо проигрышная ставка.

/** Имена полей, значения которых в лог не попадают НИКОГДА. */
const SECRET_KEY_RE =
  /(api[-_]?key|secret|passphrase|password|token|signature|credential|cookie|authorization|auth[-_]?header|private[-_]?key|vapid|encryption[-_]?key|jwt)/i;

export const REDACTED = "[redacted]";

// Секрет в свободном тексте: `key=abc`, `"secret": "abc"`, `Bearer abc`,
// `?signature=abc&`. Длинные «похожие на ключ» строки без имени поля НЕ
// трогаем: под эту мерку попадают id сделок, батчи импорта и хэши свечей,
// а лог без них бесполезен для разбора.
const PAIR_RE = new RegExp(
  // 1: имя поля, 2: разделитель с кавычками, 3: значение
  String.raw`([A-Za-z_-]*(?:api[-_]?key|secret|passphrase|password|token|signature|credential|authorization)[A-Za-z_-]*)` +
    // Закрывающая кавычка ИМЕНИ ключа тоже возможна: `"secret": "..."`.
    String.raw`("?\s*[:=]\s*"?)` +
    String.raw`([^"'\s,&}\]]{4,})`,
  "gi",
);
const BEARER_RE = /\b(Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{8,})/gi;
// Пароль внутри строки подключения: postgres://user:pass@host.
const URL_CREDS_RE = /(\w+:\/\/[^/\s:@]+:)([^@\s]+)(@)/g;

/** Замаскировать секреты в свободном тексте (message, stack). */
export function redactSecretsInText(text: string): string {
  return text
    // Bearer — ПЕРВЫМ: в `Authorization: Bearer xyz` пара «имя=значение»
    // видит значением слово Bearer и, сработав раньше, съела бы якорь, по
    // которому ищется сам токен.
    .replace(BEARER_RE, (_m, scheme) => `${scheme} ${REDACTED}`)
    .replace(PAIR_RE, (m, name, sep, val) =>
      // Значение — уже маска или только схема (`Authorization: Bearer`):
      // маскировать нечего, второй `[redacted]` подряд только мусорит.
      /^(Bearer|Basic|\[redacted\])$/i.test(val) ? m : `${name}${sep}${REDACTED}`,
    )
    .replace(URL_CREDS_RE, (_m, head, _pass, tail) => `${head}${REDACTED}${tail}`);
}

const MAX_DEPTH = 6;

/**
 * Рекурсивно вычистить секреты из полезной нагрузки лога.
 *
 * Поле с «секретным» именем режется по имени, независимо от значения; всё
 * остальное проходит текстовый скрининг. Глубина ограничена, циклы
 * отслеживаются: лог не должен уметь уронить запрос.
 */
export function redactDetails<T>(value: T, depth = 0, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return redactSecretsInText(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[depth limit]" as unknown as T;
  if (seen.has(value as object)) return "[circular]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactDetails(v, depth + 1, seen)) as unknown as T;
  }
  // Error в JSON-колонку уезжает как {} — разворачиваем руками, иначе
  // причина ошибки теряется совсем.
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSecretsInText(value.message),
      stack: value.stack ? redactSecretsInText(value.stack) : undefined,
    } as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? REDACTED : redactDetails(v, depth + 1, seen);
  }
  return out as unknown as T;
}
