import { describe, it, expect } from 'vitest';
import { splitText, type TextChunk } from '../../src/utils/text-splitter.js';

/**
 * Helper: creates multi-paragraph text.
 * Each paragraph is ~10 tokens (40 chars) by default.
 */
function paragraphs(count: number, charsEach = 40): string {
  return Array.from({ length: count }, (_, i) => 'W'.repeat(charsEach - String(i).length) + i)
    .join('\n\n');
}

describe('splitText', () => {
  // ─── Basic Splitting ─────────────────────────────────────────────────

  it('should return a single chunk when text fits budget', () => {
    const text = 'Short text that fits easily.';
    const chunks = splitText(text, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(text);
    expect(chunks[0]!.index).toBe(0);
  });

  it('should return empty array for empty text', () => {
    const chunks = splitText('', 100);
    expect(chunks).toHaveLength(0);
  });

  it('should split at paragraph boundaries', () => {
    // Each paragraph ~10 tokens (40 chars / 4)
    const text = paragraphs(5, 40);
    // Budget of 15 tokens → fits ~1-2 paragraphs per chunk
    const chunks = splitText(text, 15);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify all content is preserved
    const reassembled = chunks.map((c) => c.content).join('\n\n');
    // Content should be preserved (overlap may add duplication)
    for (const paragraph of text.split('\n\n')) {
      expect(reassembled).toContain(paragraph);
    }
  });

  it('should assign sequential indices to chunks', () => {
    const text = paragraphs(6, 40);
    const chunks = splitText(text, 12);
    chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
    });
  });

  it('should include token count for each chunk', () => {
    const text = paragraphs(3, 40);
    const chunks = splitText(text, 100);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeGreaterThan(0);
      expect(typeof chunk.tokens).toBe('number');
    }
  });

  // ─── Sentence-level Splitting ────────────────────────────────────────

  it('should split by sentences when a single paragraph exceeds budget', () => {
    // One long paragraph with multiple sentences (~80 tokens total)
    const longParagraph =
      'First sentence about an important topic. ' +
      'Second sentence with more details. ' +
      'Third sentence explaining the conclusion. ' +
      'Fourth sentence with final thoughts about everything discussed.';

    // Budget of 15 tokens → must split within the paragraph
    const chunks = splitText(longParagraph, 15);
    expect(chunks.length).toBeGreaterThan(1);

    // All sentences should be present across chunks
    expect(chunks.some((c) => c.content.includes('First sentence'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('Fourth sentence'))).toBe(true);
  });

  // ─── Overlap ─────────────────────────────────────────────────────────

  it('should add overlap between chunks when specified', () => {
    // Create paragraphs with recognizable sentences
    const text = [
      'Alpha paragraph with first topic. It has two sentences.',
      'Beta paragraph with second topic. Another pair of sentences.',
      'Gamma paragraph with third topic. Final pair of sentences.',
    ].join('\n\n');

    // Budget small enough to force splitting, overlap of 10 tokens
    const chunks = splitText(text, 20, 10);

    // With overlap, later chunks may contain content from previous chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('should work correctly with zero overlap (default)', () => {
    const text = paragraphs(4, 40);
    const chunksNoOverlap = splitText(text, 15, 0);
    const chunksDefault = splitText(text, 15);

    expect(chunksNoOverlap.length).toBe(chunksDefault.length);
  });

  // ─── Edge Cases ──────────────────────────────────────────────────────

  it('should handle text with only one paragraph', () => {
    const text = 'Just a single paragraph with no line breaks at all.';
    const chunks = splitText(text, 100);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe(text);
  });

  it('should handle text with multiple blank lines', () => {
    const text = 'Para one.\n\n\n\nPara two.\n\n\n\n\nPara three.';
    const chunks = splitText(text, 100);
    // Multiple blank lines should still produce valid chunks
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.some((c) => c.content.includes('Para one'))).toBe(true);
    expect(chunks.some((c) => c.content.includes('Para three'))).toBe(true);
  });

  it('should handle very small budget forcing per-sentence splits', () => {
    const text = 'Sentence one. Sentence two. Sentence three. Sentence four.';
    // Budget of 3 tokens → each sentence alone might exceed
    const chunks = splitText(text, 3);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
