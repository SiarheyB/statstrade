import { describe, it, expect } from "vitest";
import { redactDetails, redactSecretsInText, REDACTED } from "../logSanitize";

describe("redactSecretsInText", () => {
  it("маскирует секрет в паре имя=значение", () => {
    const out = redactSecretsInText("GET /api?apiKey=AKIA1234567890&symbol=BTCUSDT");
    expect(out).not.toContain("AKIA1234567890");
    expect(out).toContain(REDACTED);
    // Полезная часть запроса остаётся — иначе лог не разобрать.
    expect(out).toContain("symbol=BTCUSDT");
  });

  it("маскирует подпись и секрет в JSON-подобном тексте", () => {
    const out = redactSecretsInText('{"secret": "s3cr3tvalue", "side": "buy"}');
    expect(out).not.toContain("s3cr3tvalue");
    expect(out).toContain('"side": "buy"');
  });

  it("маскирует Bearer-токен, сохраняя схему", () => {
    const out = redactSecretsInText("Authorization: Bearer eyJhbGciOi.payload.sig");
    expect(out).not.toContain("eyJhbGciOi.payload.sig");
    expect(out).toContain("Bearer [redacted]");
  });

  it("маскирует пароль в строке подключения", () => {
    const out = redactSecretsInText("connect postgres://app:hunter2@db:5432/ts failed");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("postgres://app:[redacted]@db:5432/ts");
  });

  it("не трогает обычные id и символы", () => {
    const text = "batch 4f1a9c2e-0b3d-4a77-9f21-6c8e2d5b7a10 symbol XAUUSD lots 0.01";
    expect(redactSecretsInText(text)).toBe(text);
  });
});

describe("redactDetails", () => {
  it("режет поле по имени, каким бы ни было значение", () => {
    const out = redactDetails({ apiKey: "abc", api_secret: "d", passphrase: 1234, lots: 0.01 });
    expect(out).toEqual({ apiKey: REDACTED, api_secret: REDACTED, passphrase: REDACTED, lots: 0.01 });
  });

  it("ходит по вложенным объектам и массивам", () => {
    const out = redactDetails({ account: { name: "main", secret: "x" }, rows: [{ token: "t" }] }) as {
      account: { name: string; secret: string };
      rows: { token: string }[];
    };
    expect(out.account).toEqual({ name: "main", secret: REDACTED });
    expect(out.rows[0].token).toBe(REDACTED);
  });

  it("разворачивает Error, иначе в JSON уехало бы пустое {}", () => {
    const err = new Error("auth failed for apiKey=SECRETKEY123");
    const out = redactDetails({ error: err }) as { error: { message: string; name: string } };
    // Поле зовётся error, а не token — должно пережить скрининг по имени.
    expect(out.error.name).toBe("Error");
    expect(out.error.message).not.toContain("SECRETKEY123");
  });

  it("не падает на циклической ссылке", () => {
    const a: Record<string, unknown> = { lots: 1 };
    a.self = a;
    expect(() => redactDetails(a)).not.toThrow();
    expect((redactDetails(a) as { self: string }).self).toBe("[circular]");
  });
});
