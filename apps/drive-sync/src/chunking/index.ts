import { encodingForModel } from "js-tiktoken";

const encoding = encodingForModel("text-embedding-3-small");

function countTokens(text: string): number {
  return encoding.encode(text).length;
}

/**
 * A line counts as a section heading if, once trimmed, it ends in a bare
 * colon with nothing after it - e.g. "Ingredients:", "Steps:", "Notes:".
 * Checked against real extracted Drive Docs (see `07-implementation-log.md`
 * Cycle 20) before landing on this: an earlier "short line with no
 * trailing sentence punctuation" heuristic misfired constantly, since
 * short standalone lines are extremely common in real recipe text ("mix",
 * "bake", "cool") and Drive's plain-text export carries no
 * bold/heading-level formatting to lean on instead. The bare-trailing-colon
 * rule correctly distinguishes a real section label from a `Key: value`
 * metadata line like "Category: Main Course" (content follows the colon,
 * so it doesn't match) without needing any document-specific wording.
 * Deliberately conservative: a missed heading just means a chunk's
 * `section` stays whatever it was before, a safe default.
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.length > 1 && trimmed.length <= 60 && trimmed.endsWith(":") && !trimmed.slice(0, -1).includes(":");
}

interface Segment {
  text: string;
  tokenCount: number;
  section: string | null;
}

function toSegments(text: string): Segment[] {
  // Real Drive Docs export with `\r\n` line endings - normalize first, or
  // every line would carry a trailing `\r` (breaking `isHeadingLine`'s
  // `endsWith(":")` check and leaking into chunk text). Caught live
  // against a real document before this fix (see `07-implementation-log.md`
  // Cycle 20).
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const segments: Segment[] = [];
  let currentSection: string | null = null;

  for (const line of lines) {
    if (isHeadingLine(line)) {
      currentSection = line.trim();
    }
    segments.push({ text: line, tokenCount: countTokens(line), section: currentSection });
  }

  return segments;
}

export interface ChunkSource {
  fileId: string;
  title: string;
}

export interface TextChunk {
  fileId: string;
  title: string;
  section: string | null;
  chunkIndex: number;
  text: string;
  tokenCount: number;
}

export interface ChunkOptions {
  // Sized well under text-embedding-3-small's 8191-token input limit -
  // small enough that a chunk stays topically focused for retrieval,
  // large enough to avoid needing hundreds of chunks per document.
  chunkSizeTokens?: number;
  overlapTokens?: number;
}

const DEFAULT_CHUNK_SIZE_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 60;

/**
 * Splits `text` into overlapping, retrieval-sized chunks (Milestone #4).
 * Accumulates whole lines (never splits mid-line/mid-token) until adding
 * the next line would exceed `chunkSizeTokens`, then starts a new chunk
 * seeded with however many trailing lines from the just-finished chunk
 * fit within `overlapTokens` - so retrieval context isn't lost at a hard
 * chunk boundary. Every chunk carries the source file's ID/title plus
 * whichever heading-like line (see `isHeadingLine`) most recently
 * preceded it, so a retrieval result can cite not just "this document"
 * but roughly *where* in it.
 *
 * A single line longer than `chunkSizeTokens` on its own (rare, but
 * possible with dense text) is kept as its own oversized chunk rather
 * than silently dropped or truncated - "never split mid-line" wins over
 * "never exceed the target size" for a single pathological line.
 */
export function chunkText(text: string, source: ChunkSource, options: ChunkOptions = {}): TextChunk[] {
  const chunkSizeTokens = options.chunkSizeTokens ?? DEFAULT_CHUNK_SIZE_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  const segments = toSegments(text).filter((segment) => segment.text.trim().length > 0);
  if (segments.length === 0) {
    return [];
  }

  const chunks: TextChunk[] = [];
  let buffer: Segment[] = [];
  let bufferTokens = 0;

  function flush(): void {
    const [first] = buffer;
    if (!first) {
      return;
    }
    chunks.push({
      fileId: source.fileId,
      title: source.title,
      section: first.section,
      chunkIndex: chunks.length,
      text: buffer.map((segment) => segment.text).join("\n"),
      tokenCount: bufferTokens,
    });
  }

  for (const segment of segments) {
    // A single segment already at or over budget on its own gets flushed
    // as its own dedicated chunk, bypassing the normal overlap-seeding
    // path entirely - seeding overlap from the pending buffer and *then*
    // gluing this segment onto it would produce an oversized chunk that
    // also drags in unrelated leading content, not a clean "this one
    // line, alone" chunk.
    if (segment.tokenCount > chunkSizeTokens) {
      flush();
      buffer = [segment];
      bufferTokens = segment.tokenCount;
      flush();
      buffer = [];
      bufferTokens = 0;
      continue;
    }

    if (buffer.length > 0 && bufferTokens + segment.tokenCount > chunkSizeTokens) {
      flush();

      // Seed the next chunk with trailing segments from the one just
      // finished, up to `overlapTokens` worth (from the end backward).
      let overlapBuffer: Segment[] = [];
      let overlapCount = 0;
      for (let i = buffer.length - 1; i >= 0 && overlapCount < overlapTokens; i--) {
        const trailing = buffer[i];
        if (!trailing) {
          continue;
        }
        overlapBuffer = [trailing, ...overlapBuffer];
        overlapCount += trailing.tokenCount;
      }
      buffer = overlapBuffer;
      bufferTokens = overlapCount;
    }

    buffer.push(segment);
    bufferTokens += segment.tokenCount;
  }
  flush();

  return chunks;
}
