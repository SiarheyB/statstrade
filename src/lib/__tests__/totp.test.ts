import { describe, it, expect } from "vitest";
import { generateSecret, totp, verifyTotp, otpauthURL } from "@/lib/totp";

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
