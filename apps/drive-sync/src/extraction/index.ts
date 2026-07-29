import { PDFParse } from "pdf-parse";
import type { drive_v3 } from "googleapis";

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SHEET = "application/vnd.google-apps.spreadsheet";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const PDF = "application/pdf";
const PLAIN_TEXT = "text/plain";

export type ExtractionResult =
  | { ok: true; text: string }
  | { ok: false; reason: "unsupported-mime-type"; mimeType: string }
  | { ok: false; reason: "empty-content" }
  // pdf-parse found pages but no extractable text on any of them - the
  // classic signature of a scanned/image-only PDF. Reported as its own
  // distinct reason rather than folded into `empty-content`, so a caller
  // (and this checklist) can tell "genuinely nothing to extract" apart
  // from "there was content, but it needs OCR we don't have yet."
  | { ok: false; reason: "scanned-pdf-ocr-not-implemented" }
  | { ok: false; reason: "extraction-failed" };

async function exportGoogleNativeFile(drive: drive_v3.Drive, fileId: string, exportMimeType: string): Promise<string> {
  const res = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "text" });
  return typeof res.data === "string" ? res.data : String(res.data ?? "");
}

async function downloadRawFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(res.data as ArrayBuffer);
}

async function extractPdfText(buffer: Buffer): Promise<ExtractionResult> {
  const parser = new PDFParse({ data: buffer });
  try {
    // `pageJoiner: ""` - pdf-parse's default inserts a
    // "-- page_number of total_number --" marker between every page,
    // which would make a genuinely textless (scanned) PDF look non-empty
    // after concatenation and defeat the emptiness check below. Caught
    // live by a test against a real blank-page PDF before this fix.
    const result = await parser.getText({ pageJoiner: "" });
    const text = result.text.trim();
    if (text.length === 0 && result.total > 0) {
      return { ok: false, reason: "scanned-pdf-ocr-not-implemented" };
    }
    if (text.length === 0) {
      return { ok: false, reason: "empty-content" };
    }
    return { ok: true, text };
  } finally {
    await parser.destroy();
  }
}

/**
 * Converts a Drive file's content to plain text (Milestone #3). Google-
 * native formats (Docs, Slides) go through Drive's own `files.export` to
 * `text/plain` - no separate parser needed, Drive does the conversion
 * server-side. Sheets export as CSV (Drive's `export` only returns the
 * first sheet - documented as a known limitation below, full multi-sheet
 * support would need the separate Sheets API). Plain-text files are
 * downloaded and decoded as-is. PDFs are downloaded and parsed with
 * `pdf-parse`; a PDF with pages but no extractable text (a scanned/
 * image-only PDF) is reported distinctly rather than silently returning
 * empty text - see `scanned-pdf-ocr-not-implemented` above.
 *
 * Takes the `drive_v3.Drive` client as a parameter (same
 * dependency-injection shape as `drive/index.ts`'s `listDriveFiles`), so
 * the Google-native/plain-text paths are unit-testable against a
 * hand-built fake client. The PDF path is exercised with a real
 * `pdf-parse` call against a real generated PDF buffer, since that
 * parsing logic has no live external dependency to fake.
 */
export async function extractText(drive: drive_v3.Drive, file: { id: string; mimeType: string }): Promise<ExtractionResult> {
  try {
    switch (file.mimeType) {
      case GOOGLE_DOC:
      case GOOGLE_SLIDES: {
        const text = (await exportGoogleNativeFile(drive, file.id, "text/plain")).trim();
        return text.length > 0 ? { ok: true, text } : { ok: false, reason: "empty-content" };
      }
      case GOOGLE_SHEET: {
        const text = (await exportGoogleNativeFile(drive, file.id, "text/csv")).trim();
        return text.length > 0 ? { ok: true, text } : { ok: false, reason: "empty-content" };
      }
      case PLAIN_TEXT: {
        const buffer = await downloadRawFile(drive, file.id);
        const text = buffer.toString("utf8").trim();
        return text.length > 0 ? { ok: true, text } : { ok: false, reason: "empty-content" };
      }
      case PDF: {
        const buffer = await downloadRawFile(drive, file.id);
        return await extractPdfText(buffer);
      }
      default:
        return { ok: false, reason: "unsupported-mime-type", mimeType: file.mimeType };
    }
  } catch {
    return { ok: false, reason: "extraction-failed" };
  }
}
