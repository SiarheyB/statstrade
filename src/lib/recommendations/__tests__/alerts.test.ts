import { describe, it, expect } from "vitest";
import {
  DEFAULT_THRESHOLD_ATR,
  MAX_THRESHOLD_ATR,
  MIN_THRESHOLD_ATR,
  REARM_FACTOR,
  alertText,
  clampThreshold,
  decide,
  distanceInAtr,
  formatPrice,
} from "@/lib/recommendations/alerts";

describe("порог уведомления по уровню", () => {
  it("держит порог в допустимых границах", () => {
    expect(clampThreshold(0.25)).toBe(0.25);
    expect(clampThreshold(0)).toBe(MIN_THRESHOLD_ATR);
    expect(clampThreshold(99)).toBe(MAX_THRESHOLD_ATR);
  });

  it("битое число превращает в значение по умолчанию, а не в ноль", () => {
    // Ноль означал бы «срабатывать при точном совпадении цены с уровнем», то
    // есть практически никогда, — и человек не понял бы, почему молчит.
    expect(clampThreshold(Number.NaN)).toBe(DEFAULT_THRESHOLD_ATR);
  });
});

describe("расстояние до уровня", () => {
  it("меряет в долях ATR и не зависит от стороны подхода", () => {
    expect(distanceInAtr(105, 100, 20)).toBeCloseTo(0.25);
    expect(distanceInAtr(95, 100, 20)).toBeCloseTo(0.25);
  });

  it("нулевой ATR не превращается в деление на ноль", () => {
    // Подписка с битым ATR должна просто никогда не срабатывать, а не
    // срабатывать на каждом проходе крона.
    expect(distanceInAtr(100, 100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(decide({ price: 100, levelPrice: 100, atr: 0, thresholdAtr: 0.25, triggered: false })).toBe("none");
  });
});

describe("решение о срабатывании", () => {
  const base = { levelPrice: 100, atr: 20, thresholdAtr: 0.25, triggered: false };

  it("срабатывает, когда цена вошла в зону уровня", () => {
    expect(decide({ ...base, price: 104 })).toBe("fire");
    expect(decide({ ...base, price: 96 })).toBe("fire");
  });

  it("молчит, пока цена далеко", () => {
    expect(decide({ ...base, price: 110 })).toBe("none");
  });

  it("срабатывает ровно на границе порога", () => {
    // 0.25 × ATR 20 = 5 по цене: 105 — это уже «подошли».
    expect(decide({ ...base, price: 105 })).toBe("fire");
    expect(decide({ ...base, price: 105.01 })).toBe("none");
  });

  it("не шлёт второе уведомление, пока цена держится у уровня", () => {
    expect(decide({ ...base, price: 101, triggered: true })).toBe("none");
  });

  it("заряжается заново, только когда цена ушла заметно дальше порога", () => {
    // Запас (REARM_FACTOR) нужен, чтобы дрожание цены ровно на границе не
    // превращалось в поток уведомлений.
    const justOutside = 100 + base.thresholdAtr * base.atr * REARM_FACTOR;
    expect(decide({ ...base, price: justOutside, triggered: true })).toBe("none");
    expect(decide({ ...base, price: justOutside + 0.1, triggered: true })).toBe("rearm");
  });

  describe("пробойный бар между двумя проходами крона", () => {
    // Порог узкий (0.05×ATR = 1 по цене — зона 99..101), а крон проверяет
    // раз в минуту: пробойная свеча может пройти всю зону быстрее, и цена
    // окажется далеко от уровня И до, И после проверки. Без prevPrice такое
    // срабатывание терялось бы полностью.
    const tight = { levelPrice: 100, atr: 20, thresholdAtr: 0.05, triggered: false };

    it("срабатывает, если уровень остался между прошлой и текущей ценой", () => {
      expect(decide({ ...tight, price: 130, prevPrice: 70 })).toBe("fire");
      expect(decide({ ...tight, price: 70, prevPrice: 130 })).toBe("fire");
    });

    it("не срабатывает, если обе цены остались по одну сторону от уровня", () => {
      expect(decide({ ...tight, price: 130, prevPrice: 110 })).toBe("none");
    });

    it("не срабатывает без прошлой цены (первый проход крона для подписки)", () => {
      expect(decide({ ...tight, price: 130, prevPrice: null })).toBe("none");
      expect(decide({ ...tight, price: 130 })).toBe("none");
    });
  });
});

describe("текст уведомления", () => {
  it("говорит, с какой стороны подходим, и называет сторону сетапа", () => {
    const up = alertText({ symbol: "BTCUSDT", price: 105, levelPrice: 100, direction: "short" });
    expect(up.title).toContain("BTCUSDT");
    expect(up.body).toContain("сверху");
    expect(up.body).toContain("шорт");

    const down = alertText({ symbol: "BTCUSDT", price: 95, levelPrice: 100, direction: "long" });
    expect(down.body).toContain("снизу");
    expect(down.body).toContain("лонг");
  });

  it("не округляет копеечные монеты в ноль", () => {
    // Округление до двух знаков превратило бы и цену, и уровень в «0.00», и
    // уведомление перестало бы что-либо значить.
    expect(formatPrice(0.00004321, 0.00004)).toBe("0.00004321");
    expect(formatPrice(12345.6789, 12345.67)).toBe("12345.68");
  });
});
