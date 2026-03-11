/**
 * Layer 2 — Adaptive Contextual Compression (ACC)
 *
 * 3-stage pipeline inspired by the ACC paper (May 2025):
 *
 *  Stage 1 — Relevance Scoring:
 *    Score each segment 0.0–1.0 by query relevance or information density
 *
 *  Stage 2 — Lossless Compression:
 *    Pattern-based transforms: abbreviations, whitespace, table densification
 *
 *  Stage 3 — Adaptive Window Allocation:
 *    Allocate token budget proportional to segment scores
 */

import type { CompressedResult, CompressionRule } from '@core/types.js';
import { countTokens } from '../../utils/token-counter.js';

interface ScoredSegment {
  text: string;
  score: number;
  tokens: number;
}

export interface CompressorOptions {
  targetRatio: number;
  maxTokens: number;
}

export class AdaptiveCompressor {
  private readonly targetRatio: number;
  private readonly maxTokens: number;
  private abbreviations: Map<string, string> = new Map();
  private rules: CompressionRule[] = [];

  constructor(options: CompressorOptions) {
    this.targetRatio = options.targetRatio;
    this.maxTokens = options.maxTokens;
  }

  /**
   * Run the full 3-stage compression pipeline.
   *
   * @param text — raw text to compress
   * @param query — optional query for relevance-based scoring
   */
  async compress(text: string, query?: string): Promise<CompressedResult> {
    if (!text.trim()) {
      return {
        compressed: '',
        originalTokens: 0,
        compressedTokens: 0,
        compressionRatio: 0,
        segmentsKept: 0,
        segmentsDropped: 0,
      };
    }

    const originalTokens = countTokens(text);

    // ─── Stage 1: Relevance Scoring ─────────────────────────────────────
    const segments = this.splitIntoSegments(text);
    const scored = query
      ? this.scoreByRelevance(segments, query)
      : this.scoreByDensity(segments);

    // ─── Stage 2: Lossless Compression ──────────────────────────────────
    const compressed = scored.map((seg) => ({
      ...seg,
      text: this.applyLosslessCompression(seg.text),
    }));

    // Recount tokens after lossless compression
    for (const seg of compressed) {
      seg.tokens = countTokens(seg.text);
    }

    // ─── Stage 3: Adaptive Window Allocation ────────────────────────────
    const allocated = this.allocateWindow(compressed);

    const finalText = allocated.map((s) => s.text).join('\n\n');
    const compressedTokens = countTokens(finalText);

    return {
      compressed: finalText,
      originalTokens,
      compressedTokens,
      compressionRatio: originalTokens > 0 ? compressedTokens / originalTokens : 0,
      segmentsKept: allocated.length,
      segmentsDropped: segments.length - allocated.length,
    };
  }

  /**
   * Register a domain-specific abbreviation.
   * Applied during Stage 2 (lossless compression).
   */
  registerAbbreviation(full: string, short: string): void {
    this.abbreviations.set(full, short);
  }

  /**
   * Register a custom compression rule (regex + replacement).
   */
  registerCompressionRule(rule: CompressionRule): void {
    this.rules.push(rule);
  }

  // ─── Stage 1: Segmentation & Scoring ──────────────────────────────────

