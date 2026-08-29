import crypto from "node:crypto";

// RFC 6238 TOTP (SHA1, 6 digits, 30s step) — compatible with Google
// Authenticator, Authy, 1Password, etc. Implemented on node:crypto, no deps.

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

// Generate a new base32-encoded shared secret (default 160 bits).
export function generateSecret(bytes = 20): string {
  return base32Encode(crypto.randomBytes(bytes));
}

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const clean = str.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** DIGITS).toString().padStart(DIGITS, "0");
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Current TOTP code for a secret (mainly for tests).
export function totp(secretB32: string, time = Date.now()): string {
  return hotp(base32Decode(secretB32), Math.floor(time / 1000 / STEP_SECONDS));
}

/**
 * Шаг времени, на котором код сошёлся, или null.
 *
 * Нужен отдельно от verifyTotp: по нему отличается повторное предъявление того
 * же кода от нового (см. consumeTotp).
 */
export function totpCounter(
  token: string,
  secretB32: string,
  window = 1,
  time = Date.now(),
): number | null {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const counter = Math.floor(time / 1000 / STEP_SECONDS);
  const secret = base32Decode(secretB32);
  for (let w = -window; w <= window; w++) {
    if (timingSafeEqualStr(hotp(secret, counter + w), clean)) return counter + w;
  }
  return null;
}

// Verify a user-entered code, tolerating ±`window` steps of clock skew.
export function verifyTotp(
  token: string,
  secretB32: string,
  window = 1,
  time = Date.now(),
): boolean {
  return totpCounter(token, secretB32, window, time) !== null;
}

// ─── Защита от повторного предъявления ──────────────────────────────────────
//
// Код живёт 30 секунд, а с допуском на расхождение часов (±1 шаг) принимается
// в окне около полутора минут. Всё это время один и тот же код проходил
// повторно: подсмотренный через плечо или перехваченный на пути к серверу
// работал, пока окно не закроется.
//
// Помним последний ПРИНЯТЫЙ шаг на ключ и не пускаем его же и более ранние.
// В памяти, а не в БД: app — один долгоживущий контейнер (то же допущение, что
// у ratelimit.ts и statsCache.ts). Перезапуск сбрасывает защиту, но окно
// повтора — те же полторы минуты, и лишняя колонка в User этого не стоит.
const usedStep = new Map<string, { step: number; at: number }>();
const USED_TTL_MS = 5 * 60_000;
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < USED_TTL_MS) return;
  lastSweep = now;
  for (const [k, v] of usedStep) if (now - v.at >= USED_TTL_MS) usedStep.delete(k);
}

/** Только для тестов: забыть все принятые коды. */
export function resetTotpReplayGuard(): void {
  usedStep.clear();
  lastSweep = 0;
}

/**
 * Проверить код и «погасить» его: тот же код второй раз не пройдёт.
 * `key` — то, к чему привязан секрет (у нас id пользователя).
 */
export function consumeTotp(
  key: string,
  token: string,
  secretB32: string,
  window = 1,
  time = Date.now(),
): boolean {
  const step = totpCounter(token, secretB32, window, time);
  if (step === null) return false;
  sweep(time);
  const prev = usedStep.get(key);
  // Не только сам шаг, но и все более ранние: иначе код предыдущего шага,
  // ещё попадающий в окно допуска, оставался бы годным после нового.
  if (prev && step <= prev.step) return false;
  usedStep.set(key, { step, at: time });
  return true;
}

// otpauth:// URI for QR codes / manual entry into authenticator apps.
export function otpauthURL(
  secretB32: string,
  account: string,
  issuer = "TradeStats",
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
