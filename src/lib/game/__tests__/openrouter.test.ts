import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resetAiBudget } from "@/lib/game/aiBudget";

// Раньше бот использовал ровно одну модель из OPENROUTER_MODEL: если у
// провайдера именно она перегружена, бот просто молчал, хотя десятки других
// моделей у OpenRouter работали. Здесь проверяется переключение на запасные
// модели и режим "free" — весь пул бесплатных моделей одним словом в env,
// без перечисления вручную.

const ORIGINAL_ENV = { ...process.env };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function loadOpenrouter() {
  vi.resetModules();
  return import("@/lib/game/openrouter");
}

describe("askModel — переключение моделей", () => {
  beforeEach(() => {
    resetAiBudget();
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.OPENROUTER_MODEL;
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("без ключа не делает ни одного запроса", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("первая модель ответила — вторая не запрашивается", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("основная модель недоступна (429) — переключается на запасную", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "rate limited" }, 429))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "запасная ответила" } }] }));
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }], { model: "some/busy-model" });
    expect(text).toBe("запасная ответила");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(firstBody.model).toBe("some/busy-model");
  });

  it("ключ не принят (401) — не перебирает остальные модели", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "invalid key" }, 401));
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ни одна модель не ответила — молчит, а не бросает", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse({ error: "down" }, 503));
    const { askModel } = await loadOpenrouter();
    await expect(askModel([{ role: "user", content: "привет" }])).resolves.toBeNull();
  });

  it('OPENROUTER_MODEL="free" разворачивается в список бесплатных моделей провайдера', async () => {
    process.env.OPENROUTER_MODEL = "free";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    // Первый вызов — справочник моделей OpenRouter, второй — сам чат.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0" } },
            { id: "openai/gpt-4o-mini", pricing: { prompt: "0.00015" } },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "бесплатно ответила" } }] }));
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBe("бесплатно ответила");
    const chatBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    // Именно бесплатная модель из справочника, а не платная и не дефолтная.
    expect(chatBody.model).toBe("meta-llama/llama-3.3-70b-instruct:free");
  });

  it("справочник моделей недоступен — режим free падает на аварийный список, а не молчит", async () => {
    process.env.OPENROUTER_MODEL = "free";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "из резерва" } }] }));
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBe("из резерва");
  });

  it("бюджет исчерпан — ни одна модель не запрашивается", async () => {
    const { askModel } = await loadOpenrouter();
    // Исчерпываем общий счётчик модуля aiBudget — тот же, что и askModel
    // проверяет изнутри.
    const { takeAiCall, AI_CALLS_PER_HOUR } = await import("@/lib/game/aiBudget");
    for (let i = 0; i < AI_CALLS_PER_HOUR; i++) takeAiCall();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const text = await askModel([{ role: "user", content: "привет" }]);
    expect(text).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("просит у OpenRouter не включать рассуждения в ответ", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: "ок" } }] }));
    const { askModel } = await loadOpenrouter();
    await askModel([{ role: "user", content: "привет" }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reasoning).toEqual({ exclude: true });
  });

  it("не отдаёт наружу вступление рассуждающей модели, если оно всё же просочилось", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: "Here's a thinking process:" } }] }),
    );
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "что делать с BTC?" }]);
    // Обрезанный на середине размышления ответ — это отказ, а не текст для
    // публикации: пусто, но не голая преамбула.
    expect(text).toBeNull();
  });

  it("вытаскивает реальный ответ, если он идёт отдельным абзацем после рассуждения", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: "Here's a thinking process:\n1. цена растёт\n2. объём подтверждает\n\nБеру лонг по BTC.",
            },
          },
        ],
      }),
    );
    const { askModel } = await loadOpenrouter();
    const text = await askModel([{ role: "user", content: "что делать с BTC?" }]);
    expect(text).toBe("Беру лонг по BTC.");
  });
});

describe("stripReasoningArtifacts", () => {
  it("не трогает обычный ответ без служебной преамбулы", async () => {
    const { stripReasoningArtifacts } = await loadOpenrouter();
    expect(stripReasoningArtifacts("Беру лонг по BTC.")).toBe("Беру лонг по BTC.");
  });

  it("превращает голую преамбулу без ответа в пустую строку", async () => {
    const { stripReasoningArtifacts } = await loadOpenrouter();
    expect(stripReasoningArtifacts("Here's a thinking process:")).toBe("");
    expect(stripReasoningArtifacts("<think>рассуждаю о рынке")).toBe("");
  });

  it("оставляет последний абзац, если он идёт после преамбулы", async () => {
    const { stripReasoningArtifacts } = await loadOpenrouter();
    expect(stripReasoningArtifacts("Let me think about this.\n\nЖду коррекции.")).toBe("Жду коррекции.");
  });
});
