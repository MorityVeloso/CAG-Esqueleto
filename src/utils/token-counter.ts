/**
 * Token Counter
 *
 * Estimates token count for Claude models.
 * Uses tiktoken for accurate counts when available,
 * falls back to character-based estimation.
 */

let tiktokenEncoder: { encode: (text: string) => number[] } | null = null;

/**
 * Initialize tiktoken encoder (async, loads WASM).
 * Call once at startup for accurate counts.
 */
export async function initTokenCounter(): Promise<void> {
  try {
    const { encoding_for_model } = await import('tiktoken');
    // Claude uses cl100k_base tokenizer (same as GPT-4)
    tiktokenEncoder = encoding_for_model('gpt-4');
  } catch {
    // tiktoken not available — will use estimation
    tiktokenEncoder = null;
  }
}

/**
 * Count tokens in text.
 * Uses tiktoken if initialized, otherwise estimates.
 */
export function countTokens(text: string): number {
  if (tiktokenEncoder) {
    return tiktokenEncoder.encode(text).length;
  }
  return estimateTokens(text);
}

/**
 * Estimate tokens without tiktoken.
 * Rules of thumb: ~4 chars/token English, ~2 chars/token for CJK/code.
 */
export function estimateTokens(text: string): number {
  // Count CJK characters (roughly 1 token each)
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g) ?? []).length;
  const nonCjkLength = text.length - cjkChars;
  return Math.ceil(nonCjkLength / 4) + cjkChars;
}

/**
 * Check if text fits within a token budget.
 */
export function fitsInBudget(text: string, maxTokens: number): boolean {
  return countTokens(text) <= maxTokens;
}
