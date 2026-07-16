import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// html-to-image / jspdf грузятся динамически внутри nodeToPng / nodeToPdf.
vi.mock("html-to-image", () => ({
  toPng: vi.fn().mockResolvedValue("data:image/png;base64,XXXX"),
}));
vi.mock("jspdf", () => ({
  jsPDF: class {
    internal = { pageSize: { getWidth: () => 200, getHeight: () => 100 } };
    getImageProperties() {
      return { width: 200, height: 400 };
    }
    addImage() {}
    addPage() {}
    save(_name: string) {}
  },
}));

import { downloadCsv, nodeToPng, nodeToPdf, dateStamp } from "@/lib/export";
import { toPng } from "html-to-image";

describe("export", () => {
  let anchors: HTMLAnchorElement[];
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    anchors = [];
    const orig = document.createElement.bind(document);
    createSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = orig(tag as "a");
      if (tag === "a") anchors.push(el as HTMLAnchorElement);
      return el;
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:fake"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    createSpy.mockRestore();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  describe("dateStamp", () => {
    it("returns a YYYY-MM-DD string", () => {
      expect(dateStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("downloadCsv", () => {
    it("builds a BOM-prefixed CSV with ; separator and escapes special chars", async () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");

      downloadCsv(
        "report.csv",
        ["symbol", "note"],
        [
          ["BTC/USDT", "ok"],
          ["ETH", 'he said "hi", then left\nnext'],
        ],
      );

      const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
      // BOM (EF BB BF) префикс для корректной кириллицы в Excel — blob.text()
      // отрезает сигнатуру, поэтому проверяем сырые байты.
      const buf = new Uint8Array(await blob.arrayBuffer());
      expect(Array.from(buf.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
      const text = await blob.text();
      expect(text.startsWith("symbol;note")).toBe(true);
      expect(text).toContain("BTC/USDT;ok");
      expect(text).toContain('"he said ""hi"", then left\nnext"');

      expect(anchors[0].download).toBe("report.csv");
      expect(clickSpy).toHaveBeenCalled();
      clickSpy.mockRestore();
    });
  });

  describe("nodeToPng", () => {
    it("captures the node and triggers a download with the filename", async () => {
      const node = document.createElement("div");
      await nodeToPng(node, "chart.png");

      expect(toPng).toHaveBeenCalledWith(node, {
        pixelRatio: 2,
        backgroundColor: "#0b0e13",
        cacheBust: true,
      });
      expect(anchors[0].download).toBe("chart.png");
    });
  });

  describe("nodeToPdf", () => {
    it("captures, paginates a tall image across pages and saves the pdf", async () => {
      const node = document.createElement("div");
      const { jsPDF } = await import("jspdf");
      const saveSpy = vi.spyOn(jsPDF.prototype, "save");
      const addPageSpy = vi.spyOn(jsPDF.prototype, "addPage");

      await nodeToPdf(node, "chart.pdf", "l");

      expect(toPng).toHaveBeenCalled();
      // imgH = (400*200)/200 = 400, pageH = 100 -> 4 addImage + 3 addPage
      expect(addPageSpy).toHaveBeenCalledTimes(3);
      expect(saveSpy).toHaveBeenCalledWith("chart.pdf");

      saveSpy.mockRestore();
      addPageSpy.mockRestore();
    });
  });
});
