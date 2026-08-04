import { describe, it, expect } from "vitest";
import { detectImageType, isAllowedImageType, extForMime, MAX_IMAGE_BYTES } from "@/lib/imageValidation";

describe("detectImageType", () => {
  it("detects PNG by magic bytes", () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(8),
    ]);
    expect(detectImageType(buf)).toBe("image/png");
  });

  it("detects JPEG by magic bytes", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(12)]);
    expect(detectImageType(buf)).toBe("image/jpeg");
  });

  it("detects GIF87a and GIF89a", () => {
    const buf87 = Buffer.concat([Buffer.from("GIF87a", "ascii"), Buffer.alloc(10)]);
    const buf89 = Buffer.concat([Buffer.from("GIF89a", "ascii"), Buffer.alloc(10)]);
    expect(detectImageType(buf87)).toBe("image/gif");
    expect(detectImageType(buf89)).toBe("image/gif");
  });

  it("detects WEBP by RIFF/WEBP markers", () => {
    const buf = Buffer.alloc(16);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    expect(detectImageType(buf)).toBe("image/webp");
  });

  it("returns null for too-short buffer", () => {
    expect(detectImageType(Buffer.alloc(5))).toBeNull();
  });

  it("returns null for unrecognized content (e.g. html masquerading as image)", () => {
    const buf = Buffer.alloc(20);
    buf.write("<html><script>", 0, "ascii");
    expect(detectImageType(buf)).toBeNull();
  });
});

describe("isAllowedImageType", () => {
  it("allows known raster mimetypes", () => {
    expect(isAllowedImageType("image/png")).toBe(true);
    expect(isAllowedImageType("image/jpeg")).toBe(true);
    expect(isAllowedImageType("image/webp")).toBe(true);
    expect(isAllowedImageType("image/gif")).toBe(true);
  });

  it("rejects other mimetypes", () => {
    expect(isAllowedImageType("image/svg+xml")).toBe(false);
    expect(isAllowedImageType("text/html")).toBe(false);
  });
});

describe("extForMime", () => {
  it("maps mimetypes to extensions", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/webp")).toBe("webp");
    expect(extForMime("image/gif")).toBe("gif");
  });

  it("falls back to bin for unknown mimetype", () => {
    expect(extForMime("application/octet-stream")).toBe("bin");
  });
});

describe("MAX_IMAGE_BYTES", () => {
  it("is 10 MiB", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });
});
