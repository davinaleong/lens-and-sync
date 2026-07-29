import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import { extractText } from "../../src/extraction/index.js";

function fakeDrive(overrides: { export?: ReturnType<typeof vi.fn>; get?: ReturnType<typeof vi.fn> } = {}) {
  return {
    files: {
      export: overrides.export ?? vi.fn(),
      get: overrides.get ?? vi.fn(),
    },
  } as never;
}

describe("extractText - Google-native formats", () => {
  it("exports a Google Doc as text/plain and returns the trimmed text", async () => {
    const exportFn = vi.fn().mockResolvedValue({ data: "  Recipe: Mushroom Pasta\n\nIngredients...  " });
    const drive = fakeDrive({ export: exportFn });

    const result = await extractText(drive, { id: "doc-1", mimeType: "application/vnd.google-apps.document" });

    expect(result).toEqual({ ok: true, text: "Recipe: Mushroom Pasta\n\nIngredients..." });
    expect(exportFn).toHaveBeenCalledWith({ fileId: "doc-1", mimeType: "text/plain" }, { responseType: "text" });
  });

  it("exports a Google Slides deck as text/plain", async () => {
    const exportFn = vi.fn().mockResolvedValue({ data: "Slide 1\nSlide 2" });
    const drive = fakeDrive({ export: exportFn });

    const result = await extractText(drive, { id: "slides-1", mimeType: "application/vnd.google-apps.presentation" });

    expect(result).toEqual({ ok: true, text: "Slide 1\nSlide 2" });
  });

  it("exports a Google Sheet as CSV", async () => {
    const exportFn = vi.fn().mockResolvedValue({ data: "name,qty\nflour,200g" });
    const drive = fakeDrive({ export: exportFn });

    const result = await extractText(drive, { id: "sheet-1", mimeType: "application/vnd.google-apps.spreadsheet" });

    expect(result).toEqual({ ok: true, text: "name,qty\nflour,200g" });
    expect(exportFn).toHaveBeenCalledWith({ fileId: "sheet-1", mimeType: "text/csv" }, { responseType: "text" });
  });

  it("returns empty-content for a Doc that exports to whitespace only", async () => {
    const exportFn = vi.fn().mockResolvedValue({ data: "   \n  " });
    const drive = fakeDrive({ export: exportFn });

    const result = await extractText(drive, { id: "doc-empty", mimeType: "application/vnd.google-apps.document" });

    expect(result).toEqual({ ok: false, reason: "empty-content" });
  });
});

describe("extractText - plain text and unsupported types", () => {
  it("downloads and decodes a text/plain file", async () => {
    const getFn = vi.fn().mockResolvedValue({ data: Buffer.from("plain file contents") });
    const drive = fakeDrive({ get: getFn });

    const result = await extractText(drive, { id: "txt-1", mimeType: "text/plain" });

    expect(result).toEqual({ ok: true, text: "plain file contents" });
    expect(getFn).toHaveBeenCalledWith({ fileId: "txt-1", alt: "media" }, { responseType: "arraybuffer" });
  });

  it("rejects an unsupported mime type without calling the Drive API at all", async () => {
    const exportFn = vi.fn();
    const getFn = vi.fn();
    const drive = fakeDrive({ export: exportFn, get: getFn });

    const result = await extractText(drive, { id: "img-1", mimeType: "image/png" });

    expect(result).toEqual({ ok: false, reason: "unsupported-mime-type", mimeType: "image/png" });
    expect(exportFn).not.toHaveBeenCalled();
    expect(getFn).not.toHaveBeenCalled();
  });

  it("returns extraction-failed rather than throwing when the Drive API call rejects", async () => {
    const exportFn = vi.fn().mockRejectedValue(new Error("network error"));
    const drive = fakeDrive({ export: exportFn });

    const result = await extractText(drive, { id: "doc-1", mimeType: "application/vnd.google-apps.document" });

    expect(result).toEqual({ ok: false, reason: "extraction-failed" });
  });
});

describe("extractText - real PDF parsing (pdf-parse, no mocking)", () => {
  it("extracts real text from a real generated PDF", async () => {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const font = await pdfDoc.embedFont("Helvetica");
    page.drawText("Garlic Butter Chicken recipe", { x: 50, y: 700, size: 18, font });
    const pdfBytes = await pdfDoc.save();

    const getFn = vi.fn().mockResolvedValue({ data: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) });
    const drive = fakeDrive({ get: getFn });

    const result = await extractText(drive, { id: "pdf-1", mimeType: "application/pdf" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain("Garlic Butter Chicken recipe");
    }
  });

  it("reports scanned-pdf-ocr-not-implemented for a real PDF with pages but no text layer", async () => {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage(); // a real page with no text drawn on it - a stand-in for a scanned/image-only PDF
    const pdfBytes = await pdfDoc.save();

    const getFn = vi.fn().mockResolvedValue({ data: pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength) });
    const drive = fakeDrive({ get: getFn });

    const result = await extractText(drive, { id: "pdf-scanned", mimeType: "application/pdf" });

    expect(result).toEqual({ ok: false, reason: "scanned-pdf-ocr-not-implemented" });
  });
});
