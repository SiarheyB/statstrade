import { describe, it, expect } from "vitest";
import { pickLatest, compareVersions } from "@/lib/perimetrFiles";

const FILES = [
  "Perimetr-1.4.1-windows.exe", "Perimetr-1.4.2-windows.exe", "Perimetr-1.4.10-windows.exe",
  "Perimetr-1.4.10-windows.zip", "Perimetr-1.4.2-arm64.dmg", "Perimetr-1.4.2-android.apk",
  "Perimetr-latest-windows.exe", "latest.json",
];

describe("pickLatest", () => {
  it("сравнивает версии числами: 1.4.10 новее 1.4.2", () => {
    expect(pickLatest(FILES, "windows")).toEqual({ file: "Perimetr-1.4.10-windows.exe", version: "1.4.10" });
  });
  it("не путает платформы и игнорирует zip и симлинки latest", () => {
    expect(pickLatest(FILES, "mac")?.file).toBe("Perimetr-1.4.2-arm64.dmg");
    expect(pickLatest(FILES, "android")?.file).toBe("Perimetr-1.4.2-android.apk");
  });
  it("null, когда подходящих файлов нет", () => {
    expect(pickLatest(["Perimetr-latest-windows.exe"], "windows")).toBeNull();
  });
  it("compareVersions", () => {
    expect(compareVersions("1.4.10", "1.4.2")).toBeGreaterThan(0);
    expect(compareVersions("1.5", "1.5.0")).toBe(0);
  });
});
