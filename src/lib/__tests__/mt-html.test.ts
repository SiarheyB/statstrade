import { describe, it, expect } from "vitest";
import { tableRows } from "@/lib/mt/html";

describe("tableRows", () => {
  it("flattens every tr into trimmed cell-text arrays and decodes nbsp", () => {
    const html = `<table><tr><td>EUR&nbsp;USD</td><th>Price</th></tr><tr><td>1.10</td><td> 2 </td></tr></table>`;
    expect(tableRows(html)).toEqual([
      ["EUR USD", "Price"],
      ["1.10", "2"],
    ]);
  });

  it("skips rows that contain no cells", () => {
    const html = `<table><tr></tr><tr><td>x</td></tr></table>`;
    expect(tableRows(html)).toEqual([["x"]]);
  });

  it("returns an empty array when there is no table", () => {
    expect(tableRows("<p>nothing</p>")).toEqual([]);
  });
});
