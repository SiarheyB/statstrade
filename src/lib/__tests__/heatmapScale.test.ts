import { describe, it, expect } from "vitest";
import { heatmapScale, visibleScale } from "@/lib/heatmapScale";

/** Сетка из значений по колонкам: grid[col][bin]. */
function grid(cols: number[][]): number[][] {
  return cols;
}

describe("heatmapScale", () => {
  it("на однородных данных почти совпадает с максимумом — картинка не меняется", () => {
    const g = grid([[100, 100], [100, 100], [110, 100]]);
    expect(heatmapScale(g, 110)).toBeGreaterThanOrEqual(100);
    expect(heatmapScale(g, 110)).toBeLessThanOrEqual(110);
  });

  it("не даёт одной аномальной стене задавить остальную карту", () => {
    // Одна ячейка в 100 раз крупнее прочих: масштаб должен остаться у «прочих»,
    // иначе они все окажутся ниже порога видимости.
    const cols = Array.from({ length: 20 }, () => [50, 40]);
    cols[0] = [5000, 40];
    const scale = heatmapScale(grid(cols), 5000);
    expect(scale).toBeLessThan(500);
    expect(50 / scale).toBeGreaterThan(0.2); // обычная стена проходит порог 20%
  });

  it("пустые ячейки не участвуют — иначе перцентиль уползает в ноль", () => {
    const cols = Array.from({ length: 100 }, () => [0, 0]);
    cols[0] = [80, 100];
    cols[1] = [90, 0];
    expect(heatmapScale(grid(cols), 100)).toBeGreaterThan(0);
  });

  it("на пустой сетке возвращает максимум, а не ноль", () => {
    expect(heatmapScale(grid([[0, 0], [0, 0]]), 42)).toBe(42);
  });

  it("не уходит ниже 1/50 самой крупной ячейки", () => {
    // Почти всё — крохи, один настоящий пик: масштаб не должен стать
    // исчезающе малым, иначе карта превратится в сплошную засветку.
    const cols = Array.from({ length: 100 }, () => [0.001, 0.001]);
    cols[0] = [1000, 0.001];
    expect(heatmapScale(grid(cols), 1000)).toBeGreaterThanOrEqual(20);
  });
});

describe("visibleScale", () => {
  const src = (values: number[][], t0: number, stepMs: number) => ({
    grid: values,
    cols: values.length,
    times: values.map((_, i) => t0 + i * stepMs),
  });

  it("считает масштаб по видимому куску, а не по всей сетке", () => {
    // Слева крупные стены, справа мелкие. Смотрим вправо — масштаб должен быть
    // «правым», иначе мелкие стены не видно вовсе.
    const s = src([[1000], [900], [10], [12]], 0, 60_000);
    const right = visibleScale([s], 2 * 60_000, 3 * 60_000);
    expect(right).toBeLessThan(50);
    const left = visibleScale([s], 0, 60_000);
    expect(left).toBeGreaterThan(500);
  });

  it("складывает слои: живое окно и догруженную историю", () => {
    const live = src([[100], [120]], 10 * 60_000, 60_000);
    const history = src([[80], [90]], 0, 60_000);
    const scale = visibleScale([live, history], 0, 11 * 60_000);
    expect(scale).toBeGreaterThan(0);
    expect(scale).toBeLessThanOrEqual(120);
  });

  it("возвращает ноль, когда в видимом окне пусто — вызывающий возьмёт запасной масштаб", () => {
    const s = src([[0], [0]], 0, 60_000);
    expect(visibleScale([s], 0, 60_000)).toBe(0);
    expect(visibleScale([], 0, 60_000)).toBe(0);
  });

  it("окно за пределами данных не ломает расчёт", () => {
    const s = src([[100], [200]], 0, 60_000);
    expect(visibleScale([s], 10_000 * 60_000, 20_000 * 60_000)).toBe(0);
  });
});
