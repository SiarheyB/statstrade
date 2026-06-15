"use client";

import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";

const CAPTURE_BG = "#0b0e13";

// --- CSV ---

function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
): void {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(";"));
  // Prepend BOM so Excel reads UTF-8 (Cyrillic) correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  triggerDownload(URL.createObjectURL(blob), filename);
}

// --- Image / PDF (rasterized DOM — handles Cyrillic without font embedding) ---

async function capture(node: HTMLElement): Promise<string> {
  return toPng(node, {
    pixelRatio: 2,
    backgroundColor: CAPTURE_BG,
    cacheBust: true,
  });
}

export async function nodeToPng(
  node: HTMLElement,
  filename: string,
): Promise<void> {
  const dataUrl = await capture(node);
  triggerDownload(dataUrl, filename);
}

export async function nodeToPdf(
  node: HTMLElement,
  filename: string,
  orientation: "p" | "l" = "p",
): Promise<void> {
  const dataUrl = await capture(node);
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const props = pdf.getImageProperties(dataUrl);
  const imgW = pageW;
  const imgH = (props.height * pageW) / props.width;

  // Paginate a tall image across multiple pages.
  let heightLeft = imgH;
  let position = 0;
  pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
  heightLeft -= pageH;
  while (heightLeft > 0) {
    position -= pageH;
    pdf.addPage();
    pdf.addImage(dataUrl, "PNG", 0, position, imgW, imgH);
    heightLeft -= pageH;
  }
  pdf.save(filename);
}

function triggerDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