  /**
   * Split text into paragraph-level segments.
   * Falls back to sentence-level for single-paragraph text.
   */
  private splitIntoSegments(text: string): string[] {
    // Try paragraph split first (double newline)
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (paragraphs.length >= 2) return paragraphs;

    // Single paragraph — split into sentences
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Score segments by relevance to a specific query.
   * Uses term overlap (TF-IDF-like) between query and segment.
   */
  private scoreByRelevance(segments: string[], query: string): ScoredSegment[] {
    const queryTerms = this.extractTerms(query);
    if (queryTerms.length === 0) return this.scoreByDensity(segments);

    const scored = segments.map((text) => {
      const segTerms = this.extractTerms(text);
      if (segTerms.length === 0) return { text, score: 0, tokens: countTokens(text) };

      // Count matching terms
      const matches = segTerms.filter((t) => queryTerms.includes(t)).length;
      const score = Math.min(matches / queryTerms.length, 1.0);

      return { text, score, tokens: countTokens(text) };
    });

    return this.normalizeScores(scored);
  }

  /**
   * Score segments by information density (no query context).
   * High-density indicators: numbers, proper nouns, unique terms, short length.
   */
  private scoreByDensity(segments: string[]): ScoredSegment[] {
    const globalTermFreq = this.buildTermFrequency(segments.join(' '));

    const scored = segments.map((text) => {
      const terms = this.extractTerms(text);
      if (terms.length === 0) return { text, score: 0, tokens: countTokens(text) };

      // Factor 1: Numbers and data points (financial data, dates, quantities)
      const numberCount = (text.match(/\d+([.,]\d+)?/g) ?? []).length;
      const numberScore = Math.min(numberCount / 3, 1.0);

      // Factor 2: Unique/rare terms (TF-IDF-like)
      const totalTerms = Array.from(globalTermFreq.values()).reduce((a, b) => a + b, 0);
      const rarityScore = terms.reduce((sum, t) => {
        const freq = globalTermFreq.get(t) ?? 0;
        return sum + (1 - freq / totalTerms);
      }, 0) / terms.length;

      // Factor 3: Capitalized words (proper nouns, entities)
      const capitalWords = (text.match(/\b[A-Z][a-záàâãéèêíïóôõöúçñ]+/g) ?? []).length;
      const entityScore = Math.min(capitalWords / 3, 1.0);

      // Weighted combination
      const score = numberScore * 0.4 + rarityScore * 0.35 + entityScore * 0.25;

      return { text, score, tokens: countTokens(text) };
    });

    return this.normalizeScores(scored);
  }

  // ─── Stage 2: Lossless Compression ────────────────────────────────────

  /**
   * Apply all lossless transformations to a segment.
   */
  private applyLosslessCompression(text: string): string {
    let result = text;

    // Step 1: Normalize whitespace
    result = result.replace(/\r\n/g, '\n');
    result = result.replace(/[ \t]+/g, ' ');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/[ \t]+$/gm, '');

    // Step 2: Remove duplicate consecutive lines
    const lines = result.split('\n');
    const deduped: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 || lines[i] !== lines[i - 1]) {
        deduped.push(lines[i]!);
      }
    }
    result = deduped.join('\n');

    // Step 3: Apply registered abbreviations
    for (const [full, short] of this.abbreviations) {
      result = result.replaceAll(full, short);
    }

    // Step 4: Apply custom compression rules
    for (const rule of this.rules) {
      if (typeof rule.replacement === 'string') {
        result = result.replace(rule.pattern, rule.replacement);
      } else {
        result = result.replace(rule.pattern, rule.replacement as (substring: string, ...args: string[]) => string);
      }
    }

    // Step 5: Densify verbose lists (e.g., "- item\n- item" → "item | item")
    result = this.densifyLists(result);

    return result.trim();
  }

  /**
   * Convert verbose bullet lists to compact pipe-separated format.
   * Only converts lists with 3+ items of short content.
   */
  private densifyLists(text: string): string {
    // Match consecutive bullet/dash lines
    return text.replace(
      /(?:^[ \t]*[-•*][ \t]+.+$\n?){3,}/gm,
      (match) => {
        const items = match
          .split('\n')
          .map((line) => line.replace(/^[ \t]*[-•*][ \t]+/, '').trim())
          .filter((item) => item.length > 0);

        // Only densify if items are short (< 80 chars each)
        if (items.every((item) => item.length < 80)) {
          return items.join(' | ') + '\n';
        }
        return match;
      },
    );
  }

  // ─── Stage 3: Adaptive Window Allocation ──────────────────────────────

  /**
   * Allocate maxTokens budget proportional to segment scores.
   * High-scoring segments get full allocation, low-scoring get truncated/dropped.
   */
  private allocateWindow(segments: ScoredSegment[]): ScoredSegment[] {
    if (segments.length === 0) return [];

    // Sort by score descending
    const sorted = [...segments].sort((a, b) => b.score - a.score);

    const totalScore = sorted.reduce((sum, s) => sum + s.score, 0);
    if (totalScore === 0) {
      // All scores are 0 — keep segments until budget is reached
      return this.fillByOrder(segments);
    }

    const result: ScoredSegment[] = [];
    let remainingTokens = this.maxTokens;

    for (const segment of sorted) {
      if (remainingTokens <= 0) break;

      // Proportional allocation
      const allocation = Math.floor((segment.score / totalScore) * this.maxTokens);
      const budgetForSegment = Math.max(allocation, 1);

      if (segment.tokens <= budgetForSegment && segment.tokens <= remainingTokens) {
        // Segment fits — keep as is
        result.push(segment);
        remainingTokens -= segment.tokens;
      } else if (remainingTokens > 50) {
        // Truncate to fit remaining budget
        const truncated = this.truncateToTokens(segment.text, remainingTokens);
        if (truncated) {
          result.push({ text: truncated, score: segment.score, tokens: countTokens(truncated) });
          remainingTokens -= countTokens(truncated);
        }
      }
    }

    return result;
  }

  /**
   * Fallback: fill budget in original order when all scores are 0.
   */
  private fillByOrder(segments: ScoredSegment[]): ScoredSegment[] {
    const result: ScoredSegment[] = [];
    let remaining = this.maxTokens;

    for (const seg of segments) {
      if (remaining <= 0) break;
      if (seg.tokens <= remaining) {
        result.push(seg);
        remaining -= seg.tokens;
      }
    }

    return result;
  }

  /**
   * Truncate text to approximately fit within a token budget.
   */
  private truncateToTokens(text: string, maxTokens: number): string | null {
    // Approximate: 4 chars per token
    const maxChars = maxTokens * 4;
    if (text.length <= maxChars) return text;

    const truncated = text.slice(0, maxChars);
    // Try to cut at last sentence boundary
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > maxChars * 0.5) {
      return truncated.slice(0, lastPeriod + 1);
    }
    // Cut at last space
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.5) {
      return truncated.slice(0, lastSpace) + '…';
    }
    return truncated + '…';
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private extractTerms(text: string): string[] {
    return text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  }

  private buildTermFrequency(text: string): Map<string, number> {
    const terms = this.extractTerms(text);
    const freq = new Map<string, number>();
    for (const term of terms) {
      freq.set(term, (freq.get(term) ?? 0) + 1);
    }
    return freq;
  }

  /**
   * Normalize scores to 0.0–1.0 range.
   */
  private normalizeScores(segments: ScoredSegment[]): ScoredSegment[] {
    const maxScore = Math.max(...segments.map((s) => s.score), 0.001);
    return segments.map((s) => ({
      ...s,
      score: s.score / maxScore,
    }));
  }
}
