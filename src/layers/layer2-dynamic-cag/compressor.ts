/**
 * Layer 2 — Adaptive Contextual Compression
 *
 * Compresses dynamic data to fit within token budgets while
 * preserving the most important information.
 *
 * Strategies:
 *  - Extractive: Keep only key sentences/facts
 *  - Abstractive: Summarize using the LLM itself
 *  - Structural: Remove formatting, redundancy, boilerplate
 */

export type CompressionStrategy = 'extractive' | 'structural';

export interface CompressionResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
}

export class Compressor {
  /**
   * Compress text using structural strategy.
   * Removes redundancy, normalizes whitespace, strips boilerplate.
   */
  structural(text: string): CompressionResult {
    const original = text;
    let compressed = text;

    // Normalize whitespace
    compressed = compressed.replace(/\n{3,}/g, '\n\n');
    compressed = compressed.replace(/[ \t]+/g, ' ');
    compressed = compressed.trim();

    // Remove common boilerplate patterns
    compressed = compressed.replace(/^[-=]{3,}$/gm, '');
    compressed = compressed.replace(/^\s*$/gm, '');

    // Deduplicate consecutive identical lines
    const lines = compressed.split('\n');
    const deduped: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 || lines[i] !== lines[i - 1]) {
        deduped.push(lines[i]!);
      }
    }
    compressed = deduped.join('\n');

    const originalTokens = this.estimateTokens(original);
    const compressedTokens = this.estimateTokens(compressed);

    return {
      original,
      compressed,
      originalTokens,
      compressedTokens,
      ratio: compressedTokens / originalTokens,
    };
  }

  /**
   * Compress text using extractive strategy.
   * Keeps sentences with highest information density (keyword frequency).
   */
  extractive(text: string, maxTokens: number): CompressionResult {
    const sentences = this.splitSentences(text);
    if (sentences.length === 0) {
      return { original: text, compressed: '', originalTokens: 0, compressedTokens: 0, ratio: 0 };
    }

    // Score sentences by keyword density
    const wordFreq = this.buildWordFrequency(text);
    const scored = sentences.map((sentence) => ({
      sentence,
      score: this.scoreSentence(sentence, wordFreq),
    }));

    // Sort by score, take top sentences until we hit token limit
    scored.sort((a, b) => b.score - a.score);

    const selected: string[] = [];
    let currentTokens = 0;

    for (const { sentence } of scored) {
      const tokens = this.estimateTokens(sentence);
      if (currentTokens + tokens > maxTokens) break;
      selected.push(sentence);
      currentTokens += tokens;
    }

    // Restore original order
    const originalOrder = selected.sort(
      (a, b) => text.indexOf(a) - text.indexOf(b),
    );

    const compressed = originalOrder.join(' ');
    const originalTokens = this.estimateTokens(text);

    return {
      original: text,
      compressed,
      originalTokens,
      compressedTokens: currentTokens,
      ratio: currentTokens / originalTokens,
    };
  }

  private splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  private buildWordFrequency(text: string): Map<string, number> {
    const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    const freq = new Map<string, number>();
    for (const word of words) {
      freq.set(word, (freq.get(word) ?? 0) + 1);
    }
    return freq;
  }

  private scoreSentence(sentence: string, wordFreq: Map<string, number>): number {
    const words = sentence.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
    if (words.length === 0) return 0;
    const totalScore = words.reduce((sum, w) => sum + (wordFreq.get(w) ?? 0), 0);
    return totalScore / words.length;
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3);
  }
}
