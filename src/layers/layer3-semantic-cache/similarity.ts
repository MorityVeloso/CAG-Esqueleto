/**
 * Layer 3 — Vector Similarity Utilities
 *
 * Pure TypeScript — no external dependencies.
 * Optimized for performance (single-pass loops, minimal allocations).
 */

/**
 * Calculate cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical, 0 = orthogonal).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dot / denominator;
}

/**
 * Calculate the dot product of two vectors.
 */
export function dotProduct(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Calculate Euclidean distance between two vectors.
 * Returns 0 for identical vectors, higher values for more distant ones.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!;
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Normalize a vector to unit length (L2 normalization).
 * Returns a new vector — does not mutate the input.
 */
export function normalizeVector(v: number[]): number[] {
  let norm = 0;
  for (let i = 0; i < v.length; i++) {
    norm += v[i]! * v[i]!;
  }
  norm = Math.sqrt(norm);

  if (norm === 0) return new Array(v.length).fill(0) as number[];

  const result = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i]! / norm;
  }
  return result;
}

/**
 * Find the top-K most similar vectors to a query.
 */
export function findTopK(
  query: number[],
  candidates: { id: string; embedding: number[] }[],
  k: number,
): { id: string; similarity: number }[] {
  const scored = candidates.map((c) => ({
    id: c.id,
    similarity: cosineSimilarity(query, c.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}
