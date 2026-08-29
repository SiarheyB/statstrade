import { describe, it, expect, beforeEach } from "vitest";
import {
  generateSecret, totp, verifyTotp, otpauthURL,
  totpCounter, consumeTotp, resetTotpReplayGuard,
} from "@/lib/totp";

const SECRET = generateSecret();

describe("totp", () => {
  it("generateSecret returns a valid base32 string", () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/);
    expect(s.length).toBe(32); // 20 bytes → 32 base32 chars
  });

  it("totp returns a 6-digit code deterministic by time", () => {
    const t = 1_700_000_000_000;
    const a = totp(SECRET, t);
    const b = totp(SECRET, t);
    expect(a).toMatch(/^\d{6}$/);
    expect(a).toBe(b);
  });

  it("verifyTotp accepts the correct code", () => {
    const t = 1_700_000_000_000;
    const code = totp(SECRET, t);
    expect(verifyTotp(code, SECRET, 1, t)).toBe(true);
  });

  it("verifyTotp rejects a wrong code", () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp("000000", SECRET, 1, t)).toBe(false);
  });

  it("verifyTotp rejects non-6-digit input", () => {
    expect(verifyTotp("12345", SECRET)).toBe(false);
    expect(verifyTotp("1234567", SECRET)).toBe(false);
    expect(verifyTotp("abcdef", SECRET)).toBe(false);
  });

  it("verifyTotp tolerates a ±1 step clock skew with window=1", () => {
    const t0 = 1_700_000_000_000;
    const code = totp(SECRET, t0);
    // One step later, window=1 should still accept it.
    expect(verifyTotp(code, SECRET, 1, t0 + 30_000)).toBe(true);
    // ...but window=0 rejects the skewed code.
    expect(verifyTotp(code, SECRET, 0, t0 + 30_000)).toBe(false);
  });

  it("otpauthURL builds a valid otpauth URI", () => {
    const url = otpauthURL(SECRET, "me@x.com");
    expect(url.startsWith("otpauth://totp/")).toBe(true);
    expect(url).toContain(`secret=${SECRET}`);
    expect(url).toContain("issuer=TradeStats");
    expect(decodeURIComponent(url)).toContain("TradeStats:me@x.com");
  });
});

describe("totpCounter", () => {
  it("возвращает шаг, на котором код сошёлся", () => {
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    const step = Math.floor(t / 1000 / 30);
    expect(totpCounter(totp(secret, t), secret, 1, t)).toBe(step);
    // Код соседнего шага принимается допуском на расхождение часов —
    // и опознаётся именно как соседний.
    expect(totpCounter(totp(secret, t - 30_000), secret, 1, t)).toBe(step - 1);
  });

  it("на неверном коде возвращает null", () => {
    const secret = generateSecret();
    expect(totpCounter("000000", secret, 1, 1_800_000_000_000)).toBeNull();
    expect(totpCounter("abc", secret)).toBeNull();
  });
});

describe("consumeTotp — защита от повтора", () => {
  beforeEach(() => resetTotpReplayGuard());

  // Код живёт 30 секунд, а с допуском ±1 шаг принимается около полутора минут.
  // Всё это время подсмотренный или перехваченный код проходил повторно.
  it("тот же код второй раз не проходит", () => {
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    const code = totp(secret, t);
    expect(consumeTotp("u1", code, secret, 1, t)).toBe(true);
    expect(consumeTotp("u1", code, secret, 1, t)).toBe(false);
    // И чуть позже, пока код ещё в окне допуска, — тоже нет.
    expect(consumeTotp("u1", code, secret, 1, t + 20_000)).toBe(false);
  });

  it("код ПРЕДЫДУЩЕГО шага не проходит после нового", () => {
    // Иначе перехваченный код соседнего шага оставался бы годным.
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    expect(consumeTotp("u1", totp(secret, t), secret, 1, t)).toBe(true);
    expect(consumeTotp("u1", totp(secret, t - 30_000), secret, 1, t)).toBe(false);
  });

  it("следующий код проходит", () => {
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    expect(consumeTotp("u1", totp(secret, t), secret, 1, t)).toBe(true);
    const next = t + 30_000;
    expect(consumeTotp("u1", totp(secret, next), secret, 1, next)).toBe(true);
  });

  it("гашение раздельное по пользователям", () => {
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    const code = totp(secret, t);
    expect(consumeTotp("u1", code, secret, 1, t)).toBe(true);
    // У второго пользователя свой секрет и свой счётчик — чужое гашение
    // не должно его задевать.
    expect(consumeTotp("u2", code, secret, 1, t)).toBe(true);
  });

  it("неверный код ничего не гасит", () => {
    const secret = generateSecret();
    const t = 1_800_000_000_000;
    expect(consumeTotp("u1", "000000", secret, 1, t)).toBe(false);
    expect(consumeTotp("u1", totp(secret, t), secret, 1, t)).toBe(true);
  });
});
