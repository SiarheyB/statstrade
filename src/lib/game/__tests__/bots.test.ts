import { describe, it, expect } from "vitest";
import { BOT_PERSONAS, BOT_CHAT_CHANCE, BOT_TICK_MS, equityStep } from "@/lib/game/bots";

describe("характеры ботов", () => {
  it("у всех уникальные идентификаторы и имена", () => {
    const ids = BOT_PERSONAS.map((p) => p.id);
    const names = BOT_PERSONAS.map((p) => p.nickname);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("характеры разные: и по риску, и по мастерству, и по стилю", () => {
    // Шесть одинаковых ботов — это один бот в шести окнах: их узнают сразу.
    expect(new Set(BOT_PERSONAS.map((p) => p.style)).size).toBeGreaterThan(1);
    expect(new Set(BOT_PERSONAS.map((p) => p.risk)).size).toBeGreaterThan(3);
    expect(new Set(BOT_PERSONAS.map((p) => p.skill)).size).toBeGreaterThan(3);
  });

  it("есть и сильные, и слабые: мир не из одних победителей", () => {
    expect(Math.min(...BOT_PERSONAS.map((p) => p.skill))).toBeLessThan(0.5);
    expect(Math.max(...BOT_PERSONAS.map((p) => p.skill))).toBeGreaterThan(0.6);
  });

  it("у каждого описана манера речи — из неё модель и лепит характер", () => {
    for (const persona of BOT_PERSONAS) {
      expect(persona.voice.length).toBeGreaterThan(40);
    }
  });
});

describe("движение счёта бота", () => {
  const strong = BOT_PERSONAS.reduce((a, b) => (a.skill > b.skill ? a : b));
  const weak = BOT_PERSONAS.reduce((a, b) => (a.skill < b.skill ? a : b));

  it("счёт идёт ОТ РЫНКА: на неподвижном рынке он не двигается", () => {
    // Нарисованные случайные числа выдали бы ботов сразу же, стоило сравнить
    // их результат с графиком.
    expect(equityStep(0, strong, 0.1)).toBe(0);
  });

  it("мастер чаще берёт движение в свою сторону, чем новичок", () => {
    // luck ниже skill — угадал; выше — ошибся.
    expect(equityStep(2, strong, 0.5)).toBeGreaterThan(0);
    expect(equityStep(2, weak, 0.5)).toBeLessThan(0);
  });

  it("рискованный ходит сильнее осторожного на том же движении", () => {
    const bold = BOT_PERSONAS.reduce((a, b) => (a.risk > b.risk ? a : b));
    const calm = BOT_PERSONAS.reduce((a, b) => (a.risk < b.risk ? a : b));
    expect(Math.abs(equityStep(2, bold, 0))).toBeGreaterThan(Math.abs(equityStep(2, calm, 0)));
  });

  it("за один такт счёт меняется на доли процента, а не удваивается", () => {
    // Такт — пять минут: за них счёт не может прыгнуть на десятки процентов.
    for (const persona of BOT_PERSONAS) {
      expect(Math.abs(equityStep(5, persona, 0))).toBeLessThan(0.1);
    }
  });
});

describe("такт", () => {
  it("не чаще разумного и говорят они не каждый раз", () => {
    // Бот, пишущий на каждом такте, — это лента спама, а не участник.
    expect(BOT_TICK_MS).toBeGreaterThanOrEqual(60_000);
    expect(BOT_CHAT_CHANCE).toBeGreaterThan(0);
    expect(BOT_CHAT_CHANCE).toBeLessThan(0.5);
  });
});

describe("правила речи", () => {
  it("шанс заговорить оставляет большинство тактов молчаливыми", () => {
    // Бот, пишущий на каждом такте, — это лента спама, а не участник чата.
    expect(BOT_CHAT_CHANCE).toBeLessThanOrEqual(0.3);
  });
});
